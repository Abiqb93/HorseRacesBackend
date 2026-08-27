# France

French racing — entries, declarations, racecards and results — scraped from
France Galop, fetched from PMU, merged, and written into `APIData_Table2`
alongside the Timeform form.

Landing in the same table is the point. French runs only become useful once the
horse, sire and dam pages find them without knowing where they came from.

## Running it

```bash
npm run france:schema                       # once: adds the columns and tables
npm run france:ingest -- today              # yesterday | today | tomorrow
npm run france:ingest -- today --dry-run    # fetch and match, write nothing
npm run france:ingest -- 2026-08-26         # one past date, PMU only
npm run france:backfill -- 2024-01-01 2024-12-31
npm run france:stats
npm run france:test                         # 45 tests, no network
```

Needs `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` — the same variables the
server uses.

## What one day looks like

```
$ npm run france:ingest -- yesterday

Ingested yesterday
  sources   : France Galop 138 · PMU 96
  merged    : 16 races, 154 runners (both 6 · FG only 8 · PMU only 2)
  same track: "TESTE DE BUCH" (PMU) = "LA TESTE-BASSIN ARCACHON" (FG) — 80 shared runners
  identity  : 1 linked · 153 new · 0 for review
  written   : 154 rows into APIData_Table2 (154 replaced), 154 into FranceRaceRecords
```

## Why two sources

PMU does not carry most French racing. On 22 Aug 2026 France ran four
thoroughbred meetings and PMU priced one — the other three were PMH fixtures,
with on-course betting only. **42% of that day's runners existed only in the
France Galop scrape.**

So France Galop is the spine that defines the fixture list, and PMU adds what
only it holds: starting price, in-running comments, per-runner times.

They also split by time. France Galop publishes a rolling three-day public
window and returns a Microsoft login page for anything older, so **all backfill
goes through PMU**, which reaches back to 2013. Nothing here depends on an
authenticated France Galop session.

## The two rules that keep the database safe

**Every French row is tagged.** `sourceSystem = 'FRANCE'`, plus `raceCountry`,
`sourceRaceId` and `sourceHorseId`. The whole feed can be found, audited or
deleted without touching a Timeform row:

```sql
SELECT COUNT(*) FROM APIData_Table2 WHERE sourceSystem = 'FRANCE';
DELETE      FROM APIData_Table2 WHERE sourceSystem = 'FRANCE';  -- complete rollback
```

**Re-running a day corrects it.** Promotion deletes that race's French rows and
re-inserts them, scoped by `sourceSystem`, so the delete can never reach a
Timeform row even if a race key collided. This is why no unique index is
required: correctness comes from the scope of the delete.

Re-running is normal, not exceptional. French results are amended after the
fact — non-runners, disqualifications, stewards' decisions — so the reconcile
job re-pulls the last seven days every night. Without it a single pass at
result time drifts away from the official record within days.

## Identity

Three states, not a score: **AGREE**, **ABSENT**, **CONTRADICT**. Only a
contradiction blocks a match.

That distinction is doing real work. In a 55-match sample, 20 had a **null dam**
on our side. If absent evidence read as disagreement, every incomplete record
would block its own match.

The case that justifies the care: `ROYALLY` on a current card is a
two-year-old by Kingman. We already hold a `ROYALLY` foaled 2006 by Verglas,
`horseCode` 290555. Name-only matching would weld a twenty-year-old horse's
form onto a juvenile's profile.

Two further traps, both real:

- **Sex is not stable across a career.** A colt gelded mid-career reads `"c"` on
  old form and `HONGRES` today. Colt↔gelding is ageing, not a contradiction.
- **Our own rows disagree with themselves** — the same row carries
  `horseCountry: "FR"` beside `countryCode: "FRA"`.

Only rows with a `horseCode` are candidates. Without that, the second pass over
a day matches France's own rows against themselves, and a handful land in the
review queue on every reconcile. A row with no `horseCode` is a run, not a horse
record.

Across five days and 658 runners: **284 linked, 319 created, 55 for review** —
about 8% needing a person, and more horses to create than to link, because
provincial French racing is full of horses we have never seen.

## Course names

The sources disagree about what a racecourse is called. France Galop runs
`LA TESTE-BASSIN ARCACHON`; PMU calls the same fixture
`HIPPODROME DE LA TESTE DE BUCH`. Neither string reduces to the other.

Before this was handled, 26 Aug 2026 merged to 234 rows when the truth was 154:
every runner at La Teste stored twice, once under each source's spelling, which
would have become two `APIData_Table2` rows for one run.

A hand-maintained alias table would need a new entry every time France opens a
course or either source rewords one — silently duplicating runners until
somebody noticed. So the match is made on the runners instead. **A horse runs
once a day**, so two same-date meetings that share runners are the same meeting.
Containment is measured against the smaller field, because the sources routinely
disagree on how many races they carry.

Every pairing is reported in the run log and the merge stats rather than applied
silently — a wrong pairing would fold two meetings into one.

## Endpoints

| Route | Purpose |
|---|---|
| `POST /api/france/schema` | Add the columns and tables. Safe to repeat. |
| `POST /api/france/ingest` | `{day}` \| `{date}` \| `{from,to}`, plus `{dryRun}` |
| `POST /api/france/reconcile` | `{days}` — re-pull the recent past |
| `GET /api/france/racecards?date=` | French racing as it sits in `APIData_Table2` |
| `GET /api/france/stats` | Row counts and the review backlog |
| `GET /api/france/runs` | Ingest history |
| `GET /api/france/reviews` | Horses needing a person |
| `GET /api/FranceRaceRecords` | Unchanged — the existing France page |

Set `FRANCE_ADMIN_TOKEN` to guard the write routes; requests must then carry a
matching `x-admin-token` header.

## Schedule

Off unless `FRANCE_CRON=on`. Merging this should not start writing rows on its
own. Times are Europe/Paris, which is what the fixture list is published in.

| When | Does |
|---|---|
| 18:30 daily | Tomorrow's card, once declarations publish |
| every 30 min, 12:00–23:59 | Today, picking up results as they settle |
| 01:15 daily | Yesterday, after everything has settled |
| 02:00 daily | Reconcile the last seven days |

## Layout

```
france/
  franceGalopClient.mjs   scraper — fixtures, meetings, races
  pmuClient.mjs           PMU turfinfo JSON
  normalize.mjs           PMU      -> platform shape
  normalizeFG.mjs         scrape   -> platform shape
  mergeSources.mjs        reconcile the two, including course names
  matchHorse.mjs          three-state identity matching
  store.mjs               MySQL: schema, staging, promotion, review queue
  ingest.mjs              fetch -> merge -> stage -> resolve -> promote
  cli.mjs                 the same pipeline without the server
```

## Traps in the source markup

Each of these was a real bug first, caught by running the scraper rather than
reasoning about it:

- **The markup is lowercase.** `daring prince (gb) m.ps. 5 a.` only looks
  uppercase because of CSS `text-transform`, and the casing varies by page type.
- **Separators are per-field, not per-page.** Distance and prize use a dot for
  thousands, weight uses a comma for decimals, and the `Valeur` rating uses a
  **dot** for decimals. Reading `43.5` as an integer silently truncated every
  rating.
- **The country suffix has two forms** — `CANTAVIR (GB)` on a racecard,
  `HEMATITE IRE` on a result. The bare form is matched against a country
  whitelist and the unstripped name kept, because `DUKE OF IRE` would otherwise
  lose its last word.
- The first race is `1ère`, not `1ème`.
- The race header appends the discipline to the course name
  (`CLAIREFONTAINE PLAT`).
- Draw and beaten margin share one cell: `1.L (Corde:04)`.

And one in PMU: **`idCheval` is not an opaque id** but the composite string
`NAME-DAM-SIRE`. It joins reliably, but it encodes exactly the fields the
matcher compares, so it is never independent evidence of identity — and it moves
if PMU amends a pedigree.

## Units

All confirmed against live payloads:

| Field | Unit |
|---|---|
| `montantPrix`, `montantOffert1er` | euros |
| `gainsParticipant.*` | **centimes** — divide by 100 |
| `handicapPoids` | tenths of a kilo — `595` is 59.5kg |
| `tempsObtenu` | milliseconds, and frequently null on the Flat |
| `distance` | metres; the platform stores furlongs |

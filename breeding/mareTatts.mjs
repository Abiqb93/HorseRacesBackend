/**
 * Each mare's own page in Arion's Tatts style, made on Arion and kept fresh
 * through the sales season (17 November 2026, on All Of Me's progeny record:
 * "in an ideal world this would have a tax-style pedigree here ... that maybe
 * updates every week during November, December and January when we're doing
 * these reports"; and, the same day, "Use the real Arion Tatts page. We have
 * an unlimited licence.").
 *
 * A page is made per horse, not per user's row: a mare on two users' lists
 * (Richard's list was copied from Tom's) has one page. The Arion client keeps
 * the report and its files in its archive; `mare_tatts` points each horse at
 * her newest, by the file ids the site opens through /api/arion/file/:id.
 *
 * In November, December and January a page older than a week is made again,
 * a few at a time and one after another, under the Arion client's own daily
 * guard. Outside those months a page is made when someone asks for it.
 */

export const TATTS_REPORT = "PED01|ZTT#30S_a";
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** After a failed try, this long before the horse is tried again on her own. */
export const RETRY_MS = 24 * 60 * 60 * 1000;

export const TABLE = `CREATE TABLE IF NOT EXISTS mare_tatts (
  name_key VARCHAR(191) NOT NULL,
  foaling_year INT NOT NULL DEFAULT 0,
  horse_name VARCHAR(191) NOT NULL,
  country VARCHAR(8) NULL,
  report_label VARCHAR(255) NULL,
  pdf_file_id VARCHAR(40) NULL,
  html_file_id VARCHAR(40) NULL,
  made_at DATETIME NULL,
  tried_at DATETIME NULL,
  error TEXT NULL,
  PRIMARY KEY (name_key, foaling_year)
)`;

/** November, December and January: the months the sales season's reports are written in. */
export const inSeason = (d = new Date()) => [10, 11, 0].includes(new Date(d).getUTCMonth());

/** One key per horse: her bare name in lower case, and her year (0 when not known). */
export const horseKey = (name, year) => ({
  key: String(name ?? "")
    .trim()
    .replace(/^[*=$]+/, "")
    .replace(/\s*\([A-Za-z]{2,3}\)\s*$/, "")
    .replace(/\s+/g, " ")
    .toLowerCase(),
  year: Number(year) > 1900 ? Number(year) : 0,
});

/** Is this horse's page due: none yet, or older than a week, and not tried and failed in the last day. */
export function isDue(row, now = Date.now()) {
  if (!row) return true;
  const made = row.made_at ? new Date(row.made_at).getTime() : 0;
  const tried = row.tried_at ? new Date(row.tried_at).getTime() : 0;
  if (row.error && tried > now - RETRY_MS) return false;
  return !made || made < now - WEEK_MS;
}

export function createMareTatts({ runQuery, loadArion, chooseCandidate, log = console, now = () => Date.now() }) {
  let ready = null;
  const ensure = () => {
    ready = ready ?? runQuery(TABLE).catch((err) => ((ready = null), Promise.reject(err)));
    return ready;
  };
  let running = null;

  async function rowFor(name, year) {
    await ensure();
    const { key, year: y } = horseKey(name, year);
    const rows = await runQuery("SELECT * FROM mare_tatts WHERE name_key = ? AND foaling_year = ? LIMIT 1", [key, y]);
    return rows?.[0] ?? null;
  }

  const shape = (r) =>
    r
      ? {
          name: r.horse_name,
          year: r.foaling_year || null,
          report: r.report_label ?? "Tatts style",
          pdfId: r.pdf_file_id ?? null,
          htmlId: r.html_file_id ?? null,
          madeAt: r.made_at ? new Date(r.made_at).toISOString() : null,
          triedAt: r.tried_at ? new Date(r.tried_at).toISOString() : null,
          error: r.error ?? null,
        }
      : null;

  /** Make her page on Arion now. Never throws: a failure is kept on her row, with when. */
  async function make({ horse_name: name, foaling_year: year = null, country_code: country = null, sire_name: sire = null, dam_name: dam = null, user_id: userId = null }) {
    await ensure();
    const { key, year: y } = horseKey(name, year);
    const at = new Date(now());
    try {
      const { client } = await loadArion();
      if (typeof client.configured === "function" && !client.configured()) throw new Error("Arion is not configured on this server (ARION_USERNAME and ARION_PASSWORD)");
      // Asked without her country: a row's country can be wrong (All Of Me is
      // GB on Arion, IRE on her row), so her year and sire choose, and her
      // country only settles a tie between namesakes
      const found = await client.search({ kind: "named", name, year: y || null, country: "" });
      if (!found?.found || !found.candidates?.length) throw new Error(found?.text || `Arion holds no horse called ${name}`);
      const strict = chooseCandidate(found.candidates, { name, year: y || null, country, sire, dam });
      const pick = strict.one ? strict : chooseCandidate(found.candidates, { name, year: y || null, sire, dam });
      if (!pick.one) throw new Error(pick.among.length ? `Arion lists ${pick.among.length} horses called ${name}; her country or sire would tell them apart` : `Arion lists no ${name}${y ? ` foaled ${y}` : ""}`);
      const out = await client.report({ token: pick.one.token, reportId: TATTS_REPORT, userId });
      const pdf = (out?.files ?? []).find((f) => f.kind === "pdf");
      const html = (out?.files ?? []).find((f) => f.kind === "html");
      if (!pdf && !html) throw new Error(out?.note || "Arion made the Tatts page but handed over no file for it");
      await runQuery(
        `INSERT INTO mare_tatts (name_key, foaling_year, horse_name, country, report_label, pdf_file_id, html_file_id, made_at, tried_at, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
         ON DUPLICATE KEY UPDATE horse_name = VALUES(horse_name), country = VALUES(country), report_label = VALUES(report_label),
           pdf_file_id = VALUES(pdf_file_id), html_file_id = VALUES(html_file_id), made_at = VALUES(made_at), tried_at = VALUES(tried_at), error = NULL`,
        [key, y, String(name).slice(0, 191), country, String(pick.one.label ?? name).slice(0, 255), pdf?.id ?? null, html?.id ?? null, at, at],
      );
      log.log?.(`[tatts] made for ${pick.one.label ?? name}`);
    } catch (err) {
      await runQuery(
        `INSERT INTO mare_tatts (name_key, foaling_year, horse_name, country, tried_at, error) VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE tried_at = VALUES(tried_at), error = VALUES(error)`,
        [key, y, String(name).slice(0, 191), country, at, String(err?.message ?? err).slice(0, 1000)],
      ).catch(() => null);
      log.error?.(`[tatts] ${name}: ${err?.message ?? err}`);
    }
    return shape(await rowFor(name, year));
  }

  /**
   * In season, the pages due, made one after another, at most `limit` a run.
   * The mares are every user's, each horse once.
   */
  async function refresh({ limit = 30, force = false } = {}) {
    if (running) return running;
    if (!force && !inSeason(new Date(now()))) return { made: 0, skipped: "out of season" };
    running = (async () => {
      await ensure();
      const mares = await runQuery("SELECT horse_name, foaling_year, country_code, sire_name, dam_name, user_id FROM my_mares WHERE horse_name IS NOT NULL ORDER BY id", []);
      const kept = await runQuery("SELECT * FROM mare_tatts", []);
      const byKey = new Map(kept.map((r) => [`${r.name_key}|${r.foaling_year}`, r]));
      const seen = new Set();
      const due = [];
      for (const m of mares) {
        const { key, year } = horseKey(m.horse_name, m.foaling_year);
        const k = `${key}|${year}`;
        if (!key || seen.has(k)) continue;
        seen.add(k);
        if (isDue(byKey.get(k), now())) due.push(m);
      }
      let made = 0;
      for (const m of due.slice(0, limit)) {
        const r = await make(m);
        if (r && !r.error) made += 1;
      }
      return { made, due: due.length };
    })().finally(() => {
      running = null;
    });
    return running;
  }

  return { make, refresh, latest: async (name, year) => shape(await rowFor(name, year)) };
}

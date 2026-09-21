/**
 * A first draft of a mating report's four paragraphs.
 *
 * The desk writes these and will go on writing them. What this does is turn
 * the figures already assembled for the report, plus whatever the agent has
 * jotted down, into prose in the house idiom — so the box opens with
 * something to argue with rather than a cursor.
 *
 * ## One rule above all the others
 *
 * It may not invent a number. A mating report is read by a client who will
 * act on it, and a plausible-sounding "4 SWs from 40 runners" that nobody
 * computed is worse than no sentence at all, because it cannot be told from
 * the real ones. So: the prompt forbids it, the schema keeps the output to
 * four fields of prose, and every numeral that comes back is checked against
 * the evidence it was given. What fails that check comes back in `warnings`
 * beside the draft, where an editor sees it — not silently, and not as a
 * blocked request either, because a warning on a first draft is information
 * and an error is an obstacle.
 *
 * ## It does not save anything
 *
 * The draft is returned and nothing else. The page saves it through the plan
 * routes like any other edit, so an unreviewed paragraph cannot become the
 * record because a request happened to succeed.
 */

export const SECTIONS = ["race_record", "pedigree", "produce_record", "analysis"];

/** The shape asked for, where the model's API can be told to guarantee one. */
export const DRAFT_SCHEMA = {
  type: "object",
  properties: Object.fromEntries(SECTIONS.map((s) => [s, { type: "string" }])),
  required: SECTIONS,
  additionalProperties: false,
};

const text = (v) => String(v ?? "").trim();

/**
 * The house style, taught by example rather than description.
 *
 * The examples are real paragraphs from the desk's own reports, which is the
 * only way to convey "i/f", "lsd", "SWs to foals", "the cross", and the habit
 * of naming the horse behind every statistic.
 */
export const SYSTEM = `You are drafting a mating report for Blandford Bloodstock, for a bloodstock agent who will edit it before it reaches the client. You are writing the first draft, not the final word.

Write in British English, in the trade's own register. The reader is a professional breeder: use the shorthand without explaining it — i/f, lsd, SW, SP, GW, G1W, black type, "the cross", "3x4 Urban Sea", "SWs to runners", "she is by", "out of a Galileo mare".

## The rule that matters

Every number you write must appear in the STATS or NOTES you are given. You may round a percentage that is given to one decimal place. You may not:
  - state a figure that is not there, however plausible;
  - estimate, infer or "recall" a stallion's record, a fee, a sale price or a race result;
  - name a horse as a stakes winner, a Group winner or a relative unless it is named as one in what you were given.
Where a figure would help and is not there, say what is not on file — "there is nothing on the cross in our data" — and move on. A short paragraph resting on what is known beats a long one that reads well and cannot be checked.

Our own cross figures count RUNNERS, not foals. Write "4 SWs from 40 runners", never "from 40 foals". Where a figure is labelled as coming from the desk's own notes rather than our data, you may quote it as the notes have it.

## The four sections

race_record — what she did on the track: when she first ran, the trips and the ground, her best form and its level, how she progressed, anything about the way she raced. Only from what you are given.
pedigree — her sire, her dam and what the dam has produced, the family further back, and what her damsire's daughters have done as broodmares. Say what the family throws to.
produce_record — her foals to date and what they have done. If she has none, one sentence: she is a maiden, or she has nothing of racing age.
analysis — the recommendation. Take each suggested stallion in turn, in the order given: why he suits her on pedigree, the cross where there is a record of it, what the foal would be inbred to, and what you would hope to get. Say plainly which you prefer and why. Where the agent's notes give a physical or temperamental reason, use it — those come from someone who has seen the mare and you have not.

## Shape

Prose. No headings, no bullet lists, no preamble, no sign-off. Two to five paragraphs in analysis, one to three in the others. Return a JSON object with exactly the keys race_record, pedigree, produce_record and analysis, each a string.`;

/**
 * Every number anywhere in the evidence, in each of the forms prose writes it.
 *
 * The depth limit is generous on purpose. A stallion's best runner on the
 * cross sits seven levels down — evidence, stats, stallions, [0], cross,
 * horses, [0], best — and a limit that stopped short of him marked his rating
 * as invented, which is exactly the false alarm that teaches an editor to
 * ignore the warnings.
 */
const figures = (o, out = new Set(), depth = 0) => {
  if (depth > 12 || o === null || o === undefined) return out;
  if (typeof o === "number") {
    if (Number.isFinite(o)) {
      out.add(String(o));
      out.add(String(Math.round(o)));
      out.add(o.toFixed(1));
      out.add(String(Math.round(o * 10) / 10));
    }
    return out;
  }
  if (typeof o === "string") {
    for (const m of o.matchAll(/\d+(?:\.\d+)?/g)) out.add(m[0]);
    return out;
  }
  if (Array.isArray(o)) {
    for (const v of o) figures(v, out, depth + 1);
    return out;
  }
  if (typeof o === "object") {
    for (const v of Object.values(o)) figures(v, out, depth + 1);
    return out;
  }
  return out;
};

/**
 * Which numbers in the draft are not in the evidence.
 *
 * Years are exempt — a mare foaled in 2020 who ran at two in 2022 is arithmetic
 * anyone can do — as are the small counting numbers a sentence needs ("won two
 * of her five starts" is checked against the record, not against this).
 */
export function numbersNotInEvidence(sections = {}, evidence = {}) {
  const known = figures(evidence);
  const warnings = [];
  for (const key of SECTIONS) {
    const prose = text(sections[key]);
    if (!prose) continue;
    const seen = new Set();
    for (const m of prose.matchAll(/(?<![\w.])(\d+(?:\.\d+)?)(?![\w])/g)) {
      const n = m[1];
      if (seen.has(n)) continue;
      seen.add(n);
      const v = Number(n);
      // A year, a furlong count, or a number small enough to be a plain count.
      if (v >= 1900 && v <= 2100) continue;
      if (v <= 12 && Number.isInteger(v)) continue;
      if (known.has(n)) continue;
      warnings.push({ section: key, figure: n, note: "not found in the figures supplied" });
    }
  }
  return warnings;
}

/** A stats payload cut down to what a paragraph can use. */
export function summariseStats(stats = {}) {
  const horse = (h) =>
    h && {
      name: h.name ?? h.horse_name ?? null,
      year: h.foalingYear ?? h.year ?? null,
      sire: h.sire ?? null,
      dam: h.dam ?? null,
      damsire: h.damsire ?? null,
      best: h.best ?? null,
      runs: h.runs ?? null,
      wins: h.wins ?? null,
      stakesWins: h.stakesWins ?? h.s_wins ?? null,
      groupWins: h.groupWins ?? h.g_wins ?? null,
      group1Wins: h.group1Wins ?? h.g1_wins ?? null,
    };
  const group = (g, n = 8) =>
    g && {
      n: g.n ?? null,
      rated: g.rated ?? null,
      mean: g.mean == null ? null : Number(g.mean.toFixed?.(1) ?? g.mean),
      stakesWinners: g.stakesWinners ?? null,
      groupWinners: g.groupWinners ?? null,
      group1Winners: g.group1Winners ?? null,
      winners: g.winners ?? null,
      timedOut: g.timedOut ?? false,
      horses: (g.horses ?? []).slice(0, n).map(horse),
    };

  return {
    mare: {
      ...horse(stats?.mare?.own),
      row: stats?.mare?.row
        ? {
            name: stats.mare.row.horse_name,
            sire: stats.mare.row.sire_name,
            dam: stats.mare.row.dam_name,
            damsire: stats.mare.row.damsire_name,
            year: stats.mare.row.foaling_year,
            country: stats.mare.row.country_code,
            location: stats.mare.row.location,
            physical: stats.mare.row.physical,
          }
        : null,
      runs: (stats?.mare?.runs ?? []).slice(0, 30).map((r) => ({
        date: r.meetingDate ?? null,
        course: r.courseName ?? null,
        race: r.raceTitle ?? null,
        distance: r.distance ?? null,
        going: r.going ?? null,
        position: r.positionOfficial ?? null,
        ran: r.numberOfRunners ?? null,
        rating: r.performanceRating ?? null,
      })),
      seasons: (stats?.mare?.seasons ?? []).map((s) => ({
        season: s.season,
        status: s.status,
        coveringSire: s.covering_sire,
        lastServiceDate: s.last_service_date,
        foaledDate: s.foaled_date,
        foalBy: s.foal_by,
      })),
    },
    produce: group(stats?.produce, 12),
    family: { siblings: (stats?.family?.siblings ?? []).slice(0, 12).map(horse) },
    stallions: (stats?.stallions ?? []).map((s) => ({
      name: s.name,
      fee: s.fee
        ? {
            stallion: s.fee.stallion,
            currency: s.fee.local_ccy,
            latest: s.fee.fee_2025_local ?? s.fee.fee_2024_local ?? s.fee.fee_2023_local ?? null,
            stud: s.fee.stud_location,
          }
        : null,
      progeny: group(s.mating?.sire?.progeny),
      damsire: group(s.mating?.damsire?.progeny, 6),
      cross: group(s.mating?.nick, 10),
      worldwide: s.mating?.worldwide
        ? {
            sire: s.mating.worldwide.sire,
            cross: s.mating.worldwide.nick,
            damsire: s.mating.worldwide.damsire,
            crossHorses: (s.mating.worldwide.nickHorses ?? []).slice(0, 10).map(horse),
          }
        : null,
      nicks: s.nicks ?? null,
      missing: s.missing ?? [],
    })),
  };
}

/** The user turn: the mare, the brief, the figures, the agent's own notes. */
export function buildDraftMessages({
  mare = {},
  season = null,
  preferences = [],
  notes = null,
  stats = {},
  inbreeding = null,
} = {}) {
  const compact = summariseStats(stats);
  const evidence = { stats: compact, notes, inbreeding };
  const name = text(mare.name ?? mare.horse_name ?? compact.mare?.row?.name ?? compact.mare?.name);
  const prefs = (preferences ?? []).map((p) =>
    [
      `${p.rank ?? "?"}. ${p.stallion}`,
      p.region ? `(${p.region})` : "",
      p.tag ? `[${p.tag}]` : "",
      p.note ? `— ${p.note}` : "",
    ].filter(Boolean).join(" "),
  );

  const body = [
    `MARE: ${name}${mare.yob || mare.foaling_year ? ` (${mare.yob ?? mare.foaling_year})` : ""}`,
    mare.statusLine ? `STATUS: ${mare.statusLine}` : null,
    season ? `SEASON BEING PLANNED: ${season}` : null,
    prefs.length ? `SUGGESTED STALLIONS, IN ORDER:\n${prefs.join("\n")}` : null,
    notes ? `NOTES FROM THE AGENT (these are observations, not data — use them, and prefer them on anything physical):\n${text(notes)}` : null,
    inbreeding ? `INBREEDING IN THE HYPOTHETICAL FOAL:\n${JSON.stringify(inbreeding, null, 1)}` : null,
    `STATS (every number you write must come from here or from the notes above):\n${JSON.stringify(compact, null, 1)}`,
    "Write the four sections now.",
  ]
    .filter(Boolean)
    .join("\n\n");

  return { system: SYSTEM, user: body, evidence };
}

/** The model's answer, read. Throws rather than returning half a report. */
export function parseDraft(raw) {
  let obj = raw;
  if (typeof raw === "string") {
    const s = raw.trim();
    // A model that has been asked for JSON and wrapped it in a fence is still
    // answering the question; a model that wrote prose is not.
    const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
    const body = fenced ? fenced[1] : s;
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("the draft did not come back as JSON");
    obj = JSON.parse(body.slice(start, end + 1));
  }
  if (!obj || typeof obj !== "object") throw new Error("the draft did not come back as JSON");
  const missing = SECTIONS.filter((s) => typeof obj[s] !== "string");
  if (missing.length) throw new Error(`the draft is missing: ${missing.join(", ")}`);
  return Object.fromEntries(SECTIONS.map((s) => [s, text(obj[s])]));
}

export const MODEL = "claude-opus-5";

/** The text of a response, whichever shape the SDK hands back. */
const textOf = (message) =>
  (message?.content ?? [])
    .filter((b) => b?.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

/**
 * Ask for the draft.
 *
 * The request asks the API to guarantee the JSON shape where it can, and
 * falls back to asking for it in words where the running API or SDK does not
 * know that parameter — this service is deployed from a lockfile we do not
 * control the age of, and a draft that works either way is worth more than
 * one that is correct against exactly one version.
 */
export async function draftReport({ anthropic, model = MODEL, maxTokens = 4000, ...input }) {
  if (!anthropic?.messages?.create) throw new Error("no Anthropic client was supplied");
  const { system, user, evidence } = buildDraftMessages(input);

  const base = {
    model,
    max_tokens: maxTokens,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: user }],
  };

  let message;
  try {
    message = await anthropic.messages.create({
      ...base,
      output_config: { format: { type: "json_schema", schema: DRAFT_SCHEMA } },
    });
  } catch (err) {
    const why = String(err?.message ?? "");
    if (!/output_config|format|unexpected|unknown|invalid_request/i.test(why)) throw err;
    console.warn("report draft: structured output refused, asking in words:", why.slice(0, 160));
    message = await anthropic.messages.create({
      ...base,
      messages: [
        {
          role: "user",
          content: `${user}\n\nReturn ONLY a JSON object with the keys race_record, pedigree, produce_record and analysis. No other text.`,
        },
      ],
    });
  }

  if (message?.stop_reason === "refusal") {
    const err = new Error(`the model declined to draft this report${message?.stop_details?.category ? ` (${message.stop_details.category})` : ""}`);
    err.status = 400;
    throw err;
  }

  const sections = parseDraft(textOf(message));
  return {
    sections,
    model: message?.model ?? model,
    usage: message?.usage ?? null,
    warnings: numbersNotInEvidence(sections, evidence),
    draftedAt: new Date().toISOString(),
  };
}

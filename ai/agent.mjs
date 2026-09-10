/**
 * BlandfordAI - the conversational surface over the platform's own data.
 *
 * The model is given read access to the warehouse and to the site's published
 * datasets, and nothing else. It answers by querying, not by recalling: every
 * number it states should have come back from a tool in the same turn.
 *
 * Shape of a turn: the browser POSTs the conversation to /api/ai/chat, this
 * module streams the reply back as Server-Sent Events, and between events it
 * runs whatever tools the model asked for. The loop ends when the model stops
 * asking for tools, or when MAX_STEPS is reached.
 *
 * The API key lives only here, in the process environment. It is never sent to
 * the browser, and the browser cannot reach Anthropic directly.
 */

import Anthropic from "@anthropic-ai/sdk";
import { validateSelect } from "./sqlGuard.mjs";
import { describeTables, LARGE_TABLES } from "./tableNotes.mjs";
import {
  TEAM_MEMORY_TABLE, normaliseSubject, isSearchableSubject, splitByAsker, askerSummary,
} from "./teamMemory.mjs";

export const MODEL = "claude-opus-5";

/** How many tool round-trips one question may take before we stop. */
const MAX_STEPS = 12;

/** Rows and time one query may spend. Both are bounds on cost, not authority. */
const ROW_CAP = 500;
const QUERY_TIMEOUT_MS = 20_000;

/** Where the published static datasets live. */
const SITE_ORIGIN = process.env.SITE_ORIGIN || "https://www.blandfordbloodstock.tech";

/**
 * The site's own pages, so the model can point at one rather than describing
 * where to click. Kept as a flat list because that is how it is used: the model
 * needs the name, what the page is for, and the URL to link to.
 */
const SITE_PAGES = [
  ["Dashboard", "/dashboard/home", "Tracked-horse entries, declarations and early closings for today and the days ahead"],
  ["Daily Watch List", "/dashboard/WatchList", "Today's runners worth watching"],
  ["Review List", "/dashboard/ReviewList", "Horses put up for review, with ratings, and the Enquire action list"],
  ["Tracker", "/dashboard/Tracker", "Every horse, sire, dam, owner and jockey this user follows"],
  ["Client List", "/dashboard/ClientList", "Bloodstock clients, their briefs and scored prospects"],
  ["Reports", "/dashboard/Reports", "Saved analytical reports"],
  ["Race Results", "/dashboard/races", "Results by date and course, with sectionals and stride analysis"],
  ["Racecards", "/dashboard/RacesAndEntries", "Entries and declarations by date"],
  ["France Race Records", "/dashboard/FranceRaceRecords", "French cards and results"],
  ["Sectional Ratings", "/dashboard/SectionalRatings", "The sectional ratings board by region and age"],
  ["Track Pars", "/dashboard/TrackPars", "Course-and-distance pars, finishing speed and stride"],
  ["Find Prospects", "/dashboard/FindProspects", "Search the prospects index"],
  ["Race Prospects", "/dashboard/RaceProspects", "Horses matched to target races"],
  ["Sales", "/dashboard/sales", "Sales catalogues and results"],
  ["Horse Profile", "/dashboard/HorseProfile", "Search for a horse; an individual horse is at /dashboard/horse/<NAME>"],
  ["Stallions", "/dashboard/Stallions", "The stallion directory with crop, stage and fee columns"],
  ["Expected Precocity", "/dashboard/ExpectedPrecocity", "The Sire Precocity Index and its four categories"],
  ["Early Indicators", "/dashboard/EarlyIndicators", "Young-sire first and second season league tables"],
  ["Stud Fees", "/dashboard/StudFee", "Published stud fees and the fee-change model"],
  ["Sire Uplift", "/dashboard/SireUplift", "How a sire lifts the mares he covers"],
  ["Dam Profile", "/dashboard/DamProfile", "Broodmare records"],
  ["Trainer Form", "/dashboard/TrainerForm", "Trainer form and uplift"],
  ["Trainer Uplift", "/dashboard/TrainerUplift", "Horses that improved on joining a yard"],
  ["HIT Sales", "/dashboard/hitsales", "Horses-in-training catalogues: every lot rated and ranked, with Auto List and sales tracking"],
  ["BlandfordAI", "/dashboard/BlandfordAI", "This assistant"],
];

/**
 * The published datasets, by the name the model refers to them by. These are
 * static JSON built by the nightly and weekly jobs and served from the site, so
 * they are the same numbers the pages draw.
 */
const DATASETS = {
  // Sectionals, stride and pars
  "sectionals-index": ["/data/rtv/index.json", "Every meeting with sectional data: date, track, file"],
  "sectional-ratings": ["/data/rtv/ratings.json", "The sectional ratings board, by cohort and 7/30/90-day window"],
  "course-distance-pars": ["/data/rtv/pars.json", "Course-and-distance pars: winning time, finishing speed, stride"],
  "cd-pars": ["/data/rtv/cd-pars.json", "Course-and-distance pars, per-furlong detail"],
  "pars-history": ["/data/rtv/pars-history.json", "How pars have moved over time"],
  "tfr-equivalent": ["/data/rtv/tfr-equivalent.json", "Timeform-equivalent conversion for sectional ratings"],
  "horse-sectional-runs": ["/data/rtv/horses.json", "Which meetings each horse has sectional data in"],

  // Stallions
  "stallions": ["/data/stallions/index.json", "The stallion roster with progeny statistics, fees, crop and stage"],
  "precocity": ["/data/stallions/precocity.json", "Sire Precocity Index, category, par and judgement window"],
  "early-indicators": ["/data/stallions/early.json", "Young-sire first and second season figures"],
  "fee-model": ["/data/stallions/fee-model.json", "Stud fee history and the fee-change model"],
  "stallion-population": ["/data/stallions/population.json", "The stallion population by year and market"],

  // Horses in Training sales. One set per sale: the catalogue with every lot's
  // rating and rank, what the desk has listed and enquired on, and the digest
  // that goes out each morning.
  "hit-sale-tatts-july": ["/data/hitsales/tatts-july-2026/index.json", "Tattersalls July 2026 HIT catalogue: every lot with its rating, rank against the sale and against the GB/IRE/FRA population, pedigree, form and sectionals"],
  "hit-sale-tatts-july-tracking": ["/data/hitsales/tatts-july-2026/tracking.json", "Tattersalls July 2026: the desk's lists, categories and enquiries"],
  "hit-sale-arc": ["/data/hitsales/arc-sale-2026/index.json", "Arqana Arc 2026 HIT catalogue: every lot with its rating and rank"],
  "hit-sale-arc-tracking": ["/data/hitsales/arc-sale-2026/tracking.json", "Arqana Arc 2026: the desk's lists, categories and enquiries"],

  // Prospects
  "prospects": ["/data/prospects/index.json", "The prospects index"],
  "prospect-sires": ["/data/prospects/sires.json", "Sire-level summary across the prospects index"],
  "royal-ascot": ["/data/prospects/royal-ascot.json", "Royal Ascot profiles and pipeline"],
};

/* ------------------------------------------------------------------ tools */

export const TOOLS = [
  {
    name: "list_tables",
    description:
      "List the database tables that can be read, with a one-line note on what each holds. " +
      "Call this first when you are not certain which table answers the question.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "describe_table",
    description:
      "Show a table's columns and types, plus up to three example rows so you can see how the " +
      "values are actually written. Always describe a table before writing a query against it " +
      "for the first time - column names and date formats in this warehouse are not guessable.",
    input_schema: {
      type: "object",
      properties: { table: { type: "string", description: "Table name, exactly as list_tables gives it." } },
      required: ["table"],
    },
  },
  {
    name: "query_database",
    description:
      "Run one read-only SQL query (MySQL) and get the rows back as JSON. SELECT or WITH only; " +
      `at most ${ROW_CAP} rows come back, so aggregate in SQL rather than pulling rows and counting ` +
      "them yourself. Joins, GROUP BY, window functions and CTEs are all available. If a query is " +
      "rejected or returns nothing, describe_table the tables involved and look at the example rows " +
      "before trying again.",
    input_schema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "A single SELECT or WITH statement, no trailing semicolon." },
        purpose: { type: "string", description: "One short line on what this query is for; shown to the user." },
      },
      required: ["sql"],
    },
  },
  {
    name: "get_dataset",
    description:
      "Fetch one of the site's published JSON datasets - the sectional, pars, stallion and prospects " +
      "data that the pages themselves draw. Use this for anything sectional, stride, par, precocity or " +
      "stallion-roster related; that data is built by the scheduled jobs and does not live in the database.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", enum: Object.keys(DATASETS), description: "Which dataset." },
        path: {
          type: "string",
          description:
            "Optional dot/bracket path into the JSON, to avoid pulling a large file whole - " +
            'for example "meetings[0]" or "windows.w7". Omit for the top of the file.',
        },
      },
      required: ["name"],
    },
  },
  {
    name: "team_activity",
    description:
      "What the rest of the team has recently asked BlandfordAI about. Pass a subject - a horse, " +
      "sire, dam, trainer, owner, course or sale - and get back the questions colleagues put about " +
      "it, who asked, and when; omit the subject to see what the desk has been asking about lately. " +
      "This is the one thing you know that the warehouse does not, so call it whenever a question " +
      "names something specific. Two people working the same horse from different ends is worth " +
      "saying out loud.",
    input_schema: {
      type: "object",
      properties: {
        subject: {
          type: "string",
          description:
            "The name to look for, as written - country suffixes and case do not matter. " +
            "Leave empty for the desk's recent questions generally.",
        },
        days: { type: "number", description: "How far back to look. Default 90." },
      },
      required: [],
    },
  },
  {
    name: "list_site_pages",
    description:
      "List the pages of the platform with their URLs, so you can link the user straight to the " +
      "screen that shows what you have just described.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
];

/* -------------------------------------------------------------- execution */

const asRows = (results) => (Array.isArray(results) ? results : []);

/** Promise wrapper over the callback pool, with a per-query timeout. */
function runQuery(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`Query exceeded ${QUERY_TIMEOUT_MS / 1000}s and was abandoned.`));
    }, QUERY_TIMEOUT_MS);

    db.query(sql, params, (err, results) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(asRows(results));
    });
  });
}

/** Read a dotted/bracketed path out of a parsed JSON value. */
function pick(value, path) {
  if (!path) return value;
  let at = value;
  for (const part of String(path).replace(/\[(\d+)\]/g, ".$1").split(".")) {
    if (!part) continue;
    if (at === null || at === undefined) return undefined;
    at = at[part];
  }
  return at;
}

/**
 * Trim a tool result to something worth sending back. A 26 MB dataset in a tool
 * result is 26 MB of context; the model gets the shape and a slice, and is told
 * that is what happened so it can ask for a narrower path.
 */
function summariseValue(value, limit = 60_000) {
  const json = JSON.stringify(value);
  if (json === undefined) return "null";
  if (json.length <= limit) return json;

  if (Array.isArray(value)) {
    const head = [];
    let used = 0;
    for (const item of value) {
      const piece = JSON.stringify(item);
      if (used + piece.length > limit) break;
      head.push(item);
      used += piece.length + 1;
    }
    return JSON.stringify({
      truncated: true,
      note: `Array of ${value.length} items, too large to return whole. First ${head.length} shown. Use the path argument to fetch a narrower slice.`,
      items: head,
    });
  }

  if (value && typeof value === "object") {
    return JSON.stringify({
      truncated: true,
      note: "Object too large to return whole. These are its keys; use the path argument to fetch one.",
      keys: Object.keys(value),
    });
  }

  return json.slice(0, limit);
}

async function fetchDataset(name, path) {
  const entry = DATASETS[name];
  if (!entry) throw new Error(`Unknown dataset "${name}".`);
  const res = await fetch(`${SITE_ORIGIN}${entry[0]}`, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Dataset "${name}" returned HTTP ${res.status}.`);
  const json = await res.json();
  const picked = pick(json, path);
  if (picked === undefined) {
    throw new Error(
      `Path "${path}" is not present in "${name}". ` +
      `The top-level keys are: ${Object.keys(json || {}).join(", ") || "(an array)"}.`,
    );
  }
  return picked;
}

/**
 * Run one tool the model asked for. Errors come back as tool results rather
 * than exceptions: a rejected query is something the model should read and
 * correct, not something that should end the conversation.
 */
export async function runTool({ name, input }, { db, allowedTables, userId }) {
  try {
    if (name === "list_tables") {
      const tables = describeTables(allowedTables);
      return {
        content: JSON.stringify({
          tables,
          note:
            "A table marked large will not survive an unbounded scan - bound it by date. " +
            "A table with no note is one nobody has described yet; describe_table it before use.",
        }),
        meta: { rowCount: tables.length },
      };
    }

    if (name === "describe_table") {
      const table = String(input?.table || "").trim();
      const check = validateSelect(`SELECT 1 FROM \`${table}\``, allowedTables);
      if (!check.ok) return { content: check.error, is_error: true };

      const [columns, sample] = await Promise.all([
        runQuery(db, `SHOW COLUMNS FROM \`${table}\``),
        runQuery(db, `SELECT * FROM \`${table}\` LIMIT 3`),
      ]);
      return {
        content: JSON.stringify({
          table,
          columns: columns.map((c) => ({ name: c.Field, type: c.Type, nullable: c.Null === "YES" })),
          example_rows: sample,
        }),
      };
    }

    if (name === "query_database") {
      const check = validateSelect(input?.sql, allowedTables);
      if (!check.ok) return { content: check.error, is_error: true };

      // The cap is applied by wrapping rather than by editing the model's SQL,
      // so an ORDER BY or a LIMIT it wrote is honoured and the cap still holds.
      const capped = `SELECT * FROM (${check.sql}) AS blandford_ai_result LIMIT ${ROW_CAP}`;
      const rows = await runQuery(db, capped);
      return {
        content: JSON.stringify({
          row_count: rows.length,
          capped: rows.length === ROW_CAP ? `Stopped at the ${ROW_CAP}-row cap; there may be more.` : undefined,
          rows,
        }),
        meta: { tables: check.tables, rowCount: rows.length },
      };
    }

    if (name === "get_dataset") {
      const value = await fetchDataset(input?.name, input?.path);
      return { content: summariseValue(value) };
    }

    if (name === "team_activity") {
      const subject = normaliseSubject(input?.subject);
      // A nonsense window must fall back to the default, not clamp to one day:
      // days: -5 clamping to 1 would have the assistant report that nobody
      // asked, when somebody did.
      const asked = Number(input?.days);
      const days = Number.isFinite(asked) && asked >= 1 ? Math.min(asked, 365) : 90;

      if (subject && !isSearchableSubject(subject)) {
        return {
          content: `"${input?.subject}" is too short to search the team's questions with; it would match almost everything.`,
          is_error: true,
        };
      }

      // Parameterised, and LIKE-escaped: a horse called "100%" must not turn
      // into a wildcard that matches the whole table.
      const like = `%${subject.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const rows = subject
        ? await runQuery(
            db,
            `SELECT user_id, question, asked_at FROM \`${TEAM_MEMORY_TABLE}\`
             WHERE question LIKE ? AND asked_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
             ORDER BY asked_at DESC LIMIT 40`,
            [like, days],
          )
        : await runQuery(
            db,
            `SELECT user_id, question, asked_at FROM \`${TEAM_MEMORY_TABLE}\`
             WHERE asked_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
             ORDER BY asked_at DESC LIMIT 40`,
            [days],
          );

      const { colleagues, you } = splitByAsker(rows, { userId });
      return {
        content: JSON.stringify({
          subject: subject || null,
          window_days: days,
          colleagues,
          who: askerSummary(colleagues),
          your_own_earlier_questions: you,
          note: colleagues.length
            ? undefined
            : "Nobody else on the desk has asked about this in the window. Say nothing about it rather than reporting the absence.",
        }),
        meta: { rowCount: rows.length },
      };
    }

    if (name === "list_site_pages") {
      return {
        content: JSON.stringify({
          origin: SITE_ORIGIN,
          note: "Link as <origin>/#<path> - the app uses hash routing.",
          pages: SITE_PAGES.map(([pageName, path, purpose]) => ({ name: pageName, path, purpose })),
        }),
      };
    }

    return { content: `Unknown tool "${name}".`, is_error: true };
  } catch (err) {
    return { content: `${name} failed: ${err.message}`, is_error: true };
  }
}

/* ---------------------------------------------------------- system prompt */

export function systemPrompt({ userId, today }) {
  return `You are BlandfordAI, the analyst built into the Blandford Bloodstock platform. You are talking to ${userId || "a member of the team"}, inside the app, on ${today}.

They are bloodstock professionals: agents, analysts and advisers who buy, sell, track and assess thoroughbreds. Write for them. Racing shorthand is fine and welcome - a 2yo, black type, a Group 1, an official rating, a sectional, a par. Do not explain what a stallion is.

## How you answer

Answer from the data, not from memory. Every figure you state must have come back from a tool in this same conversation. You have a read-only view of the platform's own warehouse and of the datasets its pages are built from; use them.

Get to the answer in few steps. list_tables gives you every table with a one-line note on what it holds - read it once and pick the one table that answers the question, rather than describing your way through the schema. Most questions about how a horse ran are answered by APIData_Table2 alone. Describe only the table you are about to query, and only the first time you use it in this conversation.

Then describe_table it, because the column names and date formats here are genuinely not guessable - dates appear both as "2026-09-08" and as "Tuesday 8  September 2026" (with a double space), horse names carry country suffixes, and several tables hold the same concept under different column names. Look at the example rows.

Aggregate in SQL. You get ${ROW_CAP} rows back at most, so COUNT, SUM, AVG and GROUP BY belong in the query, not in your head.

Bound every query on a large table. list_tables marks which they are. A GROUP BY across the whole of one of them is a full scan and will hit the ${QUERY_TIMEOUT_MS / 1000}s timeout - the query is abandoned and you have spent a step for nothing. Put a date range in the WHERE clause, and filter on the column as it is stored rather than wrapping it in a function, which stops an index being used.

If a step fails, do not repeat it in another form. A timed-out query will time out again; a dataset that 404s will 404 again. Change what you are asking for, or say what is not available.

When a query comes back empty, that is information: say so, say what you searched, and suggest what might be wrong (a name spelled differently, a date outside the range the table holds) rather than silently trying six more variations.

## Advise, do not just answer

You are the desk's adviser, not its query engine. The question asked is the starting point, not the boundary. Having answered it, say the thing a good colleague would say next - and only when you actually have it, never as a habit:

- **Who else is on it.** You are the only one who can see what the whole desk has been asking. Whenever a question names something specific - a horse, a sire, a dam, a trainer, an owner, a course, a sale - call team_activity for it. If a colleague has asked about the same thing recently, say so plainly and early: "Stuart asked about him on Monday." Name the person, say when, and say what they were after. Two people working the same horse from different ends is worth knowing, and neither of them can see it without you.
- **What connects.** Relate the answer to what this platform already holds about them: whether the horse is on their tracker and why, whether it is entered in the days ahead, whether it is in a sale catalogue, whether the sire came up in another question. A fact that connects to their own book is worth more than a better fact that does not.
- **What follows.** If the answer implies a next step - a race that fits, a lot worth a look, a page that shows the rest - say it in a line. One recommendation, not a list of options.

Do not manufacture a connection. If nobody else has asked and nothing else lines up, answer the question and stop; announcing that you found nothing is worse than saying nothing.

## What to say

Lead with the answer. A bloodstock agent asking "how has Kodiac's second crop gone" wants the finding first and the working second, if at all.

Use a small markdown table when you are comparing more than about three things across more than one measure. Otherwise write sentences.

Cite where a number came from when it is not obvious - the table you read, or the dataset. When a page in the app shows what you have just described, link it: the app uses hash routing, so a link is ${SITE_ORIGIN}/#/dashboard/Stallions and an individual horse is ${SITE_ORIGIN}/#/dashboard/horse/<NAME>.

Be honest about the limits of what you found. If a figure rests on 4 runners, say it rests on 4 runners. If two sources in the warehouse disagree, say they disagree rather than picking the one that reads better. If you could not answer, say what stopped you.

Do not pad. No "Great question", no restating the question back, no summary of what you are about to do.

## What you cannot do

You can only read. There is no tool here that changes anything - you cannot add a horse to a tracker, place an enquiry, or edit a record. If someone asks for that, tell them which page does it and link them to it.

You cannot see the wider internet, only this platform's data.`;
}

/**
 * Turn a configuration failure into a sentence that says what to do about it.
 *
 * The raw API message for an unscoped key is accurate and useless to the person
 * who sees it: it names a header, in a product that has none, on the screen
 * where they asked about a horse. Everything else is passed through unchanged -
 * inventing friendly text for errors we have not seen hides real ones.
 */
export function explainAgentError(err) {
  const raw = String(err?.message || "");
  if (/not scoped to a workspace|anthropic-workspace-id/i.test(raw)) {
    return (
      "BlandfordAI's API key is not tied to a workspace, so Anthropic will not " +
      "run the request. Either set ANTHROPIC_WORKSPACE_ID on the backend to the " +
      "workspace the key should bill to, or replace the key with one created " +
      "inside a workspace, then redeploy."
    );
  }
  if (/credit balance|insufficient.*quota|billing/i.test(raw)) {
    return "Anthropic refused the request for a billing reason: " + raw;
  }
  return raw || "The assistant failed to answer.";
}

/* ------------------------------------------------------------------- loop */

let client = null;

/**
 * An Anthropic API key belongs either to one workspace or to none. A key with
 * no workspace cannot infer which one to bill and rejects every request with
 *
 *   "This API key is not scoped to a workspace, so this request must include
 *    the anthropic-workspace-id header"
 *
 * which arrives as a 400 on the first question anyone asks, long after the key
 * looked correctly configured. ANTHROPIC_WORKSPACE_ID names the workspace for
 * an unscoped key; a key that is already scoped to one needs nothing and
 * ignores the variable if it is set anyway.
 */
export function anthropicClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set on this service, so BlandfordAI cannot run. " +
      "Add it to the backend's environment variables and redeploy.",
    );
  }
  if (!client) {
    const workspace = String(process.env.ANTHROPIC_WORKSPACE_ID || "").trim();
    client = new Anthropic(
      workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {},
    );
  }
  return client;
}

/** Cleared between tests, and after a configuration change in a long-lived process. */
export function resetAnthropicClient() {
  client = null;
}

/**
 * Drive one user turn to completion, calling `emit(event, data)` as things
 * happen. Events: `text` (a delta), `tool` (a tool starting), `tool_done`,
 * `done`, `error`.
 */
export async function runTurn({ messages, userId, db, allowedTables, emit, signal }) {
  const anthropic = anthropicClient();
  const system = [
    {
      type: "text",
      text: systemPrompt({ userId, today: new Date().toISOString().slice(0, 10) }),
      // The system prompt and the tool list are identical on every turn, so
      // they are the stable prefix worth caching; the conversation follows.
      cache_control: { type: "ephemeral" },
    },
  ];

  const working = [...messages];

  for (let step = 0; step < MAX_STEPS; step++) {
    if (signal?.aborted) return { stopped: "aborted" };

    const stream = anthropic.messages.stream(
      {
        model: MODEL,
        max_tokens: 16000,
        system,
        tools: TOOLS,
        messages: working,
        thinking: { type: "adaptive" },
        output_config: { effort: "high" },
      },
      { signal },
    );

    stream.on("text", (delta) => emit("text", { delta }));

    const response = await stream.finalMessage();
    working.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      return { stopped: response.stop_reason, usage: response.usage, messages: working };
    }

    const calls = response.content.filter((b) => b.type === "tool_use");

    // Parallel calls come back in one assistant message and their results must
    // go back in one user message, or the model learns to stop making them.
    const results = await Promise.all(
      calls.map(async (call) => {
        emit("tool", { id: call.id, name: call.name, input: call.input });
        const out = await runTool(call, { db, allowedTables, userId });
        emit("tool_done", {
          id: call.id,
          name: call.name,
          ok: !out.is_error,
          rowCount: out.meta?.rowCount,
          error: out.is_error ? out.content : undefined,
        });
        return {
          type: "tool_result",
          tool_use_id: call.id,
          content: out.content,
          ...(out.is_error ? { is_error: true } : {}),
        };
      }),
    );

    working.push({ role: "user", content: results });
  }

  return { stopped: "max_steps", messages: working };
}

export const AI_LIMITS = { MAX_STEPS, ROW_CAP, QUERY_TIMEOUT_MS };
export const AI_SITE_PAGES = SITE_PAGES;
export const AI_DATASETS = DATASETS;

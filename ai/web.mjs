/**
 * BlandfordAI's view of the wider internet.
 *
 * Two tools, both run by Anthropic rather than by this service: web_search,
 * which searches the web and hands back the results, and web_fetch, which reads
 * one page whose address is already in the conversation. Both run inside the
 * model call - the results come back as content blocks in the same response -
 * so there is nothing here to execute. What this module does is decide which
 * of them are on offer, bound what they may spend, and turn what they did into
 * the same tool notices the page already shows for a database query.
 *
 * The web is the second place the assistant looks, never the first. Keeping it
 * there is the system prompt's job (agent.mjs). This module's job is that when
 * it does look, the reader can see where it looked and what each web claim
 * rests on: every search and every page read appears in the step trace, and
 * every cited page reaches the browser as a source it can click.
 */

/** Searches and page reads one model call may make. Bounds on cost, not authority. */
export const WEB_SEARCH_MAX_USES = 5;
export const WEB_FETCH_MAX_USES = 5;

/**
 * A page longer than this is cut short, so one long article cannot fill the
 * context. It applies to text; a PDF comes back whole.
 */
export const WEB_FETCH_MAX_CONTENT_TOKENS = 20_000;

/**
 * Both tools are called directly rather than from code execution. The
 * `_20260209` versions default to "dynamic filtering", where the model writes
 * code that sifts the results before it reads them - cheaper on long research,
 * but what the model then reads is its own code's output rather than the
 * pages, and the citations that tie each web claim to its page are the point
 * here. Direct calls keep every result in front of the model and every claim
 * citable.
 *
 * Results are localised to Britain: the desk works the British, Irish and
 * French markets, and "Kodiac fee" should find Tally-Ho before a namesake.
 */
const DEFINITIONS = {
  web_search: {
    type: "web_search_20260209",
    name: "web_search",
    max_uses: WEB_SEARCH_MAX_USES,
    allowed_callers: ["direct"],
    user_location: { type: "approximate", country: "GB", timezone: "Europe/London" },
  },
  web_fetch: {
    type: "web_fetch_20260209",
    name: "web_fetch",
    max_uses: WEB_FETCH_MAX_USES,
    max_content_tokens: WEB_FETCH_MAX_CONTENT_TOKENS,
    allowed_callers: ["direct"],
  },
};

export const WEB_TOOL_NAMES = Object.keys(DEFINITIONS);

/**
 * AI_WEB decides how much of the web the assistant gets: unset or "on" is
 * both tools, "search" is search alone (it can find and cite pages but not
 * open one), and "off" is neither.
 */
function configured() {
  const setting = String(process.env.AI_WEB ?? "").trim().toLowerCase();
  if (["off", "none", "no", "false", "0"].includes(setting)) return [];
  if (setting === "search") return ["web_search"];
  return [...WEB_TOOL_NAMES];
}

/* --------------------------------------------------------------- refusals */

/**
 * Web search and web fetch can each be switched off for the whole Anthropic
 * organisation, in the Console. A request that carries a switched-off tool is
 * not answered with an error inside a result, it is refused outright - a 400
 * before a word is written. Without this, one Console setting would take down
 * every question BlandfordAI answers, the database questions included.
 *
 * So a refused tool is dropped and the question asked again without it, and
 * it stays dropped for a while rather than costing every question a refusal.
 * After that it is offered again, in case the setting has been changed.
 */
const REFUSAL_TTL_MS = 10 * 60_000;

const refusals = new Map(); // tool name -> { at, reason }

function refusedNow(name, now = Date.now()) {
  const refusal = refusals.get(name);
  if (!refusal) return null;
  if (now - refusal.at > REFUSAL_TTL_MS) {
    refusals.delete(name);
    return null;
  }
  return refusal;
}

/** The web tools to send with the next model call. */
export function webTools() {
  return configured()
    .filter((name) => !refusedNow(name))
    .map((name) => DEFINITIONS[name]);
}

/**
 * Which of the tools just offered a failed request refused, if that is what
 * the failure was. A 400 that names web search or web fetch is taken as the
 * tool being unusable here, whatever the exact wording - the alternative is
 * that the whole assistant stays down until someone reads the logs. Anything
 * else is somebody else's failure and is left alone.
 */
export function refusedWebTools(err, offered) {
  if (err?.status !== 400) return [];
  const message = String(err?.message || "");
  return offered
    .map((tool) => tool.name)
    .filter((name) => new RegExp(name.replace("_", "[ _]"), "i").test(message));
}

/** Remember a refusal, so the next question does not ask for it again. */
export function noteWebRefusal(names, err) {
  const reason = String(err?.error?.error?.message || err?.message || "refused").slice(0, 300);
  for (const name of names) refusals.set(name, { at: Date.now(), reason });
}

/** Cleared between tests. */
export function resetWebRefusals() {
  refusals.clear();
}

/** What /api/ai/status reports: which web tools the next question will get, and why not. */
export function webStatus() {
  const wanted = configured();
  const refused = wanted
    .map((name) => [name, refusedNow(name)])
    .filter(([, refusal]) => refusal)
    .map(([name, refusal]) => ({
      tool: name,
      reason: refusal.reason,
      since: new Date(refusal.at).toISOString(),
    }));
  const offered = webTools().map((tool) => tool.name);
  return {
    search: offered.includes("web_search"),
    fetch: offered.includes("web_fetch"),
    ...(refused.length ? { refused } : {}),
  };
}

/* ------------------------------------------------------- what the page sees */

/**
 * Error codes as the reader should see them. A failed search is not a failed
 * answer: the model reads the same code and carries on without it.
 */
const WEB_ERRORS = {
  max_uses_exceeded: "hit the limit for this step",
  too_many_requests: "rate-limited, try again shortly",
  query_too_long: "the search was too long",
  request_too_large: "the search was too large",
  invalid_tool_input: "the request was malformed",
  unavailable: "the service was unavailable",
  url_not_accessible: "the page could not be reached",
  url_not_allowed: "that site cannot be read",
  url_not_in_prior_context: "only a link already in the conversation can be opened",
  url_too_long: "the link is too long",
  unsupported_content_type: "that kind of file cannot be read",
};

const describeError = (code) => WEB_ERRORS[code] || String(code || "failed");

/**
 * A server tool call, as a `tool` notice. The query or the address is all the
 * reader needs to see what was looked for; anything else in the input is not
 * theirs to read.
 */
export function serverToolStarted(block) {
  const input = {};
  if (typeof block?.input?.query === "string") input.query = block.input.query;
  if (typeof block?.input?.url === "string") input.url = block.input.url;
  return { id: block.id, name: block.name, input };
}

const SEARCH_RESULTS_SHOWN = 10;

/**
 * A server tool result, as the `tool_done` notice for the call it answers.
 *
 * A failure is an object where a success is a list (search) or a page (fetch),
 * and the API reports it with a 200 - the request did not fail, one tool call
 * inside it did.
 */
export function serverToolFinished(block) {
  const id = block.tool_use_id;
  const content = block.content;

  if (block.type === "web_search_tool_result") {
    if (Array.isArray(content)) {
      return {
        id,
        name: "web_search",
        ok: true,
        rowCount: content.length,
        results: content.slice(0, SEARCH_RESULTS_SHOWN).map((r) => ({
          title: r.title || "",
          url: r.url,
          ...(r.page_age ? { age: r.page_age } : {}),
        })),
      };
    }
    return { id, name: "web_search", ok: false, error: describeError(content?.error_code) };
  }

  if (block.type === "web_fetch_tool_result") {
    if (content?.type === "web_fetch_result") {
      return {
        id,
        name: "web_fetch",
        ok: true,
        url: content.url,
        title: content.content?.title || "",
      };
    }
    return { id, name: "web_fetch", ok: false, error: describeError(content?.error_code) };
  }

  // A server tool this module does not describe. It finished; say that much.
  const failed = content && !Array.isArray(content) && /error/.test(String(content.type || ""));
  return {
    id,
    name: String(block.type || "").replace(/_tool_result$/, ""),
    ok: !failed,
    ...(failed ? { error: describeError(content.error_code) } : {}),
  };
}

/** Whether a finished content block is a server tool's result. */
export const isServerToolResult = (block) =>
  typeof block?.tool_use_id === "string" && /_tool_result$/.test(String(block?.type || ""));

/**
 * The web pages a finished text block cites, once each, in the order cited.
 *
 * The API splits the answer into text blocks at every citation, so a block
 * with citations is exactly the words those pages support; the page puts its
 * marks straight after them. Only http(s) addresses are passed on - nothing
 * else is a page anybody should be sent to.
 */
export function citedSources(block) {
  const seen = new Map();
  for (const c of block?.citations || []) {
    const url = typeof c?.url === "string" ? c.url : "";
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.set(url, {
      url,
      title: c.title || "",
      ...(c.cited_text ? { quote: String(c.cited_text) } : {}),
    });
  }
  return [...seen.values()];
}

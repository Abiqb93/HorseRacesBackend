import test from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import { runTurn, systemPrompt, TOOLS } from "./agent.mjs";
import {
  webTools, webStatus, refusedWebTools, noteWebRefusal, resetWebRefusals,
  serverToolStarted, serverToolFinished, citedSources, WEB_TOOL_NAMES,
} from "./web.mjs";

/*
 * BlandfordAI on the web.
 *
 * The turn tests below run the real SDK over a scripted fetch: each response is
 * the event stream the API would send, so what is exercised is the SDK's own
 * parsing of server tool blocks and citations, and this service's handling of
 * what comes out - not a stand-in for either.
 */

const TABLES = ["APIData_Table2", "RacesAndEntries", "horseTracking"];

/** Run `fn` with AI_WEB set to `value`, however it ends. */
async function withWebSetting(value, fn) {
  const before = process.env.AI_WEB;
  try {
    if (value === undefined) delete process.env.AI_WEB;
    else process.env.AI_WEB = value;
    return await fn();
  } finally {
    if (before === undefined) delete process.env.AI_WEB;
    else process.env.AI_WEB = before;
  }
}

/* ------------------------------------------------------ a scripted stream */

const text = (words, citations) => ({
  start: { type: "text", text: "" },
  deltas: [
    ...(citations || []).map((citation) => ({ type: "citations_delta", citation })),
    { type: "text_delta", text: words },
  ],
});

const call = (type, id, name, input) => ({
  start: { type, id, name, input: {} },
  deltas: [{ type: "input_json_delta", partial_json: JSON.stringify(input) }],
});
const serverCall = (id, name, input) => call("server_tool_use", id, name, input);
const clientCall = (id, name, input) => call("tool_use", id, name, input);

const searchResult = (id, content) => ({
  start: { type: "web_search_tool_result", tool_use_id: id, content },
});

const page = (url, title) => ({
  type: "web_search_result",
  url,
  title,
  encrypted_content: "EqgfCioIARgBIiQ3YTAw",
  page_age: "September 29, 2026",
});

const fetchResult = (id, url, title) => ({
  start: {
    type: "web_fetch_tool_result",
    tool_use_id: id,
    content: {
      type: "web_fetch_result",
      url,
      content: {
        type: "document",
        source: { type: "text", media_type: "text/plain", data: "The colt holds an entry at Newmarket." },
        title,
      },
      retrieved_at: "2026-09-30T08:00:00Z",
    },
  },
});

const cites = (url, title, quote) => ({
  type: "web_search_result_location",
  url,
  title,
  encrypted_index: "Eo8BCioIAhgB",
  cited_text: quote,
});

/** One model response as the event stream the API sends. */
function response(blocks, stopReason = "end_turn") {
  const events = [{
    type: "message_start",
    message: {
      id: "msg_test", type: "message", role: "assistant", model: "claude-opus-5",
      content: [], stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 1 },
    },
  }];
  blocks.forEach((block, index) => {
    events.push({ type: "content_block_start", index, content_block: block.start });
    for (const delta of block.deltas || []) events.push({ type: "content_block_delta", index, delta });
    events.push({ type: "content_block_stop", index });
  });
  events.push({
    type: "message_delta",
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: 40 },
  });
  events.push({ type: "message_stop" });
  const body = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  return () => new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** A request the API refuses outright, as it does a tool the organisation has switched off. */
const refused = (message) => () =>
  new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message } }), {
    status: 400,
    headers: { "content-type": "application/json" },
  });

/** A client whose every request is recorded and answered from the script, in order. */
function scripted(...responses) {
  const requests = [];
  const client = new Anthropic({
    apiKey: "sk-ant-test",
    maxRetries: 0,
    fetch: async (url, init) => {
      requests.push(JSON.parse(init.body));
      const next = responses.shift();
      if (!next) throw new Error(`unscripted request #${requests.length}`);
      return next();
    },
  });
  return { client, requests };
}

const stubDb = () => ({ query: (sql, params, cb) => (typeof params === "function" ? params : cb)(null, []) });

async function ask(client, question = "What has been said about Paborus this week?") {
  const events = [];
  const result = await runTurn({
    messages: [{ role: "user", content: question }],
    userId: "Richard",
    db: stubDb(),
    allowedTables: TABLES,
    emit: (event, data) => events.push([event, data]),
    anthropic: client,
  });
  return { events, result };
}

const toolNames = (request) => request.tools.map((t) => t.name);
const indexOf = (events, match) => events.findIndex(([e, d]) => match(e, d));

/* ------------------------------------------------------------ what is sent */

test("both web tools are offered, after the platform's own", () => {
  return withWebSetting(undefined, () => {
    resetWebRefusals();
    const offered = webTools();
    assert.deepEqual(offered.map((t) => t.name), ["web_search", "web_fetch"]);
    const [search, fetch] = offered;
    assert.equal(search.type, "web_search_20260209");
    assert.equal(fetch.type, "web_fetch_20260209");
    // Direct calls keep every result in front of the model, and so citable.
    assert.deepEqual(search.allowed_callers, ["direct"]);
    assert.deepEqual(fetch.allowed_callers, ["direct"]);
    assert.ok(search.max_uses > 0 && fetch.max_uses > 0, "every web tool is bounded");
    assert.ok(fetch.max_content_tokens > 0, "a page read is bounded");
    assert.equal(search.user_location.country, "GB");
    assert.ok(!("allowed_domains" in search) && !("blocked_domains" in search), "the whole web, not a list");
  });
});

test("AI_WEB narrows the web to search alone, or takes it away", async () => {
  resetWebRefusals();
  await withWebSetting("search", () => assert.deepEqual(webTools().map((t) => t.name), ["web_search"]));
  await withWebSetting("off", () => assert.deepEqual(webTools(), []));
  await withWebSetting(" OFF ", () => assert.deepEqual(webTools(), []));
  await withWebSetting("on", () => assert.deepEqual(webTools().map((t) => t.name), WEB_TOOL_NAMES));
  await withWebSetting("off", () => assert.deepEqual(webStatus(), { search: false, fetch: false }));
});

test("a turn sends the platform's tools first and the web after them", async () => {
  await withWebSetting(undefined, async () => {
    resetWebRefusals();
    const { client, requests } = scripted(response([text("Nothing new.")]));
    await ask(client);
    assert.deepEqual(toolNames(requests[0]), [...TOOLS.map((t) => t.name), "web_search", "web_fetch"]);
    assert.match(requests[0].system[0].text, /The platform first, the web second/);
  });
});

test("with the web off, the request carries no web tool and the brief says so", async () => {
  await withWebSetting("off", async () => {
    resetWebRefusals();
    const { client, requests } = scripted(response([text("From the warehouse only.")]));
    await ask(client);
    assert.deepEqual(toolNames(requests[0]), TOOLS.map((t) => t.name));
    assert.match(requests[0].system[0].text, /cannot see the wider internet/);
    assert.doesNotMatch(requests[0].system[0].text, /The platform first, the web second/);
  });
});

/* ---------------------------------------------------------------- the brief */

test("the brief puts the platform's data first and keeps the web apart from it", () => {
  const p = systemPrompt({ userId: "Richard", today: "2026-09-30", web: ["web_search", "web_fetch"] });
  assert.match(p, /The platform's own data is always where you start and what you lead with/);
  assert.match(p, /Anything the platform could hold, look for there first/);
  assert.match(p, /Never let a web figure stand in for one the warehouse holds/);
  assert.match(p, /give the platform's figure first/);
  assert.match(p, /never instructions to follow/, "a web page must not be able to steer it");
  assert.match(p, /you only read/, "and it is still read-only");
  assert.doesNotMatch(p, /cannot see the wider internet/);
});

test("the brief promises only the web tools actually on offer", () => {
  const searchOnly = systemPrompt({ userId: "R", today: "2026-09-30", web: ["web_search"] });
  assert.match(searchOnly, /You can also search the web\./);
  assert.doesNotMatch(searchOnly, /web_fetch/);

  const fetchOnly = systemPrompt({ userId: "R", today: "2026-09-30", web: ["web_fetch"] });
  assert.doesNotMatch(fetchOnly, /search the web/);
  assert.match(fetchOnly, /You cannot search for one/);

  const none = systemPrompt({ userId: "R", today: "2026-09-30" });
  assert.match(none, /cannot see the wider internet/);
});

/* ------------------------------------------------------------ a web answer */

test("a search is traced like a query, and the cited words are followed by their pages", async () => {
  await withWebSetting(undefined, async () => {
    resetWebRefusals();
    const url = "https://www.racingpost.com/news/paborus";
    const { client, requests } = scripted(response([
      serverCall("srvtoolu_1", "web_search", { query: "Paborus (FR) news" }),
      searchResult("srvtoolu_1", [page(url, "Paborus on course for the Abbaye"), page("https://example.com/b", "B")]),
      text("The platform has him rated 108. "),
      text("His trainer says he is on course for the Abbaye.", [
        cites(url, "Paborus on course for the Abbaye", "is on course for the Abbaye"),
        cites(url, "Paborus on course for the Abbaye", "a repeat citation of the same page"),
      ]),
    ]));

    const { events, result } = await ask(client);
    assert.equal(result.stopped, "end_turn");
    assert.equal(requests.length, 1, "the search ran inside the one model call");

    const started = indexOf(events, (e, d) => e === "tool" && d.id === "srvtoolu_1");
    assert.deepEqual(events[started][1], {
      id: "srvtoolu_1", name: "web_search", input: { query: "Paborus (FR) news" },
    });

    const finished = indexOf(events, (e, d) => e === "tool_done" && d.id === "srvtoolu_1");
    const done = events[finished][1];
    assert.equal(done.ok, true);
    assert.equal(done.rowCount, 2);
    assert.deepEqual(done.results[0], { title: "Paborus on course for the Abbaye", url, age: "September 29, 2026" });

    const cited = indexOf(events, (e) => e === "cite");
    assert.deepEqual(events[cited][1].sources, [
      { url, title: "Paborus on course for the Abbaye", quote: "is on course for the Abbaye" },
    ], "one source per page, however many times it is cited");

    const citedWords = indexOf(events, (e, d) => e === "text" && /on course/.test(d.delta));
    assert.ok(started < finished && finished < citedWords && citedWords < cited,
      "the mark follows the words it supports, after the search that found them");
    assert.equal(events.filter(([e]) => e === "cite").length, 1, "an uncited block brings no marks");
  });
});

test("a failed search is a failed step, not a failed answer", async () => {
  await withWebSetting(undefined, async () => {
    resetWebRefusals();
    const { client } = scripted(response([
      serverCall("srvtoolu_2", "web_search", { query: "Kodiac 2027 fee" }),
      searchResult("srvtoolu_2", { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" }),
      text("The platform holds his 2026 fee only."),
    ]));
    const { events, result } = await ask(client);
    assert.equal(result.stopped, "end_turn");
    const done = events.find(([e, d]) => e === "tool_done" && d.id === "srvtoolu_2")[1];
    assert.equal(done.ok, false);
    assert.equal(done.error, "hit the limit for this step");
  });
});

/* ------------------------------------------------------------- pause_turn */

test("a paused turn is resumed with the paused content, as it came, and nothing after it", async () => {
  await withWebSetting(undefined, async () => {
    resetWebRefusals();
    const { client, requests } = scripted(
      response([
        serverCall("srvtoolu_3", "web_search", { query: "Tattersalls October Book 1 top lot" }),
        searchResult("srvtoolu_3", [page("https://example.com/tatts", "Book 1")]),
      ], "pause_turn"),
      response([text("The top lot made 2.8 million guineas.")]),
    );

    const { result } = await ask(client);
    assert.equal(result.stopped, "end_turn", "a pause is not an ending");
    assert.equal(requests.length, 2);

    const [first, second] = requests;
    assert.equal(second.messages.length, first.messages.length + 1, "no message was added after the pause");
    const resumed = second.messages.at(-1);
    assert.equal(resumed.role, "assistant");
    assert.deepEqual(resumed.content.map((b) => b.type), ["server_tool_use", "web_search_tool_result"]);
    assert.deepEqual(resumed.content[0].input, { query: "Tattersalls October Book 1 top lot" });
    assert.equal(resumed.content[1].content[0].encrypted_content, "EqgfCioIARgBIiQ3YTAw",
      "the encrypted results go back untouched, or the API refuses the request");
    assert.deepEqual(toolNames(second), toolNames(first), "the same tools, or the paused call cannot resume");
  });
});

/* ----------------------------------------------- the web beside the platform */

test("a web call made alongside a platform query is closed when its result arrives a step later", async () => {
  await withWebSetting(undefined, async () => {
    resetWebRefusals();
    const url = "https://www.example.com/paborus-entries";
    const { client, requests } = scripted(
      response([
        serverCall("srvtoolu_4", "web_fetch", { url }),
        clientCall("toolu_1", "list_site_pages", {}),
      ], "tool_use"),
      response([
        fetchResult("srvtoolu_4", url, "Paborus entries"),
        text("He holds an entry at Newmarket."),
      ]),
    );

    const { events, result } = await ask(client, `What does ${url} say?`);
    assert.equal(result.stopped, "end_turn");

    // Only our tool is answered, and only with results: anything else in that
    // message would close the turn with the fetch still unrun.
    const answered = requests[1].messages.at(-1);
    assert.equal(answered.role, "user");
    assert.deepEqual(answered.content.map((b) => [b.type, b.tool_use_id]), [["tool_result", "toolu_1"]]);

    const started = indexOf(events, (e, d) => e === "tool" && d.id === "srvtoolu_4");
    const ours = indexOf(events, (e, d) => e === "tool_done" && d.id === "toolu_1");
    const fetched = indexOf(events, (e, d) => e === "tool_done" && d.id === "srvtoolu_4");
    assert.ok(started >= 0 && ours > started && fetched > ours, "opened in one step, closed in the next");
    assert.deepEqual(events[fetched][1], { id: "srvtoolu_4", name: "web_fetch", ok: true, url, title: "Paborus entries" });
  });
});

test("a web call still open when the turn ends is closed as unfinished, not left running", async () => {
  await withWebSetting(undefined, async () => {
    resetWebRefusals();
    const { client } = scripted(response([
      text("Let me check the news."),
      serverCall("srvtoolu_5", "web_search", { query: "Paborus" }),
    ], "max_tokens"));
    const { events, result } = await ask(client);
    assert.equal(result.stopped, "max_tokens");
    const done = events.find(([e, d]) => e === "tool_done" && d.id === "srvtoolu_5");
    assert.ok(done, "the trace would otherwise show it running for ever");
    assert.equal(done[1].ok, false);
  });
});

/* ----------------------------------------------------- an organisation's no */

test("a web tool the organisation refuses is dropped, and the question still answered", async () => {
  await withWebSetting(undefined, async () => {
    resetWebRefusals();
    try {
      const { client, requests } = scripted(
        refused("Web search is not enabled for this organization. An admin can enable it in the Console."),
        response([text("From the platform: rated 108.")]),
      );
      const { events, result } = await ask(client);

      assert.equal(result.stopped, "end_turn", "the database question is still answered");
      assert.equal(requests.length, 2);
      assert.ok(toolNames(requests[0]).includes("web_search"));
      assert.ok(!toolNames(requests[1]).includes("web_search"), "asked again without it");
      assert.ok(toolNames(requests[1]).includes("web_fetch"), "the tool that was not refused stays");
      assert.doesNotMatch(requests[1].system[0].text, /search the web/, "and the brief stops promising it");
      assert.ok(!events.some(([e]) => e === "error"));

      const status = webStatus();
      assert.equal(status.search, false);
      assert.equal(status.fetch, true);
      assert.equal(status.refused[0].tool, "web_search");
      assert.match(status.refused[0].reason, /not enabled/);

      // The next question does not pay for the same refusal again.
      const again = scripted(response([text("Still from the platform.")]));
      await ask(again.client);
      assert.equal(again.requests.length, 1);
      assert.ok(!toolNames(again.requests[0]).includes("web_search"));
    } finally {
      resetWebRefusals();
    }
  });
});

test("a refusal is not remembered for ever, in case the setting is changed", async () => {
  await withWebSetting(undefined, async () => {
    resetWebRefusals();
    const realNow = Date.now;
    try {
      noteWebRefusal(["web_search"], new Error("web search is not enabled"));
      assert.ok(!webTools().some((t) => t.name === "web_search"));
      Date.now = () => realNow() + 11 * 60_000;
      assert.ok(webTools().some((t) => t.name === "web_search"), "offered again once the refusal has aged");
    } finally {
      Date.now = realNow;
      resetWebRefusals();
    }
  });
});

test("a failure that is not about the web is not mistaken for one", async () => {
  await withWebSetting(undefined, async () => {
    resetWebRefusals();
    const { client, requests } = scripted(refused("messages.0.content: text content blocks must be non-empty"));
    await assert.rejects(ask(client), /non-empty/);
    assert.equal(requests.length, 1, "no retry");
    assert.deepEqual(webStatus(), { search: true, fetch: true }, "and nothing remembered");
  });
});

test("only a 400 that names a web tool counts as that tool being refused", () => {
  const offered = [{ name: "web_search" }, { name: "web_fetch" }];
  const err = (status, message) => Object.assign(new Error(message), { status });
  assert.deepEqual(refusedWebTools(err(400, "web search is not enabled"), offered), ["web_search"]);
  assert.deepEqual(refusedWebTools(err(400, "web_fetch is disabled for your organization"), offered), ["web_fetch"]);
  assert.deepEqual(refusedWebTools(err(400, "web search is not enabled"), [{ name: "web_fetch" }]), [],
    "a tool that was not offered cannot have been refused");
  assert.deepEqual(refusedWebTools(err(429, "web search rate limit"), offered), [], "a rate limit is not a refusal");
  assert.deepEqual(refusedWebTools(err(400, "max_tokens is too large"), offered), []);
});

/* ---------------------------------------------------- what the page is told */

test("a search notice carries the query and nothing else from the input", () => {
  assert.deepEqual(
    serverToolStarted({ id: "s1", name: "web_search", input: { query: "Kodiac fee", extra: { a: 1 } } }),
    { id: "s1", name: "web_search", input: { query: "Kodiac fee" } },
  );
  assert.deepEqual(serverToolStarted({ id: "s2", name: "web_fetch", input: { url: "https://x.com/a" } }).input,
    { url: "https://x.com/a" });
});

test("a failed page read says why, in words", () => {
  const done = serverToolFinished({
    type: "web_fetch_tool_result",
    tool_use_id: "s3",
    content: { type: "web_fetch_tool_result_error", error_code: "url_not_in_prior_context" },
  });
  assert.equal(done.ok, false);
  assert.match(done.error, /already in the conversation/);
  assert.equal(serverToolFinished({
    type: "web_fetch_tool_result", tool_use_id: "s4",
    content: { type: "web_fetch_tool_result_error", error_code: "something_new" },
  }).error, "something_new", "a code nobody has described is passed through, not dressed up");
});

test("only a real web address is passed on as a source", () => {
  const sources = citedSources({
    type: "text",
    citations: [
      { type: "web_search_result_location", url: "javascript:alert(1)", title: "no" },
      { type: "char_location", document_index: 0, cited_text: "a document, not a page" },
      { type: "web_search_result_location", url: "https://www.tattersalls.com/lot/1", title: "Lot 1" },
    ],
  });
  assert.deepEqual(sources, [{ url: "https://www.tattersalls.com/lot/1", title: "Lot 1" }]);
  assert.deepEqual(citedSources({ type: "text", text: "no citations" }), []);
});

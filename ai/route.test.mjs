import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * An end-to-end check on /api/ai/chat, because the bug this catches lives in
 * the route wiring rather than in any module a unit test can reach.
 *
 * Watching req "close" instead of res "close" aborted every turn the instant
 * the POST body was read, and the endpoint answered 200 with an empty body --
 * no error, no log, nothing to notice until someone asked a question in the
 * browser and watched nothing happen. Only a real request over a real socket
 * shows it.
 *
 * The server is started with placeholder database credentials: it boots and
 * serves regardless, since the pool connects lazily, and neither route touched
 * here needs a query.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8300 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}`;

let server;

const waitForBoot = async () => {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const res = await fetch(`${BASE}/api/ai/status`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not start");
};

test.before(async () => {
  server = spawn(process.execPath, ["server.jsx"], {
    cwd: ROOT,
    stdio: "ignore",
    env: {
      ...process.env,
      PORT: String(PORT),
      DB_HOST: "127.0.0.1",
      DB_USER: "placeholder",
      DB_PASSWORD: "placeholder",
      FRANCE_CRON: "off",
      // The point of these tests is the plumbing, not the model. Without a key
      // the turn ends at the first line of runTurn, which is all that is needed
      // to prove the response is written and flushed.
      ANTHROPIC_API_KEY: "",
    },
  });
  await waitForBoot();
});

test.after(() => server?.kill("SIGKILL"));

test("status reports whether the assistant can answer", async () => {
  const body = await (await fetch(`${BASE}/api/ai/status`)).json();
  assert.equal(body.available, false, "no key was given, so it must say so");
  assert.equal(body.model, "claude-opus-5");
  assert.ok(body.tables > 50, "the readable-table count should be the real list");
  assert.equal(body.limits.ROW_CAP, 500);
});

test("chat answers with a real SSE frame, not an empty 200", async () => {
  const res = await fetch(`${BASE}/api/ai/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: "TestUser", messages: [{ role: "user", content: "hello" }] }),
    signal: AbortSignal.timeout(15000),
  });

  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /text\/event-stream/);

  const text = await res.text();
  assert.notEqual(text.trim(), "", "an empty body is the regression this test exists for");
  assert.match(text, /^event: /m);

  // Without a key the only frame is the error naming the missing variable.
  const frame = text.split("\n\n").find((f) => f.startsWith("event: error"));
  assert.ok(frame, `expected an error frame, got: ${text.slice(0, 200)}`);
  assert.match(frame, /ANTHROPIC_API_KEY/);
});

test("chat rejects a malformed conversation before opening a stream", async () => {
  for (const body of [{}, { messages: [] }, { messages: [{ role: "system", content: "x" }] }]) {
    const res = await fetch(`${BASE}/api/ai/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.match(res.headers.get("content-type") || "", /application\/json/);
  }
});

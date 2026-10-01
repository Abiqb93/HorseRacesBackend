import test from "node:test";
import assert from "node:assert/strict";
import { pedigreeUrl, inlineHeaders, createRelay } from "./pedigreeRelay.mjs";

const TATTS = "https://www.tattersalls.com/cat/autumnhit/2026/379.pdf";
const ARQANA = "https://www.arqana.com/upload/pedigrees/vente414/fra/6.pdf";

test("the catalogue pages of Tattersalls and Arqana are relayed, as they are addressed", () => {
  assert.equal(pedigreeUrl(TATTS)?.href, TATTS);
  assert.equal(pedigreeUrl("https://www.tattersalls.com/cat/july/2026/12.jpg")?.pathname, "/cat/july/2026/12.jpg", "Tattersalls' picture of the page");
  assert.equal(pedigreeUrl(ARQANA)?.href, ARQANA);
  assert.equal(pedigreeUrl("https://www.arqana.com/upload/pedigrees/vente414/6.pdf")?.pathname, "/upload/pedigrees/vente414/6.pdf");
});

test("nothing else is: another host, another folder, another kind of file, or anything but a plain https address", () => {
  for (const bad of [
    "http://www.tattersalls.com/cat/autumnhit/2026/379.pdf",
    "https://tattersalls.com/cat/autumnhit/2026/379.pdf",
    "https://www.tattersalls.com.evil.test/cat/autumnhit/2026/379.pdf",
    "https://evil.test/cat/autumnhit/2026/379.pdf",
    "https://www.tattersalls.com/4DCGI/Entry/Lot/AUT26/379",
    "https://www.tattersalls.com/cat/autumnhit/2026/379.pdf?x=1",
    "https://www.tattersalls.com/cat/autumnhit/2026/379.pdf#p",
    "https://www.tattersalls.com:8443/cat/autumnhit/2026/379.pdf",
    "https://user:pw@www.tattersalls.com/cat/autumnhit/2026/379.pdf",
    "https://www.tattersalls.com/cat/autumnhit/2026/../../etc/379.pdf",
    "https://www.tattersalls.com/cat/autumnhit/2026/379.html",
    "https://www.arqana.com/upload/pedigrees/vente414/fra/6.jpg",
    "https://www.arqana.com/catalogue/la_vente_de_l-arc_/414",
    "https://localhost/cat/autumnhit/2026/379.pdf",
    "https://169.254.169.254/cat/a/2026/1.pdf",
    "", null, undefined, 42, `https://www.tattersalls.com/cat/${"a".repeat(600)}/2026/1.pdf`,
  ]) assert.equal(pedigreeUrl(bad), null, String(bad).slice(0, 80));
});

test("a relayed page goes out inline, named for its lot, typed for what it is", () => {
  assert.deepEqual(inlineHeaders(pedigreeUrl(TATTS)), {
    "Content-Type": "application/pdf",
    "Content-Disposition": 'inline; filename="379.pdf"',
    "Cache-Control": "public, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  });
  assert.equal(inlineHeaders(pedigreeUrl("https://www.tattersalls.com/cat/july/2026/12.jpg"))["Content-Type"], "image/jpeg");
});

const PDF = Buffer.from("%PDF-1.4 a catalogue page");
const answer = (status, body = PDF, type = "application/pdf") => ({
  status,
  headers: new Headers({ "content-type": type }),
  arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length),
});

test("the sale house is asked once an hour, without following a redirect", async () => {
  const calls = [];
  let t = 0;
  const relay = createRelay({ now: () => t, fetchImpl: async (url, opts) => { calls.push({ url, redirect: opts.redirect }); return answer(200); } });
  const url = pedigreeUrl(TATTS);
  const one = await relay(url);
  assert.equal(one.type, "application/pdf");
  assert.equal(one.body.toString(), "%PDF-1.4 a catalogue page");
  await relay(url);
  assert.equal(calls.length, 1, "the second time from memory");
  assert.equal(calls[0].redirect, "manual");
  t = 61 * 60 * 1000;
  await relay(url);
  assert.equal(calls.length, 2, "after an hour, asked again");
});

test("what the sale house cannot give is an error, not a page", async () => {
  const url = pedigreeUrl(TATTS);
  await assert.rejects(createRelay({ fetchImpl: async () => answer(404) })(url), (e) => e.status === 404);
  await assert.rejects(createRelay({ fetchImpl: async () => answer(302) })(url), (e) => e.status === 502, "a redirect is not followed");
  await assert.rejects(createRelay({ fetchImpl: async () => answer(200, Buffer.from("<html>"), "text/html") })(url), /text\/html/);
  await assert.rejects(createRelay({ fetchImpl: async () => { throw new Error("timeout"); } })(url), /did not answer/);
  await assert.rejects(createRelay({ fetchImpl: async () => answer(200, Buffer.alloc(11 * 1024 * 1024)) })(url), /larger/);
});

test("the memory holds at most its size, letting the longest unused page go first", async () => {
  const urls = [1, 2, 3, 4].map((n) => pedigreeUrl(`https://www.tattersalls.com/cat/autumnhit/2026/${n}.pdf`));
  let asked = 0;
  const counting = createRelay({ maxBytes: 3 * PDF.length, fetchImpl: async () => { asked += 1; return answer(200); } });
  for (const u of urls.slice(0, 3)) await counting(u);
  await counting(urls[0]); // 1 is used again: 2 is now the longest unused
  await counting(urls[3]); // 4 comes in, 2 goes
  assert.equal(asked, 4);
  await counting(urls[0]);
  await counting(urls[2]);
  assert.equal(asked, 4, "1 and 3 are still held");
  await counting(urls[1]);
  assert.equal(asked, 5, "2 had gone");
});

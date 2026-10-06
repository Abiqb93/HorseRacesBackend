import assert from "node:assert/strict";
import { test } from "node:test";

import { BROWSER_NAMES, CHROMIUM_PATHS, idOf, pickChromium } from "./browser.mjs";

test("a control's id is its name with the dollars swapped for underscores", () => {
  assert.equal(idOf("ctl00$MainContentArea$txtNamedHorse"), "#ctl00_MainContentArea_txtNamedHorse");
  assert.equal(idOf("ctl00$MainContentArea$btnSearchNamedHorse"), "#ctl00_MainContentArea_btnSearchNamedHorse");
});

test("ARION_CHROMIUM_PATH wins, and a wrong one is reported rather than worked around", () => {
  const isExecutable = (p) => p === "/opt/chrome" || p === "/usr/bin/chromium";
  assert.deepEqual(
    pickChromium({ env: { ARION_CHROMIUM_PATH: "/opt/chrome" }, isExecutable }),
    { path: "/opt/chrome", from: "ARION_CHROMIUM_PATH" },
  );
  // a named path that is not there does NOT quietly fall through to another
  // browser: launching a different one than was asked for hides the mistake
  assert.deepEqual(
    pickChromium({ env: { ARION_CHROMIUM_PATH: "/opt/gone" }, isExecutable }),
    { path: null, from: "ARION_CHROMIUM_PATH", missing: "/opt/gone" },
  );
});

test("a browser in the image is found, by fixed path or on PATH", () => {
  assert.equal(pickChromium({ env: {}, isExecutable: (p) => p === "/usr/bin/chromium" }).path, "/usr/bin/chromium");
  // Nix symlinks its packages onto PATH from somewhere unpredictable
  assert.deepEqual(
    pickChromium({ env: { PATH: "/nix/store/abc123-chromium/bin:/usr/local/bin" }, isExecutable: (p) => p === "/nix/store/abc123-chromium/bin/chromium" }),
    { path: "/nix/store/abc123-chromium/bin/chromium", from: "the image" },
  );
  // a trailing slash on a PATH entry does not produce a doubled one
  const seen = [];
  pickChromium({ env: { PATH: "/opt/bin/" }, isExecutable: (p) => { seen.push(p); return false; } });
  assert.ok(seen.includes("/opt/bin/chromium"), seen.join(" "));
  assert.ok(!seen.some((p) => p.includes("//")), "no doubled slash");
});

test("no browser anywhere is reported, not thrown: playwright may still have its own", () => {
  assert.deepEqual(
    pickChromium({ env: {}, isExecutable: () => false }),
    { path: null, from: "playwright's own download" },
  );
});

test("the places looked in cover a Nix image and a Debian one", () => {
  assert.ok(CHROMIUM_PATHS.some((p) => p.includes("nix")), "Railway's image is Nix-based");
  assert.ok(CHROMIUM_PATHS.includes("/usr/bin/chromium"));
  assert.ok(BROWSER_NAMES.includes("chromium"));
});

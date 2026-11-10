/*
 * Runs the extension's service worker (background.js) and shared settings in
 * Node with a mocked `chrome` API, against the real Return YouTube Dislike API.
 *
 * Usage: node tests/background.test.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const EXT = path.join(__dirname, "..", "FixYouTube");
let messageListener = null;
let installedListener = null;
const storage = {};
let fetchCalls = 0;

const context = vm.createContext({
  console,
  setTimeout,
  clearTimeout,
  AbortController,
  URL,
  Response,
  fetch: (url, ...rest) => {
    fetchCalls += 1;
    // Simulated server failure for one ID, to exercise the error path.
    if (String(url).endsWith("ERRORERROR1")) return Promise.resolve(new Response("oops", { status: 500 }));
    return fetch(url, ...rest);
  },
  chrome: {
    runtime: {
      onMessage: { addListener: (fn) => (messageListener = fn) },
      onInstalled: { addListener: (fn) => (installedListener = fn) },
    },
    storage: {
      local: {
        get: async (keys) => Object.fromEntries(keys.filter((k) => k in storage).map((k) => [k, storage[k]])),
        set: async (values) => Object.assign(storage, values),
      },
    },
  },
});
context.importScripts = (file) => vm.runInContext(fs.readFileSync(path.join(EXT, file), "utf8"), context);
vm.runInContext(fs.readFileSync(path.join(EXT, "background.js"), "utf8"), context);

function send(message, sender = { tab: { id: 1 } }) {
  return new Promise((resolve) => {
    const keepOpen = messageListener(message, sender, resolve);
    if (!keepOpen) setTimeout(() => resolve(undefined), 50);
  });
}

(async () => {
  // Settings normalization (shared/settings.js).
  const normalize = vm.runInContext("fixYouTubeNormalizeSettings", context);
  const defaults = vm.runInContext("FIXYOUTUBE_DEFAULTS", context);
  assert.deepStrictEqual({ ...normalize(null) }, { ...defaults });
  assert.strictEqual(normalize({ quality: "bogus" }).quality, "hd2160");
  assert.strictEqual(normalize({ videosPerRowCount: "6" }).videosPerRowCount, 6);
  assert.strictEqual(normalize({ videosPerRowCount: 9 }).videosPerRowCount, 4);
  assert.strictEqual(normalize({ dislikeCount: "yes" }).dislikeCount, true);
  assert.ok(!("junk" in normalize({ junk: 1 })));
  console.log("ok  settings normalization");

  // Install seeds a complete settings object.
  await installedListener();
  assert.deepStrictEqual({ ...storage }, { ...defaults });
  console.log("ok  onInstalled seeds defaults");

  // Real API lookup.
  const result = await send({ type: "fixyoutube:get-dislikes", videoId: "dQw4w9WgXcQ" });
  assert.strictEqual(result.ok, true, JSON.stringify(result));
  assert.ok(Number.isInteger(result.dislikes) && result.dislikes > 0);
  console.log(`ok  live lookup (dQw4w9WgXcQ: ${result.dislikes} dislikes)`);

  // Cache: a second request for the same video does not hit the network.
  const before = fetchCalls;
  const again = await send({ type: "fixyoutube:get-dislikes", videoId: "dQw4w9WgXcQ" });
  assert.strictEqual(again.dislikes, result.dislikes);
  assert.strictEqual(fetchCalls, before);
  console.log("ok  cached lookup");

  // Concurrent requests are de-duplicated.
  const n = fetchCalls;
  await Promise.all([1, 2, 3].map(() => send({ type: "fixyoutube:get-dislikes", videoId: "jNQXAC9IVRw" })));
  assert.strictEqual(fetchCalls, n + 1);
  console.log("ok  concurrent de-duplication");

  // Validation.
  assert.strictEqual((await send({ type: "fixyoutube:get-dislikes", videoId: "../etc" })).ok, false);
  assert.strictEqual((await send({ type: "fixyoutube:get-dislikes", videoId: "dQw4w9WgXcQ" }, {})).ok, false);
  assert.strictEqual(await send({ type: "something-else" }), undefined);
  console.log("ok  input validation");

  // The API reports unknown videos as 0 dislikes (not an error).
  const unknown = await send({ type: "fixyoutube:get-dislikes", videoId: "AAAAAAAAAAA" });
  assert.strictEqual(unknown.ok, true);
  assert.strictEqual(unknown.dislikes, 0);
  console.log("ok  unknown video -> 0");

  // Server errors produce a clean failure and are not cached (a retry refetches).
  const failed = await send({ type: "fixyoutube:get-dislikes", videoId: "ERRORERROR1" });
  assert.strictEqual(failed.ok, false);
  const m = fetchCalls;
  await send({ type: "fixyoutube:get-dislikes", videoId: "ERRORERROR1" });
  assert.strictEqual(fetchCalls, m + 1);
  console.log(`ok  server error -> "${failed.error}", not cached`);

  console.log("\nAll background tests passed.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

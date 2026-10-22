import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import * as bundledList from "../../../../../packages/core/src/bangList.ts";
import { docs } from "../../test-native-stub.mjs";

globalThis.require = (id) => {
  assert.equal(id, "@ardia/core/src/bangList.ts");
  return bundledList;
};
const { BANGS_URL, bangStatus, bangsFor, loadBangs, refreshBangs, refreshBangsOnce, resetBangsForTests } = await import("./bangs.ts");


const DAY = 86_400_000;
const entries = (prefix) => Array.from({ length: 1200 }, (_, i) => ({ s: `${prefix} ${i}`, ts: [`${prefix}${i}`], u: `https://${prefix}${i}.example/?q={searchTerms}` }));
const heliumBody = (prefix) => `// Generated at 2026-10-22T00:00:00Z\n// MIT License\n\n${JSON.stringify(entries(prefix)).replace(/}]$/, "},]")}\n`;

function server(responses) {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    const { status, body = "", etag = null, type = "application/json" } = next;
    const headers = new Map([["content-type", type], ["etag", etag]]);
    return { status, ok: status >= 200 && status < 300, headers: { get: (k) => headers.get(k.toLowerCase()) ?? null }, text: async () => body };
  };
  return { calls, fetchFn };
}

const state = () => JSON.parse(docs.get("bangs-state.json") ?? "null");
const ago = (ms) => docs.set("bangs-state.json", JSON.stringify({ ...state(), checkedAt: Date.now() - ms }));

beforeEach(() => {
  docs.clear();
  resetBangsForTests();
});

test("nothing loads until the text has a '!', then the bundled list arrives", async () => {
  assert.equal(bangsFor("github react"), null);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(bangStatus().loaded, false);
  bangsFor("!gh react");
  await loadBangs();
  assert.equal(bangsFor("!gh react")?.get("gh")?.name, "GitHub");
  assert.equal(bangsFor("react").get("ют")?.name, "YouTube");
  assert.equal(bangStatus().source, "bundled");
});

test("the first refresh asks the fixed URL, without credentials or the typed text, with the bundled list's ETag; 304 keeps it", async () => {
  const { calls, fetchFn } = server([{ status: 304 }]);
  await loadBangs();
  assert.equal((await refreshBangs(fetchFn)).result, "unchanged");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, BANGS_URL);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.credentials, "omit");
  assert.equal(calls[0].init.body, undefined);
  assert.deepEqual(calls[0].init.headers, { Accept: "application/json", "If-None-Match": bundledList.BANG_LIST_ETAG });
  assert.equal(bangStatus().source, "bundled");
  assert.equal(docs.has("bangs.txt"), false);
  assert.equal(state().etag, bundledList.BANG_LIST_ETAG);
});

test("at most one request a day, across sessions", async () => {
  const { calls, fetchFn } = server([{ status: 304 }, { status: 304 }]);
  await refreshBangs(fetchFn);
  resetBangsForTests();
  assert.equal((await refreshBangs(fetchFn)).result, "fresh");
  ago(DAY - 60_000);
  assert.equal((await refreshBangs(fetchFn)).result, "fresh");
  ago(DAY + 1);
  assert.equal((await refreshBangs(fetchFn)).result, "unchanged");
  assert.equal(calls.length, 2);
});

test("a new list replaces the table and is kept for the next launch; its ETag goes with the next request", async () => {
  const { calls, fetchFn } = server([{ status: 200, body: heliumBody("new"), etag: '"v2"' }, { status: 304 }]);
  assert.equal((await refreshBangs(fetchFn)).result, "updated");
  assert.equal(bangsFor("!").get("new7")?.template, "https://new7.example/?q={searchTerms}");
  assert.equal(bangsFor("!").get("gh"), undefined);
  assert.equal(state().etag, '"v2"');
  resetBangsForTests();
  assert.equal((await loadBangs()).get("new7")?.name, "new 7");
  assert.equal(bangStatus().source, "stored");
  ago(DAY + 1);
  assert.equal((await refreshBangs(fetchFn)).result, "unchanged");
  assert.equal(calls[1].init.headers["If-None-Match"], '"v2"');
  assert.equal(bangsFor("!").get("new7")?.name, "new 7");
});

test("a failed or invalid response keeps the last good list, and waits a day before asking again", async () => {
  const good = server([{ status: 200, body: heliumBody("good"), etag: '"good"' }]);
  await refreshBangs(good.fetchFn);
  for (const bad of [{ status: 500 }, { status: 200, body: "<html>", type: "text/html" }, { status: 200, body: "[1, 2" }, { status: 200, body: "[]" }, new Error("offline")]) {
    ago(DAY + 1);
    const { calls, fetchFn } = server([bad]);
    assert.equal((await refreshBangs(fetchFn)).result, "failed");
    assert.equal(calls.length, 1);
    assert.equal(bangsFor("!").get("good3")?.name, "good 3");
    assert.equal(state().etag, '"good"');
    assert.equal((await refreshBangs(fetchFn)).result, "fresh");
    resetBangsForTests();
    assert.equal((await loadBangs()).get("good3")?.name, "good 3");
  }
});

test("a session refreshes once however many '!'s are typed", async () => {
  const { calls, fetchFn } = server([{ status: 304 }]);
  const real = globalThis.fetch;
  globalThis.fetch = fetchFn;
  try {
    await Promise.all([refreshBangsOnce(), refreshBangsOnce()]);
    docs.delete("bangs-state.json");
    await refreshBangsOnce();
  } finally {
    globalThis.fetch = real;
  }
  assert.equal(calls.length, 1);
});

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { bangDocument } from "../../../../../packages/core/src/bangs.ts";
import * as bundledList from "../../../../../packages/core/src/bangList.ts";
import { bangListServer, docs, heldSaves } from "../../test-native-stub.mjs";

globalThis.require = (id) => {
  assert.equal(id, "@ardia/core/src/bangList.ts");
  return bundledList;
};
const { bangStatus, bangsFor, loadBangs, refreshBangs, refreshBangsOnce, resetBangsForTests, resolveTypedBang } = await import("./bangs.ts");

const DAY = 86_400_000;
const entries = (prefix) => [
  ...["gh", "w", "yt"].map((t) => ({ s: `${prefix} ${t}`, ts: [t], u: `https://${t}.${prefix}.example/?q={searchTerms}` })),
  ...Array.from({ length: 1200 }, (_, i) => ({ s: `${prefix} ${i}`, ts: [`${prefix}${i}`], u: `https://${prefix}${i}.example/?q={searchTerms}` })),
];
const heliumBody = (prefix, keep = () => true) => `// Generated at 2026-10-22T00:00:00Z\n// MIT License\n\n${JSON.stringify(entries(prefix).filter(keep)).replace(/}]$/, "},]")}\n`;

function server(responses) {
  const calls = [];
  bangListServer.reply = async (etag) => {
    calls.push(etag);
    const next = responses.shift();
    if (next instanceof Error) throw next;
    const { status, body = null, etag: replyEtag = null, contentType = "application/json" } = next;
    return { status, etag: replyEtag, contentType, body, bytes: body?.length ?? 0 };
  };
  return calls;
}

const state = () => JSON.parse(docs.get("bangs-state.json") ?? "null");
const ago = (ms) => docs.set("bangs-state.json", JSON.stringify({ checkedAt: Date.now() - ms }));

beforeEach(() => {
  docs.clear();
  heldSaves.on = false;
  heldSaves.queue.length = 0;
  bangListServer.reply = null;
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

test("Enter on a cold session waits for the local list, never for the refresh", async () => {
  server([{ status: 304 }]);
  let releaseRefresh;
  bangListServer.reply = () => new Promise((resolve) => (releaseRefresh = () => resolve({ status: 304 })));
  void refreshBangsOnce();
  assert.equal(await resolveTypedBang("!gh react"), "https://github.com/search?q=react");
  assert.equal(await resolveTypedBang("react !w"), "https://wikipedia.org/w/index.php?search=react");
  assert.equal(await resolveTypedBang("?!gh react !w"), null);
  assert.equal(await resolveTypedBang("hello!"), null);
  assert.equal(await resolveTypedBang("no bang"), null);
  releaseRefresh?.();
});

test("the first refresh sends only the bundled list's ETag; 304 keeps the list", async () => {
  const calls = server([{ status: 304 }]);
  bangsFor("!gh secret query");
  assert.equal((await refreshBangs()).result, "unchanged");
  assert.deepEqual(calls, [bundledList.BANG_LIST_ETAG]);
  assert.equal(bangStatus().source, "bundled");
  assert.equal(docs.has("bangs.txt"), false);
  assert.ok(Math.abs(state().checkedAt - Date.now()) < 5000);
});

test("at most one request a day, across sessions", async () => {
  const calls = server([{ status: 304 }, { status: 304 }]);
  await refreshBangs();
  resetBangsForTests();
  assert.equal((await refreshBangs()).result, "fresh");
  ago(DAY - 60_000);
  assert.equal((await refreshBangs()).result, "fresh");
  ago(DAY + 1);
  assert.equal((await refreshBangs()).result, "unchanged");
  assert.equal(calls.length, 2);
});

test("a build without the native fetch never asks, and keeps the bundled list", async () => {
  assert.equal((await refreshBangs()).result, "fresh");
  assert.equal(state(), null);
  assert.equal(bangStatus().source, "bundled");
});

test("a new list and its ETag are saved as one document, replace the table and come back next launch", async () => {
  const calls = server([{ status: 200, body: heliumBody("new"), etag: '"v2"' }, { status: 304 }]);
  assert.equal((await refreshBangs()).result, "updated");
  assert.equal(bangsFor("!").get("new7")?.template, "https://new7.example/?q={searchTerms}");
  assert.equal(bangsFor("!").get("gh")?.name, "new gh");
  assert.ok(docs.get("bangs.txt").startsWith('ardia-bangs 1\t"v2"\n'));
  resetBangsForTests();
  assert.equal((await loadBangs()).get("new7")?.name, "new 7");
  assert.equal(bangStatus().source, "stored");
  ago(DAY + 1);
  assert.equal((await refreshBangs()).result, "unchanged");
  assert.deepEqual(calls, [bundledList.BANG_LIST_ETAG, '"v2"']);
  assert.equal(bangsFor("!").get("new7")?.name, "new 7");
});

test("a list that couldn't be saved is not used, and its ETag isn't kept", async () => {
  server([{ status: 200, body: heliumBody("new"), etag: '"v2"' }]);
  heldSaves.on = true;
  const pending = refreshBangs();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(bangStatus().source, "bundled");
  assert.equal(bangStatus().etag, null);
  heldSaves.queue.shift()();
  assert.equal((await pending).result, "updated");
  assert.equal(bangStatus().etag, '"v2"');
});

test("a failed, invalid or incomplete response keeps the last good list, and waits a day before asking again", async () => {
  server([{ status: 200, body: heliumBody("good"), etag: '"good"' }]);
  await refreshBangs();
  const noYt = heliumBody("x", (e) => e.ts[0] !== "yt");
  for (const bad of [{ status: 500 }, { status: 302 }, { status: 200, body: "<html>", contentType: "text/html" }, { status: 200, body: "[1, 2" }, { status: 200, body: "[]" }, { status: 200, body: noYt }, new Error("too large")]) {
    ago(DAY + 1);
    const calls = server([bad]);
    assert.equal((await refreshBangs()).result, "failed");
    assert.equal(calls.length, 1);
    assert.equal(bangsFor("!").get("good3")?.name, "good 3");
    assert.ok(docs.get("bangs.txt").startsWith('ardia-bangs 1\t"good"\n'));
    assert.equal((await refreshBangs()).result, "fresh");
    resetBangsForTests();
    assert.equal((await loadBangs()).get("good3")?.name, "good 3");
  }
});

test("a corrupt stored list falls back to the bundled one", async () => {
  const broken = Array.from({ length: 1200 }, (_, i) => `bad${i}\tBroken\thttps://bad host/`).join("\n");
  for (const doc of [bangDocument('"x"', broken), "garbage", `ardia-bangs 1\t"x"\n${"a\tb\tc.example/{s}\n".repeat(10)}`]) {
    resetBangsForTests();
    docs.set("bangs.txt", doc);
    assert.equal((await loadBangs()).get("gh")?.name, "GitHub");
    assert.equal(bangStatus().source, "bundled");
  }
});

test("a session refreshes once however many '!'s are typed", async () => {
  const calls = server([{ status: 304 }]);
  await Promise.all([refreshBangsOnce(), refreshBangsOnce()]);
  docs.delete("bangs-state.json");
  await refreshBangsOnce();
  assert.equal(calls.length, 1);
});

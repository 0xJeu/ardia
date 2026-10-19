import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("./browser.ts");
const model = await import("./model.ts");
const { sidebarEntries, numberedTabs } = await import("../components/sidebar/entries.ts");
const { flushPersistence, loadSession, startPersistence } = await import("../lib/persist.ts");
const stub = await import("../test-native-stub.mjs");

const S = () => useBrowser.getState();
const reset = () => S().hydrate({});
const url = (id) => S().tabs[id].pinnedUrl || S().tabs[id].url;
const urls = (ids) => ids.map(url);
const entries = (w) => {
  const e = sidebarEntries(S(), w);
  return { tiles: urls(e.tiles), rows: urls(e.pinnedRows) };
};
const tileOf = (w, u) => model.viewTabIds(S(), w).find((id) => S().tabs[id].pinned && S().tabs[id].pinnedUrl === u);

function windowWith(...hosts) {
  const w = S().createWindow({ url: `https://${hosts[0]}.com/` });
  const ids = [S().windows[w].tabIds[0]];
  for (const h of hosts.slice(1)) ids.push(S().newTab(w, { url: `https://${h}.com/` }));
  return { w, ids };
}

test("pin as a row, move it to Top Apps and back, unpin: tiles stay tiles, rows sit after them", () => {
  reset();
  const { w, ids: [a, b, c, d] } = windowWith("a", "b", "c", "d");
  S().pinTabs([a], true);
  S().pinTabs([b], true, true);
  S().pinTabs([c], true);
  assert.deepEqual(entries(w), { tiles: ["https://a.com/", "https://c.com/"], rows: ["https://b.com/"] });
  assert.equal(S().tabs[b].pinnedAsRow, true);
  assert.equal(S().tabs[b].pinnedUrl, "https://b.com/");
  assert.deepEqual(urls(S().windows[w].tabIds.slice(0, 3)), ["https://a.com/", "https://c.com/", "https://b.com/"], "tiles, then rows, in the window's order");
  assert.deepEqual(urls(numberedTabs(S(), w)), ["https://a.com/", "https://c.com/", "https://b.com/", "https://d.com/"], "⌘1–9: tiles, rows, then the list");

  S().placeTabs([a], { pinned: true, row: true, beforeId: b });
  assert.deepEqual(entries(w), { tiles: ["https://c.com/"], rows: ["https://a.com/", "https://b.com/"] });
  S().placeTabs([b], { pinned: true, row: false });
  assert.deepEqual(entries(w), { tiles: ["https://c.com/", "https://b.com/"], rows: ["https://a.com/"] });
  assert.equal(S().tabs[b].pinnedAsRow, undefined);
  S().placeTabs([a], { pinned: true });
  assert.deepEqual(entries(w).rows, ["https://a.com/"], "a move inside the pinned area keeps a row a row");

  S().pinTabs([a], false);
  assert.equal(S().tabs[a].pinned, false);
  assert.equal(S().tabs[a].pinnedAsRow, undefined);
  S().pinTabs([a], true);
  assert.deepEqual(entries(w).tiles, ["https://c.com/", "https://b.com/", "https://a.com/"], "pinned again: a tile, as before");
});

test("moving a row up or down stays among the rows", () => {
  reset();
  const { w, ids: [a, b, c] } = windowWith("a", "b", "c");
  S().pinTabs([a], true);
  S().pinTabs([b, c], true, true);
  S().moveTab(b, 1);
  assert.deepEqual(entries(w), { tiles: ["https://a.com/"], rows: ["https://c.com/", "https://b.com/"] });
});

test("closing a row unloads it and keeps it; Close All Tabs keeps rows", () => {
  reset();
  const { w, ids: [a, b, c] } = windowWith("a", "b", "c");
  S().pinTabs([a], true, true);
  S().activate(a);
  S().closeTab(a);
  assert.ok(S().tabs[a], "still there");
  assert.equal(!!S().tabs[a].navigation || !!S().tabs[a].adoptId, false, "unloaded");
  assert.deepEqual(entries(w).rows, ["https://a.com/"]);
  S().clearUnpinnedTabs(w);
  assert.deepEqual(entries(w).rows, ["https://a.com/"]);
  assert.equal(S().tabs[b], undefined);
  assert.equal(S().tabs[c], undefined);
});

test("rows are the profile's: a second window mirrors them, a change in one shows in the other", () => {
  reset();
  const { w: a, ids: [mail, docs] } = windowWith("mail", "docs", "x");
  S().pinTabs([mail], true);
  S().pinTabs([docs], true, true);
  const b = S().createWindow({ url: "https://b.com/" });
  assert.deepEqual(entries(b), { tiles: ["https://mail.com/"], rows: ["https://docs.com/"] });
  S().placeTabs([tileOf(b, "https://mail.com/")], { pinned: true, row: true });
  assert.deepEqual(entries(a), { tiles: [], rows: ["https://docs.com/", "https://mail.com/"] });
  S().placeTabs([tileOf(a, "https://docs.com/")], { pinned: true, row: false });
  assert.deepEqual(entries(b), { tiles: ["https://docs.com/"], rows: ["https://mail.com/"] });
});

test("rows park with the last window and come back as rows, and survive a relaunch", () => {
  stub.docs.clear();
  reset();
  const stop = startPersistence();
  const { w, ids: [a, b] } = windowWith("a", "b", "c");
  S().pinTabs([a], true);
  S().pinTabs([b], true, true);
  flushPersistence();
  stop();
  S().hydrate(loadSession());
  assert.deepEqual(entries(w), { tiles: ["https://a.com/"], rows: ["https://b.com/"] });
  S().closeWindow(w);
  assert.deepEqual(S().parkedPins.default.tabs.map((t) => [t.pinnedUrl, !!t.pinnedAsRow]), [["https://a.com/", false], ["https://b.com/", true]]);
  const n = S().createWindow();
  assert.deepEqual(entries(n), { tiles: ["https://a.com/"], rows: ["https://b.com/"] });
});

test("older data: 0.2.7's pinnedRow stays a tile, a stray row flag on an unpinned tab is dropped", () => {
  const tab = (id, u, pinned, extra = {}) => ({ id, windowId: "w", profileId: "default", url: u, title: "", favicon: null, pinned, muted: false, zoom: 1, customTitle: null, customIcon: null, pinnedUrl: pinned ? u : null, navigation: null, openerId: null, createdAt: 0, lastActiveAt: 0, ...extra });
  S().hydrate({
    windows: { w: { id: "w", profileId: "default", incognito: false, tabIds: ["r", "t", "u"], activeTabIds: { default: "u" }, sidebarOpen: true, frame: null, createdAt: 0 } },
    windowOrder: ["w"],
    tabs: {
      r: tab("r", "https://r.com/", true, { pinnedRow: true }),
      t: tab("t", "https://t.com/", true),
      u: tab("u", "https://u.com/", false, { pinnedAsRow: true }),
    },
  });
  assert.deepEqual(entries("w"), { tiles: ["https://r.com/", "https://t.com/"], rows: [] });
  assert.equal(S().tabs.u.pinnedAsRow, undefined);
  S().pinTabs(["u"], true);
  assert.deepEqual(entries("w").tiles, ["https://r.com/", "https://t.com/", "https://u.com/"]);
});

test("a closed row comes back as a row from its snapshot", () => {
  reset();
  const { ids: [a] } = windowWith("a", "b");
  S().pinTabs([a], true, true);
  assert.equal(model.snapshotTab(S().tabs[a]).pinnedAsRow, true);
  S().pinTabs([a], false);
  assert.equal(model.snapshotTab(S().tabs[a]).pinnedAsRow, undefined);
});

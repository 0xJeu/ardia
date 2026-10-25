import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("./browser.ts");
const drops = await import("./drops.ts");
const { stripEntries } = await import("../components/layout/stripGroups.ts");
await import("../test-native-stub.mjs");

const S = () => useBrowser.getState();
const reset = () => S().hydrate({});
const host = (id) => new URL(S().tabs[id].url).hostname.split(".")[0];

function windowWith(...hosts) {
  const w = S().createWindow({ url: `https://${hosts[0]}.com/` });
  const ids = [S().windows[w].tabIds[0]];
  for (const h of hosts.slice(1)) ids.push(S().newTab(w, { url: `https://${h}.com/` }));
  return { w, ids };
}

function dockWith() {
  reset();
  const { w, ids } = windowWith("t1", "t2", "c", "d", "e", "u");
  const [t1, t2, c, d, e] = ids;
  S().pinTabs([t1, t2], true);
  S().pinTabs([c, d, e], true, true);
  return { w, ids };
}

const dockSlots = (w) =>
  stripEntries(S(), w, S().windows[w].profileId)
    .filter((key) => key.startsWith("pinned:"))
    .map((key) => ({ tabIds: [key.slice("pinned:".length)] }));

const dock = (w) => {
  const pinned = S().windows[w].tabIds.filter((id) => S().tabs[id].pinned);
  return { tiles: pinned.filter((id) => !S().tabs[id].pinnedAsRow).map(host), rows: pinned.filter((id) => S().tabs[id].pinnedAsRow).map(host) };
};

function dragInDock(w, id, to) {
  const slots = dockSlots(w);
  const from = slots.findIndex((slot) => slot.tabIds[0] === id);
  const placement = drops.slotPlacement(S(), [id], slots, from, to, { pinned: true, groupId: null });
  if (placement) S().placeTabs([id], placement);
}

test("top strip dock: a row dragged before the first row lands there, past the tiles", () => {
  const { w, ids: [, , c, , e] } = dockWith();
  assert.deepEqual(dock(w), { tiles: ["t1", "t2"], rows: ["c", "d", "e"] });
  assert.equal(dockSlots(w)[2].tabIds[0], c);
  dragInDock(w, e, 2);
  assert.deepEqual(dock(w), { tiles: ["t1", "t2"], rows: ["e", "c", "d"] });
});

test("top strip dock: a row dragged to the end goes last, a tile dragged past a tile swaps with it", () => {
  const { w, ids: [t1, , c] } = dockWith();
  dragInDock(w, c, 4);
  assert.deepEqual(dock(w), { tiles: ["t1", "t2"], rows: ["d", "e", "c"] });
  dragInDock(w, t1, 1);
  assert.deepEqual(dock(w), { tiles: ["t2", "t1"], rows: ["d", "e", "c"] });
  assert.equal(host(S().windows[w].tabIds.at(-1)), "u", "the unpinned tab stays after the dock");
});

test("top strip dock: a row dragged over the tiles stays a row, first among the rows", () => {
  const { w, ids: [, , , , e] } = dockWith();
  dragInDock(w, e, 0);
  assert.deepEqual(dock(w), { tiles: ["t1", "t2"], rows: ["e", "c", "d"] });
  assert.equal(S().tabs[e].pinnedAsRow, true);
});

test("a drop on its own slot moves nothing", () => {
  const { w, ids: [, , c] } = dockWith();
  assert.equal(drops.slotPlacement(S(), [c], dockSlots(w), 2, 2, { pinned: true, groupId: null }), null);
});

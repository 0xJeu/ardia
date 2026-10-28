import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { viewTabIds } = await import("../browser/model.ts");

const S = () => useBrowser.getState();
const host = (id) => new URL(S().tabs[id].url).hostname.replace(".com", "");
const groupsIn = (w, profileId) =>
  Object.values(S().groups)
    .filter((g) => g.windowId === w && g.profileId === profileId)
    .map((g) => ({ name: g.name, pinned: g.pinned, color: g.color, parent: g.parentId ? S().groups[g.parentId].name : null, tabs: g.tabIds.map(host) }))
    .sort((a, z) => a.name.localeCompare(z.name));

function windowWith(...hosts) {
  S().hydrate({});
  const w = S().createWindow({ url: `https://${hosts[0]}.com/` });
  const ids = [S().windows[w].tabIds[0]];
  for (const h of hosts.slice(1)) ids.push(S().newTab(w, { url: `https://${h}.com/` }));
  return { w, ids };
}

test("Move to Window takes a group whole, with its name, colour and nested group, into the other window", () => {
  const { w, ids } = windowWith("a", "b", "c", "d");
  const g = S().groupTabs([ids[1], ids[2], ids[3]], { name: "Trip", pinned: false });
  S().updateGroup(g, { color: "blue" });
  const inner = S().groupTabs([ids[2], ids[3]], { name: "Hotels", pinned: false });
  assert.equal(S().groups[inner].parentId, g);
  const other = S().createWindow({ url: "https://x.com/" });
  assert.equal(S().moveGroupToWindow(g, other), other);
  assert.deepEqual(viewTabIds(S(), w).map(host), ["a"]);
  assert.deepEqual(viewTabIds(S(), other).map(host), ["x", "b", "c", "d"]);
  assert.deepEqual(groupsIn(other, "default"), [
    { name: "Hotels", pinned: false, color: null, parent: "Trip", tabs: ["c", "d"] },
    { name: "Trip", pinned: false, color: "blue", parent: null, tabs: ["b", "c", "d"] },
  ]);
  assert.deepEqual(groupsIn(w, "default"), []);
});

test("Move to Window › New Window opens one with the group in it, and a pinned group stays put", () => {
  const { w, ids } = windowWith("a", "b", "c");
  const g = S().groupTabs([ids[1], ids[2]], { name: "Read", pinned: false });
  const made = S().moveGroupToWindow(g, null);
  assert.ok(made && made !== w);
  assert.deepEqual(groupsIn(made, "default").map((x) => x.tabs), [["b", "c"]]);
  const p = S().groupTabs([ids[0]], { name: "Pinned" });
  assert.equal(S().moveGroupToWindow(p, made), undefined);
  assert.equal(S().groups[p].windowId, w);
});

test("Move to Profile takes a group's tabs to the profile and keeps it a group there, pinned or not", () => {
  const { w, ids } = windowWith("a", "b", "c");
  const work = S().createProfile({ name: "Work" });
  const g = S().groupTabs([ids[1], ids[2]], { name: "Docs" });
  S().moveGroupToProfile(g, work);
  assert.deepEqual(groupsIn(w, "default"), []);
  assert.deepEqual(groupsIn(w, work), [{ name: "Docs", pinned: true, color: null, parent: null, tabs: ["b", "c"] }]);
  assert.ok([ids[1], ids[2]].every((id) => S().tabs[id].profileId === work));
  assert.equal(S().tabs[ids[0]].profileId, "default");
});

for (const nested of [false, true]) {
  test(`Move to Window with tabs shared across windows leaves the destination one copy of the group${nested ? " and its nested group" : ""}`, () => {
    const { w, ids } = windowWith("a", "b", "c");
    const other = S().createWindow({ url: "https://x.com/" });
    S().updateSettings({ shareTabsAcrossWindows: true });
    const g = S().groupTabs([ids[1], ids[2]], { name: "Trip", pinned: false });
    const inner = nested ? S().groupTabs([ids[2]], { name: "Hotels", pinned: false }) : null;
    if (inner) assert.equal(S().groups[inner].parentId, g);
    assert.equal(S().moveGroupToWindow(g, other), other);
    const named = (win, name) => Object.values(S().groups).filter((x) => x.windowId === win && x.name === name);
    for (const win of [w, other]) {
      assert.equal(named(win, "Trip").length, 1, `one Trip in ${win === w ? "the source" : "the destination"}`);
      if (nested) assert.equal(named(win, "Hotels").length, 1, `one Hotels in ${win === w ? "the source" : "the destination"}`);
    }
    const trip = named(other, "Trip")[0];
    assert.deepEqual(trip.tabIds.map(host), ["b", "c"]);
    assert.deepEqual(trip.tabIds, [ids[1], ids[2]], "the live tabs moved in");
    if (nested) assert.equal(named(other, "Hotels")[0].parentId, trip.id);
    const grouped = Object.values(S().groups).filter((x) => x.windowId === other).flatMap((x) => x.tabIds);
    assert.ok(grouped.every((id) => S().tabs[id]?.windowId === other), "every member is a tab of the destination");
  });
}

import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../store/browser.ts");
const model = await import("../store/model.ts");
const { Clock, emptyScope, syncScope } = await import("@ardia/sync");
const adapters = await import("./adapters.ts");
const stub = await import("../test-native-stub.mjs");

const S = () => useBrowser.getState();

class Folder {
  files = new Map();
  hidden = new Set();
  counter = 0;
  transport() {
    return {
      write: async (scope, payload) => {
        const id = `f${++this.counter}`;
        this.files.set(id, { scope, payload });
        return id;
      },
      read: async (scope, known) => {
        const shown = [...this.files].filter(([id, f]) => f.scope === scope && !this.hidden.has(id));
        const files = shown.filter(([id]) => !known.includes(id)).map(([id, f]) => ({ id, payload: f.payload }));
        return { files, pending: [], damaged: [], present: shown.map(([id]) => id) };
      },
      remove: async (_scope, ids) => ids.forEach((id) => this.files.delete(id)),
    };
  }
}

class Device {
  constructor(id, folder, { legacy = false } = {}) {
    this.id = id;
    this.folder = folder;
    this.legacy = legacy;
    S().hydrate({});
    useBrowser.setState({ historyReady: { default: true }, bookmarksReady: { default: true } });
    this.browser = S();
    this.scopes = { app: emptyScope(), p: emptyScope() };
    this.clock = new Clock(id);
    stub.passwordStores.set(id, new Map());
    this.passwords = adapters.passwordsAdapter("default", () => true, stub.readLogins);
  }
  with(fn) {
    stub.current.device = this.id;
    useBrowser.setState(this.browser, true);
    try {
      return fn();
    } finally {
      this.browser = S();
    }
  }
  async sync(profileId = "default", options = {}) {
    stub.current.device = this.id;
    useBrowser.setState(this.browser, true);
    const run = (scope, list, options) =>
      syncScope({
        scope,
        state: this.scopes[scope],
        transport: this.folder.transport(),
        adapters: list,
        clock: this.clock,
        device: this.id,
        options,
      });
    try {
      const app = await run("app", [adapters.settingsAdapter]);
      const p = await run(
        "p",
        [
          ...(this.legacy ? [] : [adapters.pinnedRowsAdapter(profileId)]),
          adapters.pinnedAdapter(profileId),
          adapters.bookmarksAdapter(profileId),
          adapters.historyAdapter(profileId),
          adapters.deviceTabsAdapter(profileId, this.id, () => `${this.id}'s MacBook Pro`),
          this.passwords,
        ],
        { expired: adapters.historyExpired, ...options },
      );
      return { published: app.published + p.published };
    } finally {
      this.browser = S();
    }
  }
}

async function syncAll(devices, rounds = 2) {
  for (let i = 0; i < rounds; i++) for (const d of devices) await d.sync();
}

function tree(device, profileId = "default") {
  return device.with(() => {
    const b = S().bookmarks;
    const roots = b.roots[profileId];
    const walk = (id) => {
      const n = b.nodes[id];
      return n.kind === "url" ? `${n.title}=${n.url}` : { [n.title]: n.children.map(walk) };
    };
    return { bar: walk(roots.bar), other: walk(roots.other) };
  });
}

function assertTreeWhole(device) {
  device.with(() => {
    const b = S().bookmarks;
    for (const n of Object.values(b.nodes)) {
      if (n.parentId) assert.ok(b.nodes[n.parentId]?.children.includes(n.id), `${n.title} is in its parent`);
      if (n.kind === "folder") for (const c of n.children) assert.equal(b.nodes[c]?.parentId, n.id);
    }
  });
}

const OLD_SESSION = (() => {
  const { cmdClickCreatesTabGroup: _c, tabReorderHaptics: _t, chosen: _x, ...rest } = S().settings;
  return { ...rest, cleanUpInactiveTabsAfterHours: null };
})();
const relaunch = (device, settings) =>
  device.with(() => {
    S().hydrate({ settings });
    useBrowser.setState({ historyReady: { default: true }, bookmarksReady: { default: true } });
  });

test("settings: what a Mac only has by default isn't sent; nulls from another Mac are no say; Never and an explicit off apply", async () => {
  const folder = new Folder();
  const a = new Device("A", folder);
  const b = new Device("B", folder);
  b.with(() => S().updateSettings({ cmdClickCreatesTabGroup: true, tabReorderHaptics: true, cleanUpInactiveTabsAfterHours: 12 }));
  relaunch(a, OLD_SESSION);
  assert.equal(a.with(() => S().settings.cmdClickCreatesTabGroup), true, "filled in at launch");
  const extraction = a.with(() => adapters.settingsAdapter.extract(() => undefined));
  assert.ok(!extraction.values.has("set:cmdClickCreatesTabGroup") && extraction.ignore("set:cmdClickCreatesTabGroup"), "a default filled in abstains");
  assert.ok(!extraction.values.has("set:cleanUpInactiveTabsAfterHours"), "an old session's Never, its default, never published: no say either");
  const visible = new Map([["set:cmdClickCreatesTabGroup", { v: null }], ["set:tabReorderHaptics", {}], ["set:cleanUpInactiveTabsAfterHours", { v: null }]]);
  b.with(() => adapters.settingsAdapter.apply(visible, ["set:cmdClickCreatesTabGroup", "set:tabReorderHaptics", "set:cleanUpInactiveTabsAfterHours"]));
  b.with(() => {
    assert.equal(S().settings.cmdClickCreatesTabGroup, true);
    assert.equal(S().settings.tabReorderHaptics, true);
    assert.equal(S().settings.cleanUpInactiveTabsAfterHours, null, "Never is a value of its own");
  });
  b.with(() => adapters.settingsAdapter.apply(new Map([["set:cmdClickCreatesTabGroup", { v: false }]]), ["set:cmdClickCreatesTabGroup"]));
  b.with(() => assert.equal(S().settings.cmdClickCreatesTabGroup, false, "an explicit off is taken"));
});

test("settings: a joined Mac relaunched with a setting it never had doesn't overwrite another Mac's choice; its own reset does", async () => {
  const folder = new Folder();
  const a = new Device("A", folder);
  const b = new Device("B", folder);
  await syncAll([a, b]);
  a.scopes.app.base["set:cmdClickCreatesTabGroup"] = JSON.stringify({ v: null });
  relaunch(a, OLD_SESSION);
  b.with(() => S().updateSettings({ cmdClickCreatesTabGroup: false }));
  await b.sync();
  await new Promise((r) => setTimeout(r, 20));
  await syncAll([a, b]);
  assert.equal(a.with(() => S().settings.cmdClickCreatesTabGroup), false);
  assert.equal(b.with(() => S().settings.cmdClickCreatesTabGroup), false);
  await new Promise((r) => setTimeout(r, 20));
  a.with(() => S().updateSettings({ cmdClickCreatesTabGroup: true }));
  await syncAll([a, b]);
  assert.equal(b.with(() => S().settings.cmdClickCreatesTabGroup), true);
  a.with(() => S().updateSettings({ cleanUpInactiveTabsAfterHours: 12 }));
  await syncAll([a, b]);
  a.with(() => S().updateSettings({ cleanUpInactiveTabsAfterHours: null }));
  await syncAll([a, b]);
  assert.equal(b.with(() => S().settings.cleanUpInactiveTabsAfterHours), null);
});

test("settings: a session a pre-chosen build saved whole (defaults filled in) doesn't count those defaults as choices", async () => {
  const folder = new Folder();
  const a = new Device("A", folder);
  const b = new Device("B", folder);
  await syncAll([a, b]);
  a.scopes.app.base["set:cmdClickCreatesTabGroup"] = JSON.stringify({ v: null });
  const { chosen: _x, ...whole } = { ...S().settings, cmdClickCreatesTabGroup: true };
  relaunch(a, whole);
  b.with(() => S().updateSettings({ cmdClickCreatesTabGroup: false }));
  await b.sync();
  await new Promise((r) => setTimeout(r, 20));
  await syncAll([a, b]);
  assert.equal(a.with(() => S().settings.cmdClickCreatesTabGroup), false);
  assert.equal(b.with(() => S().settings.cmdClickCreatesTabGroup), false);
  await new Promise((r) => setTimeout(r, 20));
  relaunch(a, { ...whole, cmdClickCreatesTabGroup: false, tabReorderHaptics: false });
  await syncAll([a, b]);
  assert.equal(b.with(() => S().settings.tabReorderHaptics), false);
});

test("settings: a setting from a newer version survives an older Mac's syncs (no deletion)", async () => {
  const folder = new Folder();
  const a = new Device("A", folder);
  const b = new Device("B", folder);
  await syncAll([a, b]);
  const newer = {
    ...adapters.settingsAdapter,
    extract: (base) => {
      const e = adapters.settingsAdapter.extract(base);
      e.values.set("set:futureBool", { v: false });
      return { values: e.values, ignore: (k) => !e.values.has(k) };
    },
  };
  stub.current.device = "B";
  useBrowser.setState(b.browser, true);
  await syncScope({ scope: "app", state: b.scopes.app, transport: folder.transport(), adapters: [newer], clock: b.clock, device: "B" });
  b.browser = S();
  for (let i = 0; i < 3; i++) await a.sync();
  assert.deepEqual(a.scopes.app.records["set:futureBool"]?.v, { v: false }, "A keeps it");
  const tombstones = [...folder.files.values()].flatMap((f) => JSON.stringify(f.payload).match(/futureBool[^}]*null/g) ?? []);
  assert.deepEqual(tombstones, [], "and never deletes it");
});

test("bookmarks: a folder deleted on one Mac while the other adds to it keeps the new bookmark", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  a.with(() => S().addBookmarkFolder({ profileId: "default", title: "Trip" }));
  await syncAll([a, b]);
  const trip = (d) => d.with(() => Object.values(S().bookmarks.nodes).find((n) => n.title === "Trip")?.id);
  a.with(() => S().removeBookmark(trip(a)));
  b.with(() => S().addBookmark({ profileId: "default", url: "https://hotel.example/", title: "Hotel", parentId: trip(b) }));
  await syncAll([a, b, a]);
  assert.deepEqual(tree(a), tree(b));
  assert.deepEqual(tree(a).other, { "Other Bookmarks": ["Hotel=https://hotel.example/"] });
  assertTreeWhole(a);
  assertTreeWhole(b);
});

test("bookmarks: folders moved into each other on two Macs don't make a cycle", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  a.with(() => {
    S().addBookmarkFolder({ profileId: "default", title: "One" });
    S().addBookmarkFolder({ profileId: "default", title: "Two" });
  });
  await syncAll([a, b]);
  const id = (d, title) => d.with(() => Object.values(S().bookmarks.nodes).find((n) => n.title === title).id);
  a.with(() => S().moveBookmark(id(a, "One"), id(a, "Two")));
  b.with(() => S().moveBookmark(id(b, "Two"), id(b, "One")));
  await syncAll([a, b, a, b]);
  assert.deepEqual(tree(a), tree(b));
  assertTreeWhole(a);
  const reachable = JSON.stringify(tree(a));
  assert.ok(reachable.includes("One") && reachable.includes("Two"));
});

test("pinned tabs sync once however many windows show them; a closed window or a parked set deletes nothing elsewhere", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  let aHome, aWork;
  a.with(() => {
    aHome = S().createWindow({ url: "https://mail.example/" });
    const mail = model.viewTabIds(S(), aHome)[0];
    const cal = S().newTab(aHome, { url: "https://cal.example/" });
    S().pinTabs([mail, cal], true);
    aWork = S().createWindow({ url: "https://work.example/" });
  });
  b.with(() => S().createWindow({ url: "https://b-home.example/" }));
  await syncAll([a, b]);
  const pins = (d) => d.with(() => Object.values(S().tabs).filter((t) => t.pinned).map((t) => t.pinnedUrl).sort());
  assert.deepEqual(pins(a), ["https://cal.example/", "https://cal.example/", "https://mail.example/", "https://mail.example/"], "a copy in each of A's windows");
  assert.deepEqual(pins(b), ["https://cal.example/", "https://mail.example/"], "one each on B");

  a.with(() => S().closeWindow(aHome));
  assert.equal(a.with(() => S().parkedPins.default), undefined, "A's other window still shows them: nothing parked");
  await syncAll([a, b]);
  assert.deepEqual(pins(b), ["https://cal.example/", "https://mail.example/"], "still pinned on B");

  b.with(() => {
    const [mail, cal] = ["https://mail.example/", "https://cal.example/"].map((u) => Object.values(S().tabs).find((t) => t.pinnedUrl === u).id);
    S().updateTab(mail, { customTitle: "Inbox" });
    S().pinTabs([cal], false);
  });
  await syncAll([b, a]);
  const tiles = (d, w) => d.with(() => model.viewTabIds(S(), w).filter((id) => S().tabs[id].pinned).map((id) => `${S().tabs[id].pinnedUrl} ${S().tabs[id].customTitle}`));
  assert.deepEqual(tiles(a, aWork), ["https://mail.example/ Inbox"]);
  assert.equal((await a.sync()).published, 0, "settled");

  a.with(() => S().closeWindow(aWork));
  assert.equal(a.with(() => S().parkedPins.default.tabs.length), 1);
  b.with(() => S().updateTab(Object.values(S().tabs).find((t) => t.pinned).id, { customTitle: "Mail" }));
  await syncAll([b, a]);
  const n = a.with(() => S().createWindow());
  await syncAll([a]);
  assert.deepEqual(tiles(a, n), ["https://mail.example/ Mail"]);
  assert.equal((await a.sync()).published, 0, "settled");
  const m = a.with(() => S().createWindow());
  assert.deepEqual(tiles(a, m), ["https://mail.example/ Mail"], "and the next window too");
  assert.equal((await a.sync()).published, 0, "copies publish nothing new");
});

const rowsOf = (d) =>
  d.with(() => {
    const w = S().windowOrder.find((id) => !S().windows[id].incognito);
    const ids = model.viewTabIds(S(), w).filter((id) => S().tabs[id].pinned);
    const at = (row) => ids.filter((id) => !!S().tabs[id].pinnedAsRow === row).map((id) => `${S().tabs[id].pinnedUrl}${S().tabs[id].customTitle ? ` ${S().tabs[id].customTitle}` : ""}`);
    return { tiles: at(false), rows: at(true) };
  });

test("pinned rows sync as rows, keep their order, and move between rows and tiles on every Mac", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  a.with(() => {
    const w = S().createWindow({ url: "https://mail.example/" });
    const mail = model.viewTabIds(S(), w)[0];
    const docs = S().newTab(w, { url: "https://docs.example/" });
    const cal = S().newTab(w, { url: "https://cal.example/" });
    S().pinTabs([mail], true);
    S().pinTabs([docs, cal], true, true);
  });
  b.with(() => S().createWindow({ url: "https://b-home.example/" }));
  await syncAll([a, b]);
  assert.deepEqual(rowsOf(b), { tiles: ["https://mail.example/"], rows: ["https://docs.example/", "https://cal.example/"] });

  b.with(() => {
    const cal = Object.values(S().tabs).find((t) => t.pinnedUrl === "https://cal.example/").id;
    const mail = Object.values(S().tabs).find((t) => t.pinnedUrl === "https://mail.example/").id;
    S().placeTabs([cal], { pinned: true, row: false });
    S().placeTabs([mail], { pinned: true, row: true });
  });
  await syncAll([b, a]);
  assert.deepEqual(rowsOf(a), { tiles: ["https://cal.example/"], rows: ["https://docs.example/", "https://mail.example/"] });
  assert.equal((await a.sync()).published, 0, "settled");
  assert.equal((await b.sync()).published, 0, "settled");

  const marks = (d) => Object.entries(d.scopes.p.records).filter(([k, r]) => k.startsWith("pinrow:") && r.v === 1).length;
  assert.equal(marks(a), 2);
  a.with(() => S().pinTabs([Object.values(S().tabs).find((t) => t.pinnedUrl === "https://docs.example/").id], false));
  await syncAll([a, b]);
  assert.deepEqual(rowsOf(b), { tiles: ["https://cal.example/"], rows: ["https://mail.example/"] });
  assert.equal(marks(b), 1, "unpinning a row deletes its mark");
});

test("a Mac on an older version sees rows as tiles, and its edits never turn a row into a tile elsewhere", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const old = new Device("devOld", folder, { legacy: true });
  a.with(() => {
    const w = S().createWindow({ url: "https://mail.example/" });
    const mail = model.viewTabIds(S(), w)[0];
    const docs = S().newTab(w, { url: "https://docs.example/" });
    S().pinTabs([mail], true);
    S().pinTabs([docs], true, true);
  });
  old.with(() => S().createWindow({ url: "https://old-home.example/" }));
  await syncAll([a, old]);
  assert.deepEqual(rowsOf(old), { tiles: ["https://mail.example/", "https://docs.example/"], rows: [] }, "the older Mac shows both as tiles");

  old.with(() => {
    const docs = Object.values(S().tabs).find((t) => t.pinnedUrl === "https://docs.example/").id;
    S().updateTab(docs, { customTitle: "Docs" });
  });
  await syncAll([old, a]);
  assert.deepEqual(rowsOf(a), { tiles: ["https://mail.example/"], rows: ["https://docs.example/ Docs"] }, "renamed there, still a row here");
  assert.equal((await old.sync()).published, 0, "the older Mac settles");
  assert.equal((await a.sync()).published, 0);

  const c = new Device("devC", folder);
  c.with(() => S().createWindow({ url: "https://c-home.example/" }));
  await syncAll([c]);
  assert.deepEqual(rowsOf(c), { tiles: ["https://mail.example/"], rows: ["https://docs.example/ Docs"] }, "a new Mac gets the row");
});

test("a row mark that arrives before its pinned tab still makes a row, and isn't deleted meanwhile", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  a.with(() => {
    const w = S().createWindow({ url: "https://mail.example/" });
    const docs = S().newTab(w, { url: "https://docs.example/" });
    S().pinTabs([docs], true);
  });
  await a.sync();
  const pinFiles = [...folder.files.keys()];
  b.with(() => S().createWindow({ url: "https://b-home.example/" }));
  await b.sync();
  b.with(() => S().placeTabs([Object.values(S().tabs).find((t) => t.pinnedUrl === "https://docs.example/").id], { pinned: true, row: true }));
  await b.sync();

  const c = new Device("devC", folder);
  c.with(() => S().createWindow({ url: "https://c-home.example/" }));
  pinFiles.forEach((id) => folder.hidden.add(id));
  await syncAll([c]);
  assert.deepEqual(rowsOf(c), { tiles: [], rows: [] }, "only B's mark has arrived, not the tab");
  assert.equal((await c.sync()).published, 0, "and C doesn't delete the mark of a tab it hasn't seen");
  folder.hidden.clear();
  await syncAll([c, a, b]);
  for (const d of [a, b, c]) assert.deepEqual(rowsOf(d), { tiles: [], rows: ["https://docs.example/"] });
});

const later = () => new Promise((r) => setTimeout(r, 5));
const tabAt = (url) => Object.values(S().tabs).find((t) => t.url === url || t.pinnedUrl === url)?.id;

test("a tab kept open after an unpin and pinned again as a row elsewhere comes back as a row", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  a.with(() => {
    const w = S().createWindow({ url: "https://home.example/" });
    const docs = S().newTab(w, { url: "https://docs.example/" });
    S().pinTabs([docs], true, true);
    S().activate(docs);
  });
  b.with(() => S().createWindow({ url: "https://b-home.example/" }));
  await syncAll([a, b]);
  b.with(() => S().activate(tabAt("https://docs.example/")));
  await later();
  a.with(() => S().pinTabs([tabAt("https://docs.example/")], false));
  await syncAll([a, b]);
  assert.equal(b.with(() => S().tabs[tabAt("https://docs.example/")].pinned), false, "B keeps its open copy as a regular tab");
  await later();
  a.with(() => S().pinTabs([tabAt("https://docs.example/")], true, true));
  await syncAll([a, b, a, b]);
  assert.deepEqual(rowsOf(b).rows, ["https://docs.example/"], "B pins it again as a row");
  assert.deepEqual(rowsOf(a).rows, ["https://docs.example/"], "and A keeps its row");
});

test("a row mark held up in transit doesn't undo a later choice of a tile on another Mac", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  a.with(() => {
    const w = S().createWindow({ url: "https://home.example/" });
    S().pinTabs([S().newTab(w, { url: "https://docs.example/" })], true);
  });
  b.with(() => S().createWindow({ url: "https://b-home.example/" }));
  await a.sync();
  await b.sync();
  await later();
  const before = new Set(folder.files.keys());
  a.with(() => S().placeTabs([tabAt("https://docs.example/")], { pinned: true, row: true }));
  await a.sync();
  const delayed = [...folder.files.keys()].filter((id) => !before.has(id));
  delayed.forEach((id) => folder.hidden.add(id));
  await later();
  b.with(() => {
    const docs = tabAt("https://docs.example/");
    S().activate(docs);
    S().pinTabs([docs], false);
  });
  await b.sync();
  await later();
  b.with(() => S().pinTabs([tabAt("https://docs.example/")], true));
  await b.sync();
  folder.hidden.clear();
  await syncAll([b, a, b, a]);
  assert.deepEqual(rowsOf(b), { tiles: ["https://docs.example/"], rows: [] }, "B's later tile stands");
  assert.deepEqual(rowsOf(a), { tiles: ["https://docs.example/"], rows: [] }, "and A follows it");
});

test("an unpin and pin as a tile before the next sync still outranks an older row mark in transit", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  a.with(() => {
    const w = S().createWindow({ url: "https://home.example/" });
    const docs = S().newTab(w, { url: "https://docs.example/" });
    S().pinTabs([docs], true, true);
    S().placeTabs([docs], { pinned: true, row: false });
  });
  b.with(() => S().createWindow({ url: "https://b-home.example/" }));
  await syncAll([a, b]);
  assert.deepEqual(rowsOf(b).tiles, ["https://docs.example/"]);
  await later();
  const before = new Set(folder.files.keys());
  a.with(() => S().placeTabs([tabAt("https://docs.example/")], { pinned: true, row: true }));
  await a.sync();
  [...folder.files.keys()].filter((id) => !before.has(id)).forEach((id) => folder.hidden.add(id));
  await later();
  b.with(() => {
    const docs = tabAt("https://docs.example/");
    S().activate(docs);
    S().pinTabs([docs], false);
    S().pinTabs([docs], true);
  });
  await b.sync();
  folder.hidden.clear();
  await syncAll([b, a, b, a]);
  assert.deepEqual(rowsOf(b), { tiles: ["https://docs.example/"], rows: [] }, "B's later tile stands");
  assert.deepEqual(rowsOf(a), { tiles: ["https://docs.example/"], rows: [] });
  assert.deepEqual(b.with(() => S().pinChoices), {}, "the published choice is settled");
  assert.equal((await b.sync()).published + (await a.sync()).published, 0, "and nothing is sent again");
});

for (const [how, move] of [
  ["parked with the last window", (w) => (S().closeWindow(w), S().createWindow({ url: "https://b-next.example/" }))],
  ["left in a closed window while another mirrors it", (w) => (S().createWindow({ url: "https://b-next.example/" }), S().closeWindow(w))],
]) {
  test(`a tile chosen before the next sync outranks an older row mark when the choice was ${how}`, async () => {
    const folder = new Folder();
    const old = new Device("devOld", folder, { legacy: true });
    const a = new Device("devA", folder);
    const b = new Device("devB", folder);
    old.with(() => {
      const w = S().createWindow({ url: "https://old-home.example/" });
      S().pinTabs([S().newTab(w, { url: "https://docs.example/" })], true);
    });
    a.with(() => S().createWindow({ url: "https://a-home.example/" }));
    let bw;
    b.with(() => (bw = S().createWindow({ url: "https://b-home.example/" })));
    await syncAll([old, a, b]);
    await later();
    const before = new Set(folder.files.keys());
    a.with(() => S().placeTabs([tabAt("https://docs.example/")], { pinned: true, row: true }));
    await a.sync();
    [...folder.files.keys()].filter((id) => !before.has(id)).forEach((id) => folder.hidden.add(id));
    await later();
    b.with(() => {
      const docs = tabAt("https://docs.example/");
      S().activate(docs);
      S().pinTabs([docs], false);
    });
    await b.sync();
    await later();
    b.with(() => {
      S().pinTabs([tabAt("https://docs.example/")], true);
      move(bw);
    });
    await b.sync();
    folder.hidden.clear();
    await syncAll([b, a, b, a]);
    assert.deepEqual(rowsOf(b), { tiles: ["https://docs.example/"], rows: [] }, "B's later tile stands");
    assert.deepEqual(rowsOf(a), { tiles: ["https://docs.example/"], rows: [] });
  });
}

async function tileWithMarkOnBoth() {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  a.with(() => {
    const w = S().createWindow({ url: "https://home.example/" });
    const docs = S().newTab(w, { url: "https://docs.example/" });
    S().pinTabs([docs], true, true);
    S().placeTabs([docs], { pinned: true, row: false });
  });
  b.with(() => S().createWindow({ url: "https://b-home.example/" }));
  await syncAll([a, b]);
  await later();
  const before = new Set(folder.files.keys());
  a.with(() => S().placeTabs([tabAt("https://docs.example/")], { pinned: true, row: true }));
  await a.sync();
  [...folder.files.keys()].filter((id) => !before.has(id)).forEach((id) => folder.hidden.add(id));
  await later();
  b.with(() => {
    const docs = tabAt("https://docs.example/");
    S().activate(docs);
    S().pinTabs([docs], false);
    S().pinTabs([docs], true);
  });
  return { folder, a, b };
}

test("a tile choice whose batch never reached the disk survives a crash and still outranks an older row mark", async () => {
  const { folder, a, b } = await tileWithMarkOnBoth();
  const durable = structuredClone(b.scopes.p);
  await assert.rejects(b.sync("default", { persist: async () => { throw new Error("disk full"); } }));
  assert.equal(Object.keys(b.with(() => S().pinChoices.default ?? {})).length, 1, "the choice stays pending until its batch is on disk");
  b.scopes.p = durable;
  await b.sync();
  folder.hidden.clear();
  await syncAll([b, a, b, a]);
  assert.deepEqual(rowsOf(b), { tiles: ["https://docs.example/"], rows: [] }, "B's later tile stands");
  assert.deepEqual(rowsOf(a), { tiles: ["https://docs.example/"], rows: [] });
});

test("a tile choice whose journal write failed is sent once when the write is retried", async () => {
  const { folder, a, b } = await tileWithMarkOnBoth();
  await assert.rejects(b.sync("default", { persist: async () => { throw new Error("disk full"); } }));
  const marks = () => b.scopes.p.journal?.flatMap((f) => f.ops).filter((op) => op.k.startsWith("pinrow:")).length ?? 0;
  assert.equal(marks(), 1);
  await b.sync();
  assert.equal(marks(), 0, "the held batch is written");
  assert.deepEqual(b.with(() => S().pinChoices), {}, "and the choice settles");
  assert.equal((await b.sync()).published, 0, "nothing more is sent");
  folder.hidden.clear();
  await syncAll([b, a, b, a]);
  assert.deepEqual(rowsOf(a), { tiles: ["https://docs.example/"], rows: [] });
});

test("passwords: saved on one Mac, changed or deleted on another; the newer edit of a login wins", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  const save = (d, origin, user, password) => d.with(() => stub.savePassword("", origin, user, password));
  const remove = (d, origin, user) => d.with(() => stub.deletePassword("", origin, user));
  const list = (d) => [...stub.passwordStores.get(d.id).values()].map((l) => `${l.url} ${l.username}=${l.password}`).sort();
  await save(a, "https://bank.example", "alice", "hunter2");
  await save(a, "https://mail.example", "alice", "m41l");
  await save(b, "https://shop.example", "bob", "sh0p");
  await syncAll([a, b]);
  assert.deepEqual(list(a), list(b));
  assert.deepEqual(list(b), ["https://bank.example alice=hunter2", "https://mail.example alice=m41l", "https://shop.example bob=sh0p"]);
  await save(b, "https://bank.example", "alice", "correct horse");
  await remove(b, "https://mail.example", "alice");
  await syncAll([b, a]);
  assert.deepEqual(list(a), ["https://bank.example alice=correct horse", "https://shop.example bob=sh0p"]);
  assert.equal((await a.sync()).published, 0);
});

test("history: two Macs settle on the union of their visits in Chrome, publish nothing more, and deletions reach Chrome", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  for (const d of [a, b]) stub.historyDbs.delete(d.id);
  const readChrome = async (d) => {
    stub.current.device = d.id;
    const entries = await stub.queryHistory("");
    d.with(() =>
      useBrowser.setState({
        history: { default: entries.map((e) => ({ ...e, favicon: null, lastVisit: e.visitTimes.at(-1) })) },
        historyReady: { default: true },
      }),
    );
  };
  const sync = async (d) => {
    await readChrome(d);
    return d.sync();
  };
  const visits = (d, url) => stub.historyDbs.get(d.id)?.get("")?.get(url)?.visits ?? [];
  const t = Date.now() - 3_600_000;
  const visit = (d, url, at) => d.with(() => ((stub.current.device = d.id), stub.chromeVisit("", url, url, at)));
  visit(a, "https://x.example/", t);
  visit(a, "https://x.example/", t + 1000);
  visit(b, "https://x.example/", t + 2000);
  visit(b, "https://y.example/", t + 3000);
  for (let i = 0; i < 3; i++) for (const d of [a, b]) await sync(d);
  assert.deepEqual(visits(a, "https://x.example/"), [t, t + 1000, t + 2000]);
  assert.deepEqual(visits(b, "https://x.example/"), [t, t + 1000, t + 2000]);
  assert.deepEqual(visits(a, "https://y.example/"), [t + 3000]);
  assert.equal((await sync(a)).published, 0, "settled on A");
  assert.equal((await sync(b)).published, 0, "settled on B");

  visit(b, "https://x.example/", t + 5000);
  await sync(b);
  await sync(a);
  assert.deepEqual(visits(a, "https://x.example/").at(-1), t + 5000, "a new visit is an edit");

  a.with(() => S().removeHistory("default", ["https://y.example/"]));
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(visits(a, "https://y.example/"), []);
  await sync(a);
  await sync(b);
  assert.deepEqual(visits(b, "https://y.example/"), [], "deleted from B's Chrome");
  assert.equal((await sync(a)).published, 0);
  assert.equal((await sync(b)).published, 0);
});

test("bookmarks: a Mac on old ids and one on Chrome's UUIDs keep one tree", async () => {
  const { bookmarkUuidFor } = await import("../store/bookmarks.ts");
  const folder = new Folder();
  const old = new Device("devOld", folder);
  const now = new Device("devNew", folder);
  old.with(() => {
    const roots = { bar: "bm-bar", other: "bm-other" };
    const n = (id, parentId, x) => ({ id, parentId, addedAt: 5, ...x });
    S().hydrate({
      bookmarks: {
        roots: { default: roots },
        nodes: {
          "bm-bar": n("bm-bar", null, { kind: "folder", title: "Bookmarks Bar", children: ["bm-f"] }),
          "bm-other": n("bm-other", null, { kind: "folder", title: "Other Bookmarks", children: [] }),
          "bm-f": n("bm-f", "bm-bar", { kind: "folder", title: "F", children: ["bm-a", "bm-b"] }),
          "bm-a": n("bm-a", "bm-f", { kind: "url", title: "A", url: "https://a.example/", favicon: null }),
          "bm-b": n("bm-b", "bm-f", { kind: "url", title: "B", url: "https://b.example/", favicon: null }),
        },
      },
    });
  });
  await old.sync();
  now.with(() => {
    S().hydrate({ bookmarks: { nodes: {}, roots: {} } });
    useBrowser.setState({ bookmarksReady: { default: true } });
    const f = S().addBookmarkFolder({ profileId: "default", title: "F" });
    const a = S().addBookmark({ profileId: "default", url: "https://a.example/", title: "A", parentId: f });
    const b = S().addBookmark({ profileId: "default", url: "https://b.example/", title: "B", parentId: f });
    const nodes = { ...S().bookmarks.nodes };
    const rename = (id, legacy) => {
      const node = { ...nodes[id], id: bookmarkUuidFor(legacy), syncKey: legacy, addedAt: 5 };
      delete nodes[id];
      nodes[node.id] = node;
    };
    rename(f, "bm-f");
    rename(a, "bm-a");
    rename(b, "bm-b");
    const uf = bookmarkUuidFor("bm-f");
    nodes[uf] = { ...nodes[uf], children: [bookmarkUuidFor("bm-a"), bookmarkUuidFor("bm-b")] };
    for (const id of [bookmarkUuidFor("bm-a"), bookmarkUuidFor("bm-b")]) nodes[id] = { ...nodes[id], parentId: uf };
    const bar = S().bookmarks.roots.default.bar;
    nodes[bar] = { ...nodes[bar], children: [uf] };
    useBrowser.setState({ bookmarks: { ...S().bookmarks, nodes } });
  });
  await syncAll([now, old]);
  assert.deepEqual(tree(now), tree(old));
  assert.equal(now.with(() => Object.keys(S().bookmarks.nodes).length), 5, "no duplicates on the updated Mac");
  assert.equal(old.with(() => Object.keys(S().bookmarks.nodes).length), 5, "nor on the old one");
  assert.equal((await now.sync()).published, 0, "the updated Mac republishes nothing");

  const onOld = (key) => old.with(() => Object.values(S().bookmarks.nodes).find((n) => (n.syncKey ?? n.id) === key).id);
  old.with(() => S().updateBookmark(onOld("bm-a"), { title: "A, renamed" }));
  now.with(() => S().addBookmark({ profileId: "default", url: "https://c.example/", title: "C", parentId: bookmarkUuidFor("bm-f") }));
  await syncAll([old, now]);
  assert.deepEqual(tree(now), tree(old));
  assert.deepEqual(tree(now).bar, { "Bookmarks Bar": [{ F: ["A, renamed=https://a.example/", "B=https://b.example/", "C=https://c.example/"] }] });
  assert.equal(now.with(() => S().bookmarks.nodes[bookmarkUuidFor("bm-a")]?.title), "A, renamed");
  old.with(() => S().removeBookmark(onOld("bm-b")));
  await syncAll([old, now]);
  assert.equal(now.with(() => S().bookmarks.nodes[bookmarkUuidFor("bm-b")]), undefined, "a deletion on the old Mac reaches the UUID node");
  assertTreeWhole(now);
  assertTreeWhole(old);
});

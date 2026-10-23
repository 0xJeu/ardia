import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../store/browser.ts");
const model = await import("../store/model.ts");
const folders = await import("../store/tileFolders.ts");
const { sidebarEntries } = await import("../components/sidebar/entries.ts");
const { Clock, emptyScope, syncScope } = await import("@ardia/sync");
const adapters = await import("./adapters.ts");
const shipped = await import("../../../../packages/sync/src/fixtures/scope-v0.2.38.ts");
const { pinnedAdapter: shippedPinnedAdapter } = await import("./fixtures/pinned-v0.2.38.ts");

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
    this.browser = S();
    this.scope = emptyScope();
    this.clock = new Clock(id);
  }
  with(fn) {
    useBrowser.setState(this.browser, true);
    try {
      return fn();
    } finally {
      this.browser = S();
    }
  }
  async sync() {
    useBrowser.setState(this.browser, true);
    try {
      const list = this.legacy
        ? [shippedPinnedAdapter("default")]
        : [adapters.tileFoldersAdapter("default"), adapters.pinnedRowsAdapter("default"), adapters.pinnedAdapter("default")];
      const r = await (this.legacy ? shipped.syncScope : syncScope)({ scope: "p", state: this.scope, transport: this.folder.transport(), adapters: list, clock: this.clock, device: this.id });
      return { published: r.published };
    } finally {
      this.browser = S();
    }
  }
}

async function syncAll(devices, rounds = 2) {
  for (let i = 0; i < rounds; i++) for (const d of devices) await d.sync();
}

const host = (t) => new URL(t.pinnedUrl || t.url).hostname.replace(".example", "");
const grid = (device, last = false) =>
  device.with(() => {
    const w = last ? S().windowOrder.at(-1) : S().windowOrder[0];
    return sidebarEntries(S(), w).cells.map((c) => {
      const f = folders.folderIdOfCell(c);
      if (!f) return host(S().tabs[c]);
      const folder = folders.folderIn(S(), w, f);
      return `${folder.name || "?"}[${folders.folderMembers(S(), w, f).map((id) => host(S().tabs[id])).join(",")}]`;
    });
  });
const tile = (h) => Object.values(S().tabs).find((t) => t.pinned && host(t) === h).id;
const act = (fn) => useBrowser.setState(fn(S()), true);

function seed(device, hosts) {
  device.with(() => {
    const w = S().createWindow({ url: "https://home.example/" });
    const ids = hosts.map((h) => S().newTab(w, { url: `https://${h}.example/` }));
    S().pinTabs(ids, true);
  });
}

test("a tile folder syncs with its name, members and order, and every edit to it reaches the other Mac", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  seed(a, ["mail", "cal", "docs", "news"]);
  a.with(() => {
    act((s) => folders.addToTileFolder(s, [tile("docs")], tile("cal")));
    act((s) => folders.renameTileFolder(s, S().windowOrder[0], S().tabs[tile("cal")].tileFolder.id, "Work"));
  });
  b.with(() => S().createWindow({ url: "https://b-home.example/" }));
  await syncAll([a, b]);
  assert.deepEqual(grid(b), ["mail", "Work[cal,docs]", "news"]);
  assert.equal((await a.sync()).published, 0, "settled");
  assert.equal((await b.sync()).published, 0, "settled");

  b.with(() => {
    act((s) => folders.addToTileFolder(s, [tile("mail")], tile("docs")));
    act((s) => folders.renameTileFolder(s, S().windowOrder[0], S().tabs[tile("cal")].tileFolder.id, "Daily"));
  });
  await syncAll([b, a]);
  assert.deepEqual(grid(a), ["Daily[cal,docs,mail]", "news"]);

  a.with(() => S().pinTabs([tile("docs"), tile("mail")], false));
  await syncAll([a, b]);
  assert.deepEqual(grid(b), ["cal", "news"], "a folder left with one tab is that tile again on both Macs");
  const marks = (d) => Object.entries(d.scope.records).filter(([k, r]) => k.startsWith("tilefold:") && r.v !== null).length;
  assert.equal(marks(a), 0);
  assert.equal(marks(b), 0);
});

test("a Mac on an older version sees a folder's tabs as plain tiles, loses none, and its edits keep the folder elsewhere", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const old = new Device("devOld", folder, { legacy: true });
  seed(a, ["mail", "cal", "docs", "news"]);
  a.with(() => act((s) => folders.newTileFolder(s, [tile("cal"), tile("docs"), tile("news")], "Reading").state));
  old.with(() => S().createWindow({ url: "https://old-home.example/" }));
  await syncAll([a, old]);
  assert.deepEqual(grid(old), ["mail", "cal", "docs", "news"], "plain tiles, every tab there");
  assert.ok(old.with(() => Object.values(S().tabs).every((t) => !t.tileFolder)));

  old.with(() => {
    S().updateTab(tile("docs"), { customTitle: "Docs" });
    S().moveTab(tile("mail"), 3);
  });
  await syncAll([old, a]);
  assert.deepEqual(grid(a), ["Reading[cal,docs,news]", "mail"], "renamed and reordered there, still a folder here");
  assert.equal(a.with(() => S().tabs[tile("docs")].customTitle), "Docs");
  assert.equal((await old.sync()).published, 0, "the older Mac settles");
  assert.equal((await a.sync()).published, 0);

  old.with(() => S().pinTabs([tile("news")], false));
  await syncAll([old, a]);
  assert.deepEqual(grid(a), ["Reading[cal,docs]", "mail"], "an unpin there takes the tab out of the folder here");

  const c = new Device("devC", folder);
  c.with(() => S().createWindow({ url: "https://c-home.example/" }));
  await syncAll([c]);
  assert.deepEqual(grid(c), ["Reading[cal,docs]", "mail"], "a new Mac gets the folder");
});

test("a folder mark that arrives before its pinned tab still files the tab, and isn't deleted meanwhile", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  seed(a, ["mail", "cal"]);
  await a.sync();
  const pinFiles = [...folder.files.keys()];
  b.with(() => S().createWindow({ url: "https://b-home.example/" }));
  await b.sync();
  b.with(() => act((s) => folders.addToTileFolder(s, [tile("cal")], tile("mail"))));
  await b.sync();

  const c = new Device("devC", folder);
  c.with(() => S().createWindow({ url: "https://c-home.example/" }));
  pinFiles.forEach((id) => folder.hidden.add(id));
  await syncAll([c]);
  assert.deepEqual(grid(c), [], "only B's marks have arrived, not the tabs");
  assert.equal((await c.sync()).published, 0, "and C deletes no mark of a tab it hasn't seen");
  folder.hidden.clear();
  await syncAll([c, a, b]);
  for (const d of [a, b, c]) assert.deepEqual(grid(d), ["?[mail,cal]"]);
});

test("a parked folder syncs and comes back as a folder", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  seed(a, ["mail", "cal", "docs"]);
  a.with(() => act((s) => folders.newTileFolder(s, [tile("mail"), tile("docs")], "Two").state));
  await a.sync();
  b.with(() => S().createWindow({ url: "https://b-home.example/" }));
  await b.sync();
  b.with(() => S().closeWindow(S().windowOrder[0]));
  assert.deepEqual(b.with(() => S().parkedPins.default.tabs.map((p) => p.tileFolder?.name ?? null)), ["Two", "Two", null]);
  a.with(() => act((s) => folders.addToTileFolder(s, [tile("cal")], tile("mail"))));
  await syncAll([a, b]);
  assert.deepEqual(b.with(() => S().parkedPins.default.tabs.map((p) => p.tileFolder?.name ?? null)), ["Two", "Two", "Two"]);
  b.with(() => S().createWindow());
  assert.deepEqual(grid(b), ["Two[mail,docs,cal]"]);
  assert.ok(model);
});

const liveMarks = (d) => Object.entries(d.scope.records).filter(([k, r]) => k.startsWith("tilefold:") && r.v !== null).map(([k]) => k);

test("an older Mac's unpin deletes the folder mark too, so no record outlives its pin", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const old = new Device("devOld", folder, { legacy: true });
  seed(a, ["mail", "cal", "docs"]);
  a.with(() => act((s) => folders.newTileFolder(s, [tile("cal"), tile("docs")], "Two").state));
  old.with(() => S().createWindow({ url: "https://old-home.example/" }));
  await syncAll([a, old]);
  assert.equal(liveMarks(a).length, 2);
  old.with(() => S().pinTabs([tile("docs")], false));
  await syncAll([old, a, old, a]);
  assert.deepEqual(grid(a), ["mail", "cal"], "docs unpinned, cal alone is a tile");
  assert.deepEqual(liveMarks(a), [], "both marks are gone");
  assert.equal((await a.sync()).published, 0, "and nothing more to send");
});

test("a rename on one Mac and an add on another at the same time end with one name", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  seed(a, ["mail", "cal", "docs"]);
  a.with(() => act((s) => folders.newTileFolder(s, [tile("mail"), tile("cal")], "Old").state));
  b.with(() => S().createWindow({ url: "https://b-home.example/" }));
  await syncAll([a, b]);
  assert.deepEqual(grid(b), ["Old[mail,cal]", "docs"]);
  await new Promise((r) => setTimeout(r, 5));
  a.with(() => act((s) => folders.renameTileFolder(s, S().windowOrder[0], S().tabs[tile("mail")].tileFolder.id, "Renamed")));
  b.with(() => act((s) => folders.addToTileFolder(s, [tile("docs")], tile("cal"))));
  await syncAll([b, a, b, a]);
  assert.deepEqual(grid(a), ["Renamed[mail,cal,docs]"]);
  assert.deepEqual(grid(b), ["Renamed[mail,cal,docs]"]);
  b.with(() => S().placeTabs([tile("docs")], { pinned: true, row: false, beforeId: tile("mail") }));
  assert.deepEqual(grid(b), ["Renamed[docs,mail,cal]"], "whichever member comes first, the name is the folder's");
});

test("a parked folder an older Mac unpins down to one tab comes back as that tile", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const old = new Device("devOld", folder, { legacy: true });
  seed(a, ["mail", "cal", "docs"]);
  a.with(() => act((s) => folders.newTileFolder(s, [tile("cal"), tile("docs")], "Two").state));
  old.with(() => S().createWindow({ url: "https://old-home.example/" }));
  await syncAll([a, old]);
  a.with(() => {
    const work = S().createProfile({ name: "Work" });
    S().createWindow({ profileId: work, url: "https://work.example/" });
    S().closeWindow(S().windowOrder[0]);
  });
  assert.ok(a.with(() => S().parkedPins.default.tabs.filter((p) => p.tileFolder).length === 2), "parked as a folder");
  old.with(() => S().pinTabs([tile("docs")], false));
  await syncAll([old, a, old, a]);
  assert.ok(a.with(() => S().parkedPins.default.tabs.every((p) => !p.tileFolder)), JSON.stringify(a.with(() => S().parkedPins.default.tabs.map((p) => [p.url, p.tileFolder ?? null]))));
  a.with(() => S().createWindow({ profileId: "default" }));
  assert.deepEqual(grid(a, true), ["mail", "cal"]);
});

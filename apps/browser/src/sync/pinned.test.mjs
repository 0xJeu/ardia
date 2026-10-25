import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../store/browser.ts");
const folders = await import("../store/tileFolders.ts");
const { Clock, emptyScope, syncScope } = await import("@ardia/sync");
const pinnedArea = await import("./pinned.ts");

const S = () => useBrowser.getState();

class Folder {
  files = new Map();
  counter = 0;
  transport() {
    return {
      write: async (scope, payload) => {
        const id = `f${++this.counter}`;
        this.files.set(id, { scope, payload });
        return id;
      },
      read: async (scope, known) => {
        const shown = [...this.files].filter(([, f]) => f.scope === scope);
        const files = shown.filter(([id]) => !known.includes(id)).map(([id, f]) => ({ id, payload: f.payload }));
        return { files, pending: [], damaged: [], present: shown.map(([id]) => id) };
      },
      remove: async (_scope, ids) => ids.forEach((id) => this.files.delete(id)),
    };
  }
}

class Device {
  constructor(id, folder) {
    this.id = id;
    this.folder = folder;
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
      const adapters = pinnedArea.pinnedAreaAdapters("default");
      return await syncScope({ scope: "p", state: this.scope, transport: this.folder.transport(), adapters, clock: this.clock, device: this.id });
    } finally {
      this.browser = S();
    }
  }
}

async function syncAll(devices, rounds = 2) {
  for (let i = 0; i < rounds; i++) for (const d of devices) await d.sync();
}

const act = (fn) => useBrowser.setState(fn(S()), true);
const host = (t) => new URL(t.pinnedUrl || t.url).hostname.replace(".example", "");
const tabOf = (h) => Object.values(S().tabs).find((t) => t.pinned && host(t) === h)?.id;
const area = (device) =>
  device.with(() =>
    Object.values(S().tabs)
      .filter((t) => t.pinned)
      .map((t) => `${host(t)}:${t.pinnedAsRow ? "row" : t.tileFolder ? t.tileFolder.name : "tile"}`)
      .sort(),
  );

function seed(device) {
  device.with(() => {
    const w = S().createWindow({ url: "https://home.example/" });
    const open = (h) => S().newTab(w, { url: `https://${h}.example/`, background: true });
    const [mail, cal, docs, news, row] = ["mail", "cal", "docs", "news", "row"].map(open);
    S().pinTabs([mail, cal, docs, news], true);
    S().pinTabs([row], true, true);
    act((s) => folders.newTileFolder(s, [cal, docs, news], "Work").state);
  });
}

test("the pinned area syncs tile folders, then rows, then the row order, then the pins themselves", () => {
  assert.deepEqual(
    pinnedArea.pinnedAreaAdapters("default").map((a) => a.prefix),
    ["tilefold:", "pinrow:", "pord:g:", "pin"],
  );
});

test("a row and tiles in a folder pinned on one Mac arrive on the other as a row and in that folder", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  seed(a);
  b.with(() => S().createWindow({ url: "https://b-home.example/" }));
  await syncAll([a, b]);
  assert.deepEqual(area(a), ["cal:Work", "docs:Work", "mail:tile", "news:Work", "row:row"]);
  assert.deepEqual(area(b), area(a));
  assert.equal((await a.sync()).published, 0, "settled");
  assert.equal((await b.sync()).published, 0, "settled");
});

test("unpinning a row and a tile in a folder deletes their marks in the same batch as their pins", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  seed(a);
  b.with(() => S().createWindow({ url: "https://b-home.example/" }));
  await syncAll([a, b]);
  const [row, docs] = a.with(() => [tabOf("row"), tabOf("docs")]);
  const before = new Set(folder.files.keys());
  a.with(() => S().pinTabs([row, docs], false));
  await a.sync();
  const batches = [...folder.files]
    .filter(([id]) => !before.has(id))
    .map(([, f]) => JSON.parse(f.payload))
    .filter((f) => f.kind === "log")
    .map((f) => new Set(f.ops.filter((op) => op.v === null).map((op) => op.k)));
  const gone = [`pin:t:${row}`, `pinrow:${row}`, `pin:t:${docs}`, `tilefold:${docs}`];
  assert.ok(
    batches.some((deleted) => gone.every((k) => deleted.has(k))),
    `one batch deletes ${gone.join(", ")}`,
  );
  await syncAll([b, a]);
  assert.deepEqual(area(b), ["cal:Work", "mail:tile", "news:Work"]);
  for (const k of gone) assert.equal(b.scope.records[k]?.v, null, `${k} is a tombstone on B`);
});

test("a pin another Mac published under the app's old name arrives with today's", async () => {
  const folder = new Folder();
  const b = new Device("devB", folder);
  b.with(() => S().createWindow({ url: "https://b-home.example/" }));
  const h = new Clock("devOld").tick();
  const value = { g: null, u: "netnyahoo://history", t: null, i: null, ti: "History", pos: "V" };
  folder.files.set("old1", { scope: "p", payload: JSON.stringify({ v: 1, kind: "log", device: "devOld", seq: 1, at: Date.now(), ops: [{ k: "pin:t:oldpin", h, v: value }] }) });
  await b.sync();
  assert.equal(b.with(() => S().tabs.oldpin?.pinnedUrl), "ardia://history");
});

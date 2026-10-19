import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../store/browser.ts");
const { Clock, emptyScope, syncScope } = await import("@ardia/sync");
const adapters = await import("./adapters.ts");
const stub = await import("../test-native-stub.mjs");

const S = () => useBrowser.getState();
const PROFILES = ["default", "work"];
let wall = 1_900_000_000_000;
const now = () => ++wall;

class Folder {
  files = new Map();
  hidden = new Set();
  counter = 0;
  clone() {
    const f = new Folder();
    f.files = new Map(this.files);
    f.counter = this.counter;
    return f;
  }
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

class Mac {
  constructor(id, folder, browser, scopes = {}) {
    this.id = id;
    this.folder = folder;
    this.browser = browser;
    this.scopes = scopes;
    this.clock = new Clock(id, null, now);
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
  async sync(profiles = PROFILES) {
    stub.current.device = this.id;
    useBrowser.setState(this.browser, true);
    let published = 0;
    try {
      for (const p of profiles) {
        const result = await syncScope({
          scope: `p:${p}`,
          state: (this.scopes[p] ??= emptyScope()),
          transport: this.folder.transport(),
          adapters: [adapters.pinnedRowsAdapter(p), adapters.pinnedAdapter(p)],
          clock: this.clock,
          device: this.id,
        });
        published += result.published;
      }
    } finally {
      this.browser = S();
    }
    return published;
  }
  fork(folder) {
    return new Mac(this.id, folder, this.browser, structuredClone(this.scopes));
  }
}

const WORK = { id: "work", name: "Work", color: "blue", icon: null, createdAt: 1 };
function freshMac(id, folder) {
  S().hydrate({});
  useBrowser.setState((s) => ({ profiles: { ...s.profiles, work: WORK }, profileOrder: [...s.profileOrder, "work"] }));
  const mac = new Mac(id, folder, S());
  return mac;
}

const keyOf = (t) => t.pinKey ?? t.id;
const inContainer = (s, t) => t.pinned || Object.values(s.groups).some((g) => g.pinned && g.tabIds.includes(t.id));
function tabFor(key, profileId) {
  const s = S();
  const all = Object.values(s.tabs).filter((t) => keyOf(t) === key && (!profileId || t.profileId === profileId));
  const shown = (t) => s.windows[t.windowId]?.profileId === t.profileId;
  return all.find((t) => inContainer(s, t) && shown(t)) ?? all.find((t) => inContainer(s, t)) ?? all.find((t) => t.navigation) ?? all[0];
}
const groupFor = (key) => Object.values(S().groups).find((g) => keyOf(g) === key && g.pinned) ?? Object.values(S().groups).find((g) => keyOf(g) === key);

const worlds = new Map();
async function world(startRow) {
  if (worlds.has(startRow)) return worlds.get(startRow);
  const folder = new Folder();
  const a = freshMac("devA", folder);
  const b = freshMac("devB", folder);
  const k = {};
  a.with(() => {
    const wd = S().createWindow({ url: "https://home.example/" });
    k.T = S().newTab(wd, { url: "https://t.example/" });
    k.X = S().newTab(wd, { url: "https://x.example/" });
    k.M = S().newTab(wd, { url: "https://m.example/" });
    k.R = S().newTab(wd, { url: "https://r.example/" });
    S().pinTabs([k.T], true);
    S().pinTabs([k.X], true, startRow);
    k.G = S().groupTabs([k.M], { pinned: true, name: "G" });
    const ww = S().createWindow({ profileId: "work", url: "https://work-home.example/" });
    k.W1 = S().newTab(ww, { url: "https://w1.example/" });
    S().pinTabs([k.W1], true, true);
  });
  b.with(() => {
    S().createWindow({ url: "https://b-home.example/" });
    S().createWindow({ profileId: "work", url: "https://b-work.example/" });
  });
  for (let i = 0; i < 3; i++) for (const m of [a, b]) await m.sync();
  const w = { folder, a, b, k, startRow };
  worlds.set(startRow, w);
  return w;
}

const X_OTHER = "https://x.example/other";
const done = (k, name) => k.done.add(`${name}@${stub.current.device}`);
const did = (k, op, mac) => k.done?.has(`${op.name}@${mac.id}`);
const OPS = [
  { name: "none", steps: [() => {}], touches: [] },
  { name: "unpinX", steps: [(k) => { const t = tabFor(k.X); if (t && inContainer(S(), t)) (S().pinTabs([t.id], false), done(k, "unpinX")); }], touches: ["X"], unpins: ["X"], final: (k) => assert.equal(!!tabFor(k.X) && inContainer(S(), tabFor(k.X)), false, "X unpinned") },
  {
    name: "repinX",
    steps: [(k) => { const t = tabFor(k.X); if (t) (S().pinTabs([t.id], false), S().pinTabs([t.id], true, true), done(k, "repinX")); }],
    touches: ["X", "X.kind"],
    final: (k) => assert.ok(tabFor(k.X)?.pinned && tabFor(k.X).pinnedAsRow, "X pinned again as a row"),
  },
  {
    name: "xTile",
    steps: [(k) => { const t = tabFor(k.X); if (t?.pinned && t.pinnedAsRow) (S().placeTabs([t.id], { pinned: true, row: false }), done(k, "xTile")); }],
    touches: ["X.kind"],
    final: (k) => { const t = tabFor(k.X); if (t?.pinned) assert.equal(!!t.pinnedAsRow, false, "X a tile"); },
  },
  {
    name: "xRow",
    steps: [(k) => { const t = tabFor(k.X); if (t?.pinned && !t.pinnedAsRow) (S().placeTabs([t.id], { pinned: true, row: true }), done(k, "xRow")); }],
    touches: ["X.kind"],
    final: (k) => { const t = tabFor(k.X); if (t?.pinned) assert.equal(!!t.pinnedAsRow, true, "X a row"); },
  },
  {
    name: "moveXIntoG",
    steps: [(k) => { const t = tabFor(k.X); const g = groupFor(k.G); if (t && g?.pinned) (S().placeTabs([t.id], { pinned: false, groupId: g.id }), done(k, "moveXIntoG")); }],
    touches: ["X", "G"],
    final: (k) => assert.ok(tabFor(k.X) && inContainer(S(), tabFor(k.X)), "X pinned, in G or on its own once G is gone"),
  },
  {
    name: "createHMoveX",
    steps: [
      (k) => { const w = Object.values(S().windows).find((x) => x.profileId === "default"); S().groupTabs([S().newTab(w.id, { url: "https://h.example/", background: true })], { pinned: true, name: "H" }); },
      (k) => { const h = Object.values(S().groups).find((g) => g.name === "H"); const t = tabFor(k.X); if (h && t) (S().placeTabs([t.id], { pinned: false, groupId: h.id }), done(k, "createHMoveX")); },
    ],
    touches: ["X", "H"],
    final: (k) => {
      const hs = Object.values(S().groups).filter((g) => g.name === "H" && g.pinned);
      assert.ok(hs.length, "H pinned");
      const urls = (g) => g.tabIds.map((id) => S().tabs[id].pinnedUrl ?? S().tabs[id].url);
      assert.ok(hs.every((h) => urls(h)[0] === "https://h.example/"), "each H keeps its first tab");
      assert.ok(hs.some((h) => h.tabIds.includes(tabFor(k.X)?.id)), "X in H");
    },
  },
  { name: "unpinG", steps: [(k) => { const g = groupFor(k.G); if (g?.pinned) (S().moveGroup(g.id, { pinned: false }), done(k, "unpinG")); }], touches: ["G", "M"], unpins: ["G", "M"], keeps: ["G", "M"], final: (k) => assert.equal(!!groupFor(k.G)?.pinned, false, "G unpinned") },
  {
    name: "repinG",
    steps: [(k) => { const g = groupFor(k.G); if (g) (S().moveGroup(g.id, { pinned: false }), S().moveGroup(g.id, { pinned: true }), done(k, "repinG")); }],
    touches: ["G", "M"],
    final: (k) => assert.ok(groupFor(k.G)?.pinned && groupFor(k.G).tabIds.some((id) => keyOf(S().tabs[id]) === k.M), "G pinned with M"),
  },
  { name: "deleteG", steps: [(k) => { const g = groupFor(k.G); if (g) (S().deleteGroup(g.id), done(k, "deleteG")); }], touches: ["G", "M"], unpins: ["G", "M"], final: (k) => assert.equal(!!groupFor(k.G)?.pinned, false, "G deleted") },
  { name: "renameX", steps: [(k) => { const t = tabFor(k.X); if (t) S().updateTab(t.id, { customTitle: "Renamed" }); }], touches: ["X"] },
  { name: "loadX", steps: [(k) => { const t = tabFor(k.X); if (!t) return; useBrowser.setState((s) => ({ tabs: { ...s.tabs, [t.id]: { ...s.tabs[t.id], unloaded: undefined, navigation: { url: t.url, seq: 1 } } } })); }], touches: [] },
  {
    name: "navXIntoG",
    steps: [
      (k) => {
        const t = tabFor(k.X);
        if (!t) return;
        useBrowser.setState((s) => ({ tabs: { ...s.tabs, [t.id]: { ...s.tabs[t.id], url: X_OTHER, unloaded: undefined, navigation: { url: X_OTHER, seq: 2 } } } }));
        const g = groupFor(k.G);
        if (g?.pinned) (S().placeTabs([t.id], { pinned: false, groupId: g.id }), done(k, "navXIntoG"));
      },
    ],
    touches: ["X", "G"],
    final: (k) => assert.ok(tabFor(k.X) && inContainer(S(), tabFor(k.X)), "X pinned, in G or on its own once G is gone"),
  },
  {
    name: "workRoundTrip",
    steps: [
      { run: (k) => { const t = tabFor(k.W1, "work"); if (t?.pinned) (S().moveTabToProfile(t.id, "default"), (k.moved = true), (k.w1Row = !!t.pinnedAsRow)); }, sync: ["default"] },
      (k) => { const t = k.moved && tabFor(k.W1, "default"); if (t) (S().moveTabToProfile(t.id, "work"), done(k, "workRoundTrip")); },
    ],
    touches: ["W1", "W1.kind"],
    final: (k) => assert.ok(tabFor(k.W1, "work")?.pinned && !!tabFor(k.W1, "work").pinnedAsRow === k.w1Row, "W1 back in Work as the kind it was"),
  },
  {
    name: "workTile",
    steps: [(k) => { const t = tabFor(k.W1, "work"); if (t?.pinned && t.pinnedAsRow) (S().placeTabs([t.id], { pinned: true, row: false }), done(k, "workTile")); }],
    touches: ["W1.kind"],
    final: (k) => { const t = tabFor(k.W1, "work"); if (t?.pinned) assert.equal(!!t.pinnedAsRow, false, "W1 a tile"); },
  },
];

const stepOf = (s) => (typeof s === "function" ? { run: s } : s);

async function runOp(mac, op, k, { syncs = true, hideFirst = false, folder } = {}) {
  for (const [i, step] of op.steps.map(stepOf).entries()) {
    mac.with(() => step.run(k));
    if (!syncs) continue;
    const before = new Set(folder.files.keys());
    await mac.sync(step.sync);
    if (hideFirst && i === 0) for (const id of folder.files.keys()) if (!before.has(id)) folder.hidden.add(id);
  }
}

const SCHEDULES = {
  "A then B": async (w, opA, opB) => {
    await runOp(w.a, opA, w.k, { folder: w.folder });
    await w.b.sync();
    await runOp(w.b, opB, w.k, { folder: w.folder });
    return "B";
  },
  "both, A syncs first": async (w, opA, opB) => {
    w.a.with(() => stepOf(opA.steps[0]).run(w.k));
    w.b.with(() => stepOf(opB.steps[0]).run(w.k));
    await w.a.sync();
    await w.b.sync();
    await runOp(w.a, { steps: opA.steps.slice(1) }, w.k, { folder: w.folder });
    await runOp(w.b, { steps: opB.steps.slice(1) }, w.k, { folder: w.folder });
    return opA.steps.length > 1 ? "A" : opB.steps.length > 1 ? "B" : "B";
  },
  "B's log delayed": async (w, opA, opB) => {
    const before = new Set(w.folder.files.keys());
    await runOp(w.b, opB, w.k, { folder: w.folder });
    for (const id of w.folder.files.keys()) if (!before.has(id)) w.folder.hidden.add(id);
    await runOp(w.a, opA, w.k, { folder: w.folder });
    w.folder.hidden.clear();
    return "A";
  },
  "A's first log delayed": async (w, opA, opB) => {
    await runOp(w.a, opA, w.k, { folder: w.folder, hideFirst: true });
    await w.b.sync();
    await runOp(w.b, opB, w.k, { folder: w.folder });
    w.folder.hidden.clear();
    return "B";
  },
};

function structure(mac) {
  mac.with(() => {
    const s = S();
    for (const win of Object.values(s.windows)) {
      assert.ok(win.tabIds.length, `${mac.id}: window ${win.id} has tabs`);
      for (const id of win.tabIds) assert.equal(s.tabs[id]?.windowId, win.id, `${mac.id}: ${id} belongs to ${win.id}`);
      for (const id of Object.values(win.activeTabIds)) assert.equal(s.tabs[id]?.windowId, win.id, `${mac.id}: active tab in ${win.id}`);
      for (const p of PROFILES) {
        const pinnedMember = new Set(Object.values(s.groups).filter((g) => g.pinned).flatMap((g) => g.tabIds));
        const rank = (id) => (s.tabs[id].pinned ? (s.tabs[id].pinnedAsRow ? 1 : 0) : pinnedMember.has(id) ? 2 : 3);
        const ranks = win.tabIds.filter((id) => s.tabs[id]?.profileId === p).map(rank);
        assert.deepEqual(ranks, [...ranks].sort(), `${mac.id}: tiles, rows, pinned groups, then tabs in ${win.id}`);
      }
    }
    for (const v of Object.values(s.splits)) for (const id of v.tabIds) assert.equal(s.tabs[id]?.windowId, v.windowId, `${mac.id}: split in its window`);
    for (const g of Object.values(s.groups)) for (const id of g.tabIds) assert.equal(s.tabs[id]?.windowId, g.windowId, `${mac.id}: group ${g.name} keeps its members in its window`);
  });
}

function signature(mac) {
  return mac.with(() => {
    const s = S();
    const out = {};
    for (const p of PROFILES) {
      const win = Object.values(s.windows).find((w) => w.profileId === p);
      const ids = win ? win.tabIds.filter((id) => s.tabs[id]?.profileId === p) : [];
      const park = s.parkedPins[p];
      out[p] = {
        tiles: ids.filter((id) => s.tabs[id].pinned && !s.tabs[id].pinnedAsRow).map((id) => keyOf(s.tabs[id])).concat((park?.tabs ?? []).filter((t) => !t.groupId && !t.pinnedAsRow).map((t) => t.id)),
        rows: ids.filter((id) => s.tabs[id].pinned && s.tabs[id].pinnedAsRow).map((id) => keyOf(s.tabs[id])).concat((park?.tabs ?? []).filter((t) => !t.groupId && t.pinnedAsRow).map((t) => t.id)),
        groups: Object.values(s.groups)
          .filter((g) => g.pinned && g.profileId === p && g.windowId === win?.id)
          .sort((x, z) => ids.indexOf(x.tabIds[0]) - ids.indexOf(z.tabIds[0]))
          .map((g) => [keyOf(g), g.name, g.tabIds.map((id) => keyOf(s.tabs[id]))])
          .concat((park?.groups ?? []).map((g) => [g.id, g.name, park.tabs.filter((t) => t.groupId === g.id).map((t) => t.id)])),
      };
    }
    return out;
  });
}

const touched = (op) => new Set(op.touches);
const overlap = (a, b) => [...touched(a)].some((t) => touched(b).has(t));

async function runPair(startRow, opA, opB, schedule) {
  const base = await world(startRow);
  const folder = base.folder.clone();
  const w = { folder, a: base.a.fork(folder), b: base.b.fork(folder), k: { ...base.k, done: new Set() } };
  const later = await SCHEDULES[schedule](w, opA, opB);
  for (let i = 0; i < 4; i++) for (const m of [w.a, w.b]) await m.sync();
  const idle = (await w.a.sync()) + (await w.b.sync());
  for (const m of [w.a, w.b]) structure(m);
  assert.deepEqual(signature(w.b), signature(w.a), "both Macs converge");
  assert.equal(idle, 0, "nothing more is sent once settled");
  const removed = new Set([...(did(w.k, opA, w.a) ? (opA.unpins ?? []) : []), ...(did(w.k, opB, w.b) ? (opB.unpins ?? []) : [])]);
  for (const m of [w.a, w.b]) {
    m.with(() => {
      for (const name of ["T", "X", "M", "W1"]) {
        if (removed.has(name) || [opA, opB].some((o) => o.touches.includes(name))) continue;
        const t = tabFor(w.k[name]);
        assert.ok(t && inContainer(S(), t), `${m.id}: ${name} still pinned`);
      }
    });
  }
  for (const [m, op] of [[w.a, opA], [w.b, opB]]) {
    if (!did(w.k, op, m)) continue;
    m.with(() => {
      for (const name of op.keeps ?? []) {
        if (name === "G") assert.ok(groupFor(w.k.G), `${m.id}: keeps the group it unpinned`);
        else assert.ok(tabFor(w.k[name]), `${m.id}: keeps ${name}`);
      }
    });
  }
  const ran = [[opA, w.a], [opB, w.b]].filter(([op, m]) => did(w.k, op, m) || !op.final);
  const later_ = later === "A" ? opA : opB;
  const finals = overlap(opA, opB) && ran.some(([op]) => op === later_) ? [later_] : ran.map(([op]) => op);
  for (const op of finals) for (const m of [w.a, w.b]) if (op.final) m.with(() => op.final(w.k));
}

const cases = [];
for (const startRow of [true, false])
  for (const opA of OPS)
    for (const opB of OPS)
      for (const schedule of Object.keys(SCHEDULES)) cases.push({ startRow, opA, opB, schedule });

test(`concurrent pinned-tab edits on two Macs converge (${cases.length} runs)`, async () => {
  const failures = [];
  for (const c of cases) {
    try {
      await runPair(c.startRow, c.opA, c.opB, c.schedule);
    } catch (error) {
      failures.push(`${c.startRow ? "row" : "tile"} X, A ${c.opA.name} / B ${c.opB.name}, ${c.schedule}: ${error.message.split("\n")[0]}`);
    }
  }
  if (failures.length) console.log(failures.join("\n"));
  assert.equal(failures.length, 0, `${failures.length} runs failed:\n${failures.slice(0, 40).join("\n")}`);
});


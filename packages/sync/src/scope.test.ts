import assert from "node:assert/strict";
import { test } from "node:test";
import { Clock } from "./hlc.ts";
import * as shipped from "./fixtures/scope-v0.2.38.ts";
import { compact, emptyScope, restoreJournal, syncScope, type Adapter, type Listing, type LogFile, type ScopeOptions, type ScopeState, type Transport } from "./scope.ts";

type Entry = { payload: string; hiddenFrom: Set<string>; partialFor: Set<string>; at: number };
class Folder {
  scopes = new Map<string, Map<string, Entry>>();
  counter = 0;
  now = 0;
  scope(name: string) {
    let s = this.scopes.get(name);
    if (!s) this.scopes.set(name, (s = new Map()));
    return s;
  }
  transport(device: string): Transport {
    return {
      write: async (scope, payload) => {
        const id = `f${++this.counter}`;
        this.scope(scope).set(id, { payload, hiddenFrom: new Set(), partialFor: new Set(), at: this.now });
        return id;
      },
      read: async (scope, known): Promise<Listing> => {
        const listing: Listing = { files: [], pending: [], damaged: [], present: [] };
        for (const [id, e] of this.scope(scope)) {
          listing.present.push(id);
          if (known.includes(id)) continue;
          if (e.hiddenFrom.has(device)) listing.pending.push(id);
          else if (e.partialFor.has(device)) listing.damaged.push({ id, age: 0 });
          else listing.files.push({ id, payload: e.payload });
        }
        return listing;
      },
      remove: async (scope, ids) => {
        for (const id of ids) this.scope(scope).delete(id);
      },
    };
  }
  fileCount(scope = "s") {
    return this.scope(scope).size;
  }
}

class Device {
  store = new Map<string, unknown>();
  settings = new Map<string, unknown>();
  state: ScopeState = emptyScope();
  clock: Clock;
  offset = 0;
  onRead?: () => void;
  failWrite?: "before" | "after";
  readonly id: string;
  readonly folder: Folder;
  readonly options: ScopeOptions;
  readonly shipped: boolean;
  constructor(id: string, folder: Folder, options: ScopeOptions = {}, isShipped = false) {
    this.id = id;
    this.folder = folder;
    this.options = options;
    this.shipped = isShipped;
    this.clock = new Clock(id, null, () => this.time());
  }
  compact() {
    return (this.shipped ? shipped.compact : compact)(this.state, this.folder.transport(this.id), "s", this.id, this.time(), { pruneGrace: 0, ...this.options }, true);
  }
  time() {
    return this.folder.now + this.offset;
  }
  adapters(): Adapter[] {
    return [
      {
        prefix: "x:",
        extract: () => ({ values: new Map(this.store) }),
        apply: (visible, changed) => {
          for (const k of changed) visible.has(k) ? this.store.set(k, visible.get(k)) : this.store.delete(k);
        },
      },
      {
        prefix: "set:",
        adoptRemoteOnJoin: true,
        extract: () => ({ values: new Map(this.settings) }),
        apply: (visible, changed) => {
          for (const k of changed) if (visible.has(k)) this.settings.set(k, visible.get(k));
        },
      },
    ];
  }
  async sync() {
    const base = this.folder.transport(this.id);
    const transport: Transport = {
      ...base,
      write: async (scope, payload) => {
        const fail = this.failWrite;
        delete this.failWrite;
        if (fail === "before") throw new Error("offline");
        const id = await base.write(scope, payload);
        if (fail === "after") throw new Error("timed out");
        return id;
      },
      read: async (scope, known) => {
        const listing = await base.read(scope, known);
        this.onRead?.();
        return listing;
      },
    };
    return ((this.shipped ? shipped.syncScope : syncScope) as typeof syncScope)({
      scope: "s",
      state: this.state,
      transport,
      adapters: this.adapters(),
      clock: this.clock,
      device: this.id,
      now: () => this.time(),
      options: { pruneGrace: 0, persist: async (batches) => this.persist(batches), ...this.options },
    });
  }
  relaunch() {
    this.state = JSON.parse(JSON.stringify(this.state)) as ScopeState;
    this.clock = new Clock(this.id, this.clock.last, () => this.time());
  }
  saved = JSON.stringify(emptyScope());
  savedClock: string | null = null;
  journal = new Map<number, LogFile>();
  persist(batches: LogFile[]) {
    for (const f of batches) this.journal.set(f.seq, JSON.parse(JSON.stringify(f)) as LogFile);
  }
  save() {
    this.saved = JSON.stringify(this.state);
    this.savedClock = this.clock.last;
    for (const seq of this.journal.keys()) if (seq <= this.state.seq) this.journal.delete(seq);
  }
  crash() {
    this.state = JSON.parse(this.saved) as ScopeState;
    this.clock = new Clock(this.id, this.savedClock, () => this.time());
    restoreJournal(this.state, [...this.journal.values()], this.clock);
  }
}

const snapshot = (d: Device) => Object.fromEntries([...d.store].sort(([a], [b]) => a.localeCompare(b)));
async function syncAll(devices: Device[], rounds = 2) {
  for (let i = 0; i < rounds; i++) for (const d of devices) await d.sync();
}

test("concurrent edits converge on the newest, whatever order devices sync in", async () => {
  for (const order of [["devA", "devB"], ["devB", "devA"]]) {
    const folder = new Folder();
    const a = new Device("devA", folder);
    const b = new Device("devB", folder);
    a.store.set("x:k", "base");
    await syncAll([a, b]);
    folder.now += 10;
    a.store.set("x:k", "A's edit");
    folder.now += 10;
    b.store.set("x:k", "B's edit (later)");
    const devices = order.map((id) => (id === "devA" ? a : b));
    await syncAll(devices, 3);
    assert.deepEqual(snapshot(a), snapshot(b));
    assert.equal(a.store.get("x:k"), "B's edit (later)");
    assert.deepEqual(a.state.records, b.state.records);
  }
});

test("deletes propagate; a re-add after a delete wins; an edit after a delete wins", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  a.store.set("x:1", "one");
  a.store.set("x:2", "two");
  await syncAll([a, b]);
  folder.now += 5;
  b.store.delete("x:1");
  await syncAll([b, a]);
  assert.equal(a.store.has("x:1"), false);
  folder.now += 5;
  a.store.set("x:1", "one again");
  await syncAll([a, b]);
  assert.equal(b.store.get("x:1"), "one again");
  folder.now += 5;
  a.store.delete("x:2");
  folder.now += 5;
  b.store.set("x:2", "two, edited");
  await syncAll([a, b, a]);
  assert.equal(a.store.get("x:2"), "two, edited");
  assert.deepEqual(snapshot(a), snapshot(b));
});

test("clock skew: an edit made after seeing another device's wins even with a slow clock", async () => {
  const folder = new Folder();
  folder.now = 10_000_000;
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  b.offset = -3_600_000;
  a.store.set("x:k", "A");
  await syncAll([a, b]);
  assert.equal(b.store.get("x:k"), "A");
  folder.now += 1000;
  b.store.set("x:k", "B, after seeing A");
  await syncAll([b, a]);
  assert.equal(a.store.get("x:k"), "B, after seeing A");
  const c = new Device("devC", folder);
  c.offset = 3 * 86_400_000;
  c.store.set("x:k", "C from the future");
  await syncAll([c, a, b]);
  assert.equal(a.store.get("x:k"), "C from the future");
  folder.now += 1000;
  a.store.set("x:k", "A, after C");
  await syncAll([a, b, c]);
  for (const d of [a, b, c]) assert.equal(d.store.get("x:k"), "A, after C");
});

test("files arriving late, out of order or cut short are read when they're whole", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  a.store.set("x:1", "v1");
  await a.sync();
  a.store.set("x:1", "v2");
  a.store.set("x:2", "second");
  await a.sync();
  const [first, second] = [...folder.scope("s").values()];
  first!.hiddenFrom.add("devB");
  second!.partialFor.add("devB");
  const r = await b.sync();
  assert.equal(r.pending, 1);
  assert.equal(b.store.size, 0);
  assert.equal(Object.keys(b.state.damaged).length, 1);
  second!.partialFor.clear();
  await b.sync();
  assert.deepEqual(snapshot(b), { "x:1": "v2", "x:2": "second" });
  assert.equal(b.state.vv.devA ?? 0, 0);
  assert.deepEqual(b.state.extra.devA, [2]);
  first!.hiddenFrom.clear();
  await b.sync();
  assert.deepEqual(snapshot(b), { "x:1": "v2", "x:2": "second" });
  assert.equal(b.state.vv.devA, 2);
  assert.equal(b.state.extra.devA, undefined);
});

test("a local edit made while files are read isn't overwritten", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  a.store.set("x:k", "old");
  await syncAll([a, b]);
  folder.now += 10;
  a.store.set("x:k", "A remote");
  await a.sync();
  folder.now += 10;
  b.onRead = () => {
    b.store.set("x:k", "B, typed during the read");
    b.onRead = undefined;
  };
  await b.sync();
  assert.equal(b.store.get("x:k"), "B, typed during the read");
  await syncAll([a, b]);
  assert.equal(a.store.get("x:k"), "B, typed during the read");
});

test("three devices, random edits, sync orders and crashes, converge", async () => {
  let seed = 7;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  let compactions = 0;
  for (let run = 0; run < 40; run++) {
    const folder = new Folder();
    const opts = { compactAfterFiles: 6, compactInterval: 0 };
    const devices = ["devA", "devB", "devC"].map((id) => new Device(id, folder, opts));
    for (let step = 0; step < 40; step++) {
      folder.now += Math.floor(random() * 50);
      const d = devices[Math.floor(random() * 3)]!;
      const key = `x:${Math.floor(random() * 6)}`;
      const r = random();
      if (r < 0.5) d.store.set(key, `${d.id}-${step}`);
      else if (r < 0.7) d.store.delete(key);
      else if (r < 0.75) d.relaunch();
      else if (r < 0.8) d.crash();
      else await d.sync();
      if (random() < 0.4) d.save();
      if (random() < 0.3) await devices[Math.floor(random() * 3)]!.sync();
      for (const e of folder.scope("s").values()) {
        if (random() < 0.15) e.hiddenFrom.add(devices[Math.floor(random() * 3)]!.id);
        if (random() < 0.1) e.partialFor.add(devices[Math.floor(random() * 3)]!.id);
        if (random() < 0.3) e.hiddenFrom.clear();
        if (random() < 0.3) e.partialFor.clear();
      }
    }
    for (const e of folder.scope("s").values()) {
      e.hiddenFrom.clear();
      e.partialFor.clear();
    }
    await syncAll(devices, 3);
    compactions += [...folder.scope("s").values()].filter((e) => e.payload.includes('"snapshot"')).length;
    const [a, b, c] = devices;
    assert.deepEqual(snapshot(a!), snapshot(b!), `run ${run}`);
    assert.deepEqual(snapshot(b!), snapshot(c!), `run ${run}`);
    assert.deepEqual(a!.state.records, b!.state.records, `run ${run}`);
  }
  assert.ok(compactions > 0);
});

test("an old snapshot put back after its tombstones were collected doesn't bring deleted records back", async () => {
  const folder = new Folder();
  const day = 86_400_000;
  const opts: ScopeOptions = { compactAfterFiles: 1000, compactInterval: 0, tombstoneTTL: 7 * day };
  const a = new Device("devA", folder, opts);
  const b = new Device("devB", folder, opts);
  a.store.set("x:keep", 1);
  a.store.set("x:secret", "hunter2");
  await syncAll([a, b]);
  await compact(a.state, folder.transport("devA"), "s", "devA", folder.now, { ...opts, pruneGrace: 0 }, true);
  const [oldId, old] = [...folder.scope("s")].find(([, e]) => e.payload.includes('"snapshot"'))!;
  assert.ok(old.payload.includes("hunter2"));
  folder.now += day;
  a.store.delete("x:secret");
  await syncAll([a, b]);
  assert.equal(b.store.has("x:secret"), false);
  folder.now += 30 * day;
  a.store.set("x:later", 3);
  await syncAll([a, b]);
  for (const d of [a, b]) await compact(d.state, folder.transport(d.id), "s", d.id, folder.now, { ...opts, pruneGrace: 0 }, true);
  for (const d of [a, b]) assert.equal(d.state.records["x:secret"], undefined, `${d.id} collected the tombstone`);
  assert.equal(folder.scope("s").has(oldId), false);

  folder.scope("s").set(oldId, { ...old, hiddenFrom: new Set(), partialFor: new Set() });
  await syncAll([a, b]);
  assert.equal(a.store.has("x:secret"), false, "A");
  assert.equal(b.store.has("x:secret"), false, "B");
  const c = new Device("devC", folder, opts);
  const entries = [...folder.scope("s")];
  folder.scopes.set("s", new Map([...entries.filter(([id]) => id !== oldId), [oldId, folder.scope("s").get(oldId)!]]));
  await c.sync();
  assert.equal(c.store.has("x:secret"), false, "C");
  assert.deepEqual(snapshot(c), snapshot(a));
});

const day = 86_400_000;
const rare: ScopeOptions = { compactAfterFiles: 1000, compactInterval: 0 };
const logsIn = (folder: Folder) => [...folder.scope("s").values()].filter((e) => e.payload.includes('"kind":"log"'));

async function deleteWithFirstLogLate(folder: Folder, lateFor: string[]) {
  const a = new Device("devA", folder, rare);
  a.store.set("x:gone", "old");
  await a.sync();
  const first = logsIn(folder).find((e) => e.payload.includes('"old"'))!;
  for (const id of lateFor) first.hiddenFrom.add(id);
  a.store.delete("x:gone");
  await a.sync();
  return { a, first };
}

test("a Mac that joins from a snapshot keeps its gaps, so a late log can't bring a deletion back", async () => {
  const folder = new Folder();
  const { first } = await deleteWithFirstLogLate(folder, ["devB", "devC"]);
  const b = new Device("devB", folder, rare);
  await b.sync();
  assert.deepEqual(b.state.extra.devA, [2]);
  folder.now += 46 * day;
  await b.compact();
  for (const e of logsIn(folder)) e.hiddenFrom.add("devC");
  const c = new Device("devC", folder, rare);
  await c.sync();
  assert.deepEqual(c.state.extra.devA, [2], "the gap comes with the snapshot");
  await c.compact();
  for (const e of folder.scope("s").values()) e.hiddenFrom.clear();
  await syncAll([c, b]);
  assert.equal(c.store.has("x:gone"), false, "C");
  assert.equal(b.store.has("x:gone"), false, "B");
});

test("a log that turns up 91 days late can't bring a deletion back either", async () => {
  const folder = new Folder();
  const { first } = await deleteWithFirstLogLate(folder, ["devB"]);
  const b = new Device("devB", folder, rare);
  await b.sync();
  folder.now += 91 * day;
  await b.compact();
  assert.equal(b.state.records["x:gone"]?.v, null, "kept while log 1 is missing");
  first.hiddenFrom.clear();
  await b.sync();
  assert.equal(b.store.has("x:gone"), false);
});

test("tombstones are collected once every Mac has them, and a Mac that only reads still counts", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder, rare);
  const b = new Device("devB", folder, rare);
  const c = new Device("devC", folder, rare);
  a.store.set("x:gone", "old");
  await syncAll([a, b, c]);
  a.store.delete("x:gone");
  await syncAll([a, b]);
  folder.now += 46 * day;
  await syncAll([a, b]);
  for (const d of [a, b]) await d.compact();
  assert.equal(a.state.records["x:gone"]?.v, null, "C hasn't seen the deletion yet");
  await syncAll([c, a, b]);
  folder.now += day;
  await syncAll([c, a, b]);
  for (const d of [a, b, c]) await d.compact();
  for (const d of [a, b, c]) assert.equal(d.state.records["x:gone"], undefined, `${d.id} collected it`);
  for (const d of [a, b, c]) assert.equal(d.store.has("x:gone"), false);
});

test("a Mac silent for 180 days is retired: its gaps and logs stop holding anything, and its late logs are ignored", async () => {
  const folder = new Folder();
  const a = new Device("gapA", folder, rare);
  const b = new Device("gapB", folder, rare);
  for (let i = 0; i <= 100; i++) {
    a.store.set("x:counter", i);
    await a.sync();
  }
  const first = logsIn(folder)[0]!;
  first.hiddenFrom.add("gapB");
  await b.sync();
  assert.equal(b.state.extra.gapA?.length, 100);
  folder.now += 200 * day;
  await b.compact();
  assert.ok(b.state.retired?.gapA);
  assert.equal(b.state.extra.gapA, undefined);
  const fromA = () => logsIn(folder).filter((e) => e.payload.includes('"gapA"')).length;
  assert.equal(fromA(), 1, "only the log it never saw is left");
  first.hiddenFrom.clear();
  await b.sync();
  assert.equal(b.store.get("x:counter"), 100, "its late first log is ignored");
  await b.compact();
  assert.equal(fromA(), 0);
  assert.ok(folder.fileCount() <= 3, `${folder.fileCount()} files left`);
});

test("a retired Mac that comes back starts over from the folder and keeps syncing", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder, rare);
  const b = new Device("devB", folder, rare);
  a.store.set("x:1", "a");
  a.store.set("x:old", "kept");
  await syncAll([a, b]);
  a.store.set("x:1", "offline");
  a.store.set("x:new", "made offline");
  a.store.delete("x:old");
  folder.now += 181 * day;
  b.store.set("x:2", "b");
  await b.sync();
  await b.compact();
  assert.ok(b.state.retired?.devA);
  await a.sync();
  assert.equal(a.state.epoch, 1, "it rebased");
  await syncAll([a, b]);
  assert.deepEqual(snapshot(a), { "x:1": "a", "x:2": "b", "x:old": "kept" }, "edits made while retired are dropped");
  assert.deepEqual(snapshot(b), snapshot(a));
  a.store.set("x:3", "after");
  await syncAll([a, b]);
  assert.equal(b.store.get("x:3"), "after");
  const sent = [await a.sync(), await b.sync()].reduce((n, r) => n + r.published, 0);
  assert.equal(sent, 0, "nothing more is sent");
});

test("a deletion an older Mac collected and then brought back is put back", async () => {
  const folder = new Folder();
  const { first } = await deleteWithFirstLogLate(folder, ["devB", "old"]);
  const b = new Device("devB", folder, rare);
  const old = new Device("old", folder, rare, true);
  await b.sync();
  await old.sync();
  folder.now += 46 * day;
  await old.compact();
  first.hiddenFrom.delete("old");
  await old.sync();
  assert.equal(old.store.get("x:gone"), "old", "the older Mac brought it back");
  await old.compact();
  const c = new Device("devC", folder, rare);
  await syncAll([b, c, old], 3);
  for (const d of [b, c, old]) assert.equal(d.store.has("x:gone"), false, d.id);
});

test("an older Mac's snapshot can't make a newer one drop a tombstone it still needs", async () => {
  const folder = new Folder();
  const { first } = await deleteWithFirstLogLate(folder, ["devB", "devC"]);
  const b = new Device("devB", folder, rare);
  const old = new Device("old", folder, rare, true);
  await old.sync();
  await b.sync();
  folder.now += 46 * day;
  await old.compact();
  await b.sync();
  assert.equal(b.state.records["x:gone"]?.v, null, "B keeps its tombstone");
  const c = new Device("devC", folder, rare);
  await c.sync();
  first.hiddenFrom.clear();
  await syncAll([b, c]);
  assert.equal(b.store.has("x:gone"), false, "B");
  assert.equal(c.store.has("x:gone"), false, "C");
});

test("a failed write is retried as the same batch, even when the file did land", async () => {
  const folder = new Folder();
  const a = new Device("devA", folder);
  const b = new Device("devB", folder);
  for (const fail of ["after", "before"] as const) {
    a.store.set(`x:${fail}`, 1);
    a.failWrite = fail;
    await assert.rejects(a.sync());
    a.store.set(`x:${fail}-next`, 2);
    await syncAll([a, b]);
    assert.deepEqual(snapshot(b), snapshot(a), fail);
  }
  assert.equal(b.store.get("x:after-next"), 2);
  const files = [...folder.scope("s").values()].map((e) => e.payload);
  assert.equal(files.length, new Set(files).size + 1, "only the batch whose write threw after landing is there twice");
});

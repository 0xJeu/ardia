import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;

const { useBrowser } = await import("../store/browser.ts");
const { Clock, emptyScope, syncScope } = await import("@ardia/sync");
const adapters = await import("./adapters.ts");

const S = () => useBrowser.getState();
const LINKS = () => ({ default: { syncId: "s1" } });

const THEME = {
  stops: [
    { x: 0.2, y: 0.3, color: { r: 0.3, g: 0.75, b: 0.45, a: 1 } },
    { x: 0.8, y: 0.7, color: { r: 0.85, g: 0.3, b: 0.65, a: 1 } },
  ],
  intensity: 0.8,
  mode: "auto",
  grain: 0.4,
  texture: "grain",
  translucency: 1,
};

function profilesAdapterV0238(links) {
  const linked = () => Object.entries(links()).filter(([id]) => S().profiles[id]);
  return {
    prefix: "prof:",
    adoptRemoteOnJoin: true,
    extract: () => {
      const values = new Map();
      for (const [id, { syncId }] of linked()) {
        const p = S().profiles[id];
        values.set(`prof:${syncId}`, { n: p.name, c: p.color, i: p.icon, ...(id === "default" ? { d: true } : {}) });
      }
      const mine = new Set(values.keys());
      return { values, ignore: (key) => !mine.has(key) };
    },
    apply: (visible, changed) => {
      for (const [id, { syncId }] of linked()) {
        const record = visible.get(`prof:${syncId}`);
        if (!record || !changed.has(`prof:${syncId}`)) continue;
        S().updateProfile(id, { name: record.n, color: record.c, icon: record.i });
      }
    },
  };
}

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
        const here = [...this.files].filter(([, f]) => f.scope === scope);
        const files = here.filter(([id]) => !known.includes(id)).map(([id, f]) => ({ id, payload: f.payload }));
        return { files, pending: [], damaged: [], present: here.map(([id]) => id) };
      },
      remove: async (_scope, ids) => ids.forEach((id) => this.files.delete(id)),
    };
  }
}

class Mac {
  constructor(id, folder, { legacy = false, joining = false } = {}) {
    this.id = id;
    this.folder = folder;
    S().hydrate({});
    this.browser = S();
    this.scope = emptyScope();
    this.scope.joined = !joining;
    this.clock = new Clock(id);
    this.adapters = legacy ? [profilesAdapterV0238(LINKS)] : [adapters.profilesAdapter(LINKS), adapters.profileThemesAdapter(LINKS)];
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
      const result = await syncScope({
        scope: "app",
        state: this.scope,
        transport: this.folder.transport(),
        adapters: this.adapters,
        clock: this.clock,
        device: this.id,
      });
      return result.published;
    } finally {
      this.browser = S();
    }
  }
  profile() {
    return this.browser.profiles.default;
  }
}

async function rounds(macs, n) {
  let published = 0;
  for (let i = 0; i < n; i++) for (const mac of macs) published += await mac.sync();
  return published;
}

test("a Mac on 0.2.38 and a Mac with a custom theme settle instead of republishing the profile forever", async () => {
  const folder = new Folder();
  const fresh = new Mac("new", folder);
  fresh.with(() => S().updateProfile("default", { color: "green", theme: THEME }));
  await fresh.sync();
  const old = new Mac("old", folder, { legacy: true, joining: true });
  await rounds([fresh, old], 3);
  assert.equal(await rounds([fresh, old], 4), 0, "nothing is published once both Macs have synced");
  assert.deepEqual(fresh.profile().theme, THEME);
  assert.equal(old.profile().color, "green", "the older Mac keeps the preset colour");
  assert.equal(old.profile().theme, undefined);

  old.with(() => S().updateProfile("default", { name: "Home" }));
  await rounds([fresh, old], 3);
  assert.equal(fresh.profile().name, "Home");
  assert.deepEqual(fresh.profile().theme, THEME, "a rename on the older Mac leaves the theme alone");
  assert.equal(await rounds([fresh, old], 4), 0, "and they settle again");
});

test("a rename on one Mac doesn't undo going back to a preset on another", async () => {
  const folder = new Folder();
  const a = new Mac("a", folder);
  a.with(() => S().updateProfile("default", { theme: THEME }));
  await a.sync();
  const b = new Mac("b", folder, { joining: true });
  await rounds([a, b], 3);
  assert.deepEqual(b.profile().theme, THEME);

  a.with(() => S().updateProfile("default", { theme: null }));
  b.with(() => S().updateProfile("default", { name: "Work" }));
  await a.sync();
  await b.sync();
  await rounds([a, b], 3);
  for (const mac of [a, b]) {
    assert.equal(mac.profile().theme, null, `${mac.id} keeps the preset`);
    assert.equal(mac.profile().name, "Work", `${mac.id} has the rename`);
  }
  assert.equal(await rounds([a, b], 4), 0);
});

test("a theme in a prof: record from a development build is adopted once and not written back there", async () => {
  const folder = new Folder();
  const dev = new Mac("dev", folder, { legacy: true });
  dev.adapters = [
    {
      ...profilesAdapterV0238(LINKS),
      extract: () => ({ values: new Map([["prof:s1", { n: "Personal", c: "plum", i: null, d: true, th: THEME }]]) }),
    },
  ];
  await dev.sync();
  const fresh = new Mac("new", folder, { joining: true });
  await rounds([fresh], 2);
  assert.deepEqual(fresh.profile().theme, THEME);
  const prof = fresh.scope.records["prof:s1"].v;
  assert.ok(!("th" in prof) || prof.o !== "new");
  assert.ok(fresh.scope.records["pth:s1"], "the theme is published as its own record");
});

test("a malformed theme record is ignored", () => {
  assert.equal(adapters.themeFromRecord({ t: { stops: "no" } }), null);
  assert.equal(adapters.themeFromRecord(null), null);
  assert.deepEqual(adapters.themeFromRecord({ preset: true }), { theme: null });
});

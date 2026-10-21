import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.setTimeout = () => 0;
globalThis.clearTimeout = () => {};
globalThis.__DEV__ = false;

const folder = new Map();
let ids = 0;
globalThis.acTestNativeModules = {
  ArdiaSync: {
    newDeviceId: () => `id${++ids}`,
    deviceName: () => "Test Mac",
    createPhrase: async () => true,
    createChain: async () => {},
    enterPhrase: async () => ({ ok: true }),
    unlock: async () => true,
    forget: async () => {},
    chainStatus: async () => "ok",
    write: async (_folder, scope, payload) => {
      const id = `f${folder.size + 1}`;
      folder.set(id, { scope, payload });
      return id;
    },
    read: async (_folder, scope, known) => {
      const here = [...folder].filter(([, f]) => f.scope === scope);
      const files = here.filter(([id]) => !known.includes(id)).map(([id, f]) => ({ id, payload: f.payload }));
      return { files, pending: [], damaged: [], present: here.map(([id]) => id) };
    },
    remove: async (_folder, _scope, list) => list.forEach((id) => folder.delete(id)),
    sealLocal: async (text) => `sealed:${text}`,
    openLocal: async (sealed) => (sealed.startsWith("sealed:") ? sealed.slice(7) : null),
    readPasswords: async () => null,
  },
};

const shell = await import("@ardia/shell");
const { useBrowser } = await import("../store/browser.ts");
const { sharingProfiles } = await import("../store/profiles.ts");
const S = () => useBrowser.getState();

class Mac {
  constructor(name) {
    this.name = name;
    S().hydrate({});
    useBrowser.setState({ bookmarksReady: { default: true } });
    this.browser = S();
    this.docs = new Map();
  }
  async with(fn) {
    useBrowser.setState(this.browser, true);
    shell.docs.clear();
    for (const [k, v] of this.docs) shell.docs.set(k, v);
    try {
      return await fn();
    } finally {
      this.browser = S();
      this.docs = new Map(shell.docs);
    }
  }
}

const published = (prefix) =>
  [...folder.values()]
    .map((f) => JSON.parse(f.payload))
    .flatMap((f) => f.ops ?? Object.entries(f.records ?? {}).map(([k, r]) => ({ k, v: r.v })))
    .filter((op) => op.k.startsWith(prefix));

const THEME_B = {
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
const THEME_A = { ...THEME_B, intensity: 0.3, stops: [{ x: 0.5, y: 0.1, color: { r: 0.2, g: 0.3, b: 0.9, a: 1 } }] };

async function pairAgainstExistingTheme(local, tag) {
  folder.clear();
  const a = new Mac("A");
  const c = new Mac("C");
  const engineA = await import(`./engine.ts?pairA${tag}`);
  const engineC = await import(`./engine.ts?pairC${tag}`);
  await a.with(async () => {
    S().updateProfile("default", { theme: THEME_B });
    engineA.startSync();
    assert.ok("ok" in (await engineA.turnOnSync("/sync")));
    await engineA.syncNow();
    await engineA.syncNow();
  });
  await c.with(async () => {
    if (local) S().updateProfile("default", { theme: local });
    engineC.startSync();
    assert.ok("ok" in (await engineC.enterRecoveryPhrase("/sync", "words")));
    await engineC.syncNow();
    await engineC.syncNow();
    assert.deepEqual(S().profiles.default.theme, THEME_B, "the paired profile takes the synced theme");
  });
  for (let i = 0; i < 2; i++) {
    await a.with(() => engineA.syncNow());
    await c.with(() => engineC.syncNow());
  }
  await a.with(() => assert.deepEqual(S().profiles.default.theme, THEME_B, "the first Mac keeps its theme"));
  await c.with(() => assert.deepEqual(S().profiles.default.theme, THEME_B));
  const themes = published("pth:").map((op) => op.v);
  assert.ok(themes.every((v) => JSON.stringify(v) === JSON.stringify({ t: THEME_B })), `only the synced theme is ever published: ${JSON.stringify(themes)}`);
}

test("a Mac joining sync pairs its profile and takes the synced theme", () => pairAgainstExistingTheme(null, "1"));

test("a Mac joining sync with its own theme takes the synced one instead of publishing over it", () => pairAgainstExistingTheme(THEME_A, "2"));

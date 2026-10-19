import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;

const PATH = "/private/tmp/data/Scripts/extension";
const installed = new Map();
const calls = [];
let folder = { state: "empty" };
let gate = null;
const fake = (globalThis.acTestUserScripts = {
  watching: [],
  writes: [],
  status: null,
  change: null,
  read: async () => folder,
  engine: {
    list: async (profile) => [...(installed.get(profile) ?? new Map()).values()],
    install: async (path, profile) => {
      calls.push(["install", profile]);
      if (gate) await gate;
      const exts = installed.get(profile) ?? new Map();
      const prior = exts.get("abc");
      exts.set("abc", { id: "abc", path, enabled: prior ? prior.enabled : true, state: prior && !prior.enabled ? "DISABLED" : "ENABLED" });
      installed.set(profile, exts);
      return "abc";
    },
    reload: async (id, profile) => void calls.push(["reload", profile]),
    uninstall: async (id, profile) => void (calls.push(["uninstall", profile]), installed.get(profile)?.delete(id)),
  },
});

const { useBrowser } = await import("../store/browser.ts");
const scripts = await import("./userScripts.ts");
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};
const profile = (id, name, dataId) => ({ id, name, color: "blue", icon: null, createdAt: 0, ...(dataId ? { dataId } : {}) });
useBrowser.setState({ profiles: { default: profile("default", "Personal") }, profileOrder: ["default"] });
const lastWrite = () => fake.writes.at(-1);

scripts.startUserScripts();

test("nothing happens while the setting is off", async () => {
  folder = { state: "ready", generation: 1, path: PATH };
  await settle();
  assert.deepEqual(fake.watching, []);
  assert.equal(fake.writes.length, 0);
  assert.equal(calls.length, 0);
});

test("turning the setting on watches and loads into every profile", async () => {
  useBrowser.getState().updateSettings({ cliControl: true });
  await settle();
  assert.deepEqual(fake.watching, [true]);
  assert.deepEqual(calls, [["install", ""]]);
  assert.deepEqual(lastWrite(), { generation: 1, profiles: { Personal: { ok: true } } });
});

test("the same generation again does nothing, a new one reloads in place", async () => {
  calls.length = 0;
  fake.change();
  await settle();
  assert.equal(calls.length, 0);
  folder = { state: "ready", generation: 2, path: PATH };
  fake.change();
  await settle();
  assert.deepEqual(calls, [["install", ""]]);
  assert.equal(installed.get("").size, 1);
  assert.deepEqual(lastWrite(), { generation: 2, profiles: { Personal: { ok: true } } });
});

test("a profile the user disabled it in stays disabled", async () => {
  calls.length = 0;
  installed.get("").get("abc").enabled = false;
  folder = { state: "ready", generation: 3, path: PATH };
  fake.change();
  await settle();
  assert.deepEqual(calls, [["reload", ""]]);
  assert.equal(installed.get("").get("abc").enabled, false);
  assert.deepEqual(lastWrite(), { generation: 3, profiles: { Personal: { disabled: true } } });
  installed.get("").get("abc").enabled = true;
});

test("a refused manifest is never loaded, removes the copy Chrome read from disk, and reports the error", async () => {
  calls.length = 0;
  folder = { state: "invalid", generation: 4, path: PATH, error: 'manifest.json may not contain "permissions"' };
  fake.change();
  await settle();
  assert.deepEqual(calls, [["uninstall", ""]]);
  assert.deepEqual(lastWrite(), { generation: 4, profiles: { Personal: { error: 'manifest.json may not contain "permissions"' } } });
});

test("a new profile gets it, a profile sharing data reports the same, duplicate names stay apart", async () => {
  calls.length = 0;
  folder = { state: "ready", generation: 5, path: PATH };
  fake.change();
  await settle();
  calls.length = 0;
  useBrowser.setState({
    profiles: { default: profile("default", "Personal"), work: profile("work", "Personal"), shared: profile("shared", "Side", "work") },
    profileOrder: ["default", "work", "shared"],
  });
  await settle();
  assert.deepEqual(calls, [["install", "work"]]);
  assert.deepEqual(lastWrite(), { generation: 5, profiles: { Personal: { ok: true }, "Personal (2)": { ok: true }, Side: { ok: true } } });
});

test("a newer generation mid-load drops the stale status and reconciles once more", async () => {
  calls.length = 0;
  const writes = fake.writes.length;
  let open;
  gate = new Promise((r) => (open = r));
  folder = { state: "ready", generation: 6, path: PATH };
  fake.change();
  await settle();
  folder = { state: "ready", generation: 7, path: PATH };
  fake.change();
  fake.change();
  gate = null;
  open();
  await settle();
  assert.deepEqual(fake.writes.slice(writes).map((w) => w.generation), [7]);
});

test("removal uninstalls everywhere", async () => {
  calls.length = 0;
  folder = { state: "absent", generation: 8, path: PATH };
  fake.change();
  await settle();
  assert.deepEqual(calls.filter(([k]) => k === "uninstall").map(([, p]) => p).sort(), ["", "work"]);
  assert.equal(lastWrite().generation, 8);
});

test("turning the setting off stops watching and ignores changes", async () => {
  calls.length = 0;
  const writes = fake.writes.length;
  useBrowser.getState().updateSettings({ cliControl: false });
  await settle();
  assert.equal(fake.watching.at(-1), false);
  folder = { state: "ready", generation: 9, path: PATH };
  fake.change();
  await settle();
  assert.equal(calls.length, 0);
  assert.equal(fake.writes.length, writes);
});

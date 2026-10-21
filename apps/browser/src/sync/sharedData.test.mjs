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

test("a profile that shares data on one Mac shares the same profile's data on the Mac that adds it from sync", async () => {
  const a = new Mac("A");
  const b = new Mac("B");
  const engineA = await import("./engine.ts?macA");
  const engineB = await import("./engine.ts?macB");

  const onA = await a.with(async () => {
    const work = S().createProfile({ name: "Work", shareWith: "default" });
    const home = S().createProfile({ name: "Home" });
    const kids = S().createProfile({ name: "Kids", shareWith: home });
    assert.deepEqual(sharingProfiles(S(), "default"), [work], "Personal and Work share on the first Mac");
    engineA.startSync();
    assert.ok("ok" in (await engineA.turnOnSync("/sync")));
    await engineA.syncNow();
    await engineA.syncNow();
    return { work, home, kids, links: { ...engineA.useSync.getState().profiles } };
  });

  for (const op of published("prof:")) assert.deepEqual(Object.keys(op.v).filter((k) => !["n", "c", "i", "d", "th"].includes(k)), [], "prof: records keep the shape older Macs publish");

  await b.with(async () => {
    S().createProfile({ name: "Home" });
    engineB.startSync();
    assert.ok("ok" in (await engineB.enterRecoveryPhrase("/sync", "words")));
    await engineB.syncNow();
    await engineB.syncNow();

    const remote = engineB.useSync.getState().remoteProfiles;
    const work = remote.find((p) => p.name === "Work");
    const kids = remote.find((p) => p.name === "Kids");
    assert.deepEqual(work?.sharesWith, { name: "Personal", added: false });
    assert.deepEqual(kids?.sharesWith, { name: "Home", added: false }, "Home paired by name, so Kids shares this Mac's Home");

    const workHere = engineB.addRemoteProfile(work.syncId);
    assert.ok(workHere);
    assert.equal(S().profiles[workHere].dataId, "default");
    assert.deepEqual(sharingProfiles(S(), "default"), [workHere], "Settings › Profiles › Personal shows Shared data on the second Mac");

    const homeHere = S().profileOrder.find((id) => S().profiles[id].name === "Home");
    assert.notEqual(homeHere, onA.home, "the owner's profile id differs per Mac");
    const kidsHere = engineB.addRemoteProfile(kids.syncId);
    assert.equal(S().profiles[kidsHere].dataId, homeHere, "the link resolves to this Mac's own profile for that owner");
  });
});

test("adding a profile whose owner isn't on this Mac adds the owner too, sharing its data", async () => {
  const a = new Mac("A");
  const c = new Mac("C");
  folder.clear();
  const engineA = await import("./engine.ts?macA2");
  const engineC = await import("./engine.ts?macC");

  await a.with(async () => {
    const school = S().createProfile({ name: "School" });
    S().createProfile({ name: "Homework", shareWith: school });
    engineA.startSync();
    assert.ok("ok" in (await engineA.turnOnSync("/sync")));
    await engineA.syncNow();
    await engineA.syncNow();
  });

  await c.with(async () => {
    engineC.startSync();
    assert.ok("ok" in (await engineC.enterRecoveryPhrase("/sync", "words")));
    await engineC.syncNow();
    await engineC.syncNow();
    const homework = engineC.useSync.getState().remoteProfiles.find((p) => p.name === "Homework");
    assert.deepEqual(homework?.sharesWith, { name: "School", added: true });
    const id = engineC.addRemoteProfile(homework.syncId);
    const school = S().profileOrder.find((p) => S().profiles[p].name === "School");
    assert.ok(school, "School was added with it");
    assert.equal(S().profiles[id].dataId, school);
    assert.deepEqual(sharingProfiles(S(), school), [id]);
    assert.equal(engineC.useSync.getState().remoteProfiles.length, 0, "both are on this Mac now");
    await engineC.syncNow();
  });

  const before = published("share:").length;
  await a.with(() => engineA.syncNow());
  await c.with(() => engineC.syncNow());
  await a.with(() => engineA.syncNow());
  assert.equal(published("share:").length, before, "the share: records settle: neither Mac republishes them");
});

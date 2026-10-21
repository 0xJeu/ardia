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

const shareRecords = (engine) =>
  Object.fromEntries(
    Object.entries(engine.appScopeRecords())
      .filter(([k]) => k.startsWith("share:"))
      .map(([k, r]) => [k.slice(6), r.v?.o ?? null]),
  );

async function turnOn(mac, engine) {
  await mac.with(async () => {
    engine.startSync();
    assert.ok("ok" in (await engine.turnOnSync("/sync")));
    await engine.syncNow();
    await engine.syncNow();
  });
}

async function join(mac, engine, before = () => {}) {
  await mac.with(async () => {
    before();
    engine.startSync();
    assert.ok("ok" in (await engine.enterRecoveryPhrase("/sync", "words")));
    await engine.syncNow();
    await engine.syncNow();
  });
}

const named = (name) => S().profileOrder.find((id) => S().profiles[id].name === name);

test("two Macs whose same-named profile shares different data settle instead of republishing forever", async () => {
  folder.clear();
  const a = new Mac("A");
  const b = new Mac("B");
  const engineA = await import("./engine.ts?loopA");
  const engineB = await import("./engine.ts?loopB");
  await a.with(() => S().createProfile({ name: "Work", shareWith: "default" }));
  await turnOn(a, engineA);
  await join(b, engineB, () => {
    const home = S().createProfile({ name: "Home" });
    S().createProfile({ name: "Work", shareWith: home });
  });
  for (let i = 0; i < 3; i++) {
    await a.with(() => engineA.syncNow());
    await b.with(() => engineB.syncNow());
  }
  const before = published("share:").length;
  for (let i = 0; i < 4; i++) {
    await a.with(() => engineA.syncNow());
    await b.with(() => engineB.syncNow());
  }
  assert.equal(published("share:").length, before, "no Mac republishes share: once both have seen the other's record");
  await a.with(() => assert.equal(S().profiles[named("Work")].dataId, "default", "each Mac keeps its own data"));
});

test("share: records that form a cycle resolve the same way whichever profile a new Mac adds first", async () => {
  folder.clear();
  const a = new Mac("A");
  const b = new Mac("B");
  const c = new Mac("C");
  const d = new Mac("D");
  const engineA = await import("./engine.ts?cycleA");
  const engineB = await import("./engine.ts?cycleB");
  const engineC = await import("./engine.ts?cycleC");
  const engineD = await import("./engine.ts?cycleD");
  await a.with(() => S().createProfile({ name: "Beta", shareWith: S().createProfile({ name: "Alpha" }) }));
  await turnOn(a, engineA);
  await join(b, engineB, () => S().createProfile({ name: "Alpha", shareWith: S().createProfile({ name: "Beta" }) }));
  await a.with(() => engineA.syncNow());
  await b.with(() => engineB.syncNow());

  const owners = await b.with(() => shareRecords(engineB));
  const links = await b.with(() => engineB.useSync.getState().profiles);
  const alpha = await b.with(() => links[named("Alpha")].syncId);
  const beta = await b.with(() => links[named("Beta")].syncId);
  assert.deepEqual([owners[alpha], owners[beta]], [beta, alpha], "the records form a cycle");
  const lowest = [alpha, beta].sort()[0];
  const ownerName = lowest === alpha ? "Alpha" : "Beta";
  const sharerName = lowest === alpha ? "Beta" : "Alpha";

  const outcome = async (mac, engine, first) => {
    await join(mac, engine);
    return mac.with(() => {
      for (const name of [first, first === "Alpha" ? "Beta" : "Alpha"]) {
        const remote = engine.useSync.getState().remoteProfiles.find((p) => p.name === name);
        if (remote) engine.addRemoteProfile(remote.syncId);
      }
      const owner = named(ownerName);
      const sharer = named(sharerName);
      assert.ok(owner && sharer, "both profiles are on the Mac");
      return { ownerData: S().profiles[owner].dataId ?? null, sharerData: S().profiles[sharer].dataId === owner };
    });
  };
  assert.deepEqual(await outcome(c, engineC, "Alpha"), { ownerData: null, sharerData: true });
  assert.deepEqual(await outcome(d, engineD, "Beta"), { ownerData: null, sharerData: true });
});

test("when a shared data's owner is deleted, the profiles left still share it on the next Mac, and a deleted profile's share: goes", async () => {
  folder.clear();
  const a = new Mac("A");
  const c = new Mac("C");
  const engineA = await import("./engine.ts?goneA");
  const engineC = await import("./engine.ts?goneC");
  const ids = await a.with(() => {
    const owner = S().createProfile({ name: "Owner" });
    const child = S().createProfile({ name: "Child", shareWith: owner });
    const temp = S().createProfile({ name: "Temp", shareWith: owner });
    return { owner, child, temp };
  });
  await turnOn(a, engineA);
  const tempSync = await a.with(() => engineA.useSync.getState().profiles[ids.temp].syncId);
  await a.with(async () => {
    S().deleteProfile(ids.owner);
    S().deleteProfile(ids.temp);
    S().createProfile({ name: "Another", shareWith: ids.child });
    await engineA.syncNow();
    await engineA.syncNow();
    assert.equal(shareRecords(engineA)[tempSync], null, "the deleted profile's share: is a tombstone");
  });
  await join(c, engineC);
  await c.with(() => {
    const remote = engineC.useSync.getState().remoteProfiles;
    const another = remote.find((p) => p.name === "Another");
    assert.deepEqual(another?.sharesWith, { name: "Child", added: true });
    const id = engineC.addRemoteProfile(another.syncId);
    const child = named("Child");
    assert.ok(child);
    assert.equal(S().profiles[id].dataId, child);
    assert.equal(S().profiles[child].dataId, undefined, "Child stands in as the owner");
    assert.equal(named("Owner"), undefined, "the deleted owner isn't brought back");
  });
});

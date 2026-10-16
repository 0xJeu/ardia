import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const { useBrowser } = await import("../store/browser.ts");
const { chromeChanged } = await import("../store/liveTabs.ts");
const { patchPage } = await import("../components/layout/pageState.ts");
const { startTabReveal } = await import("./tabReveal.ts");
const stub = await import("../test-native-stub.mjs");

const S = () => useBrowser.getState();
startTabReveal();
const tab = (id, windowId, url, profileId = "default") => ({
  id, windowId, profileId, url, title: "", favicon: null, pinned: false, muted: false, zoom: 1, customTitle: null, customIcon: null,
  pinnedUrl: null, navigation: url ? { url, seq: 1 } : null, openerId: null, createdAt: 0, lastActiveAt: 0,
});
const win = (id, tabIds, active, extra = {}) => ({
  id, profileId: "default", incognito: false, tabIds, activeTabIds: { default: active }, sidebarOpen: true, frame: null, createdAt: 0, ...extra,
});
const PROFILES = {
  default: { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 },
  work: { id: "work", name: "Work", color: "blue", icon: null, createdAt: 0 },
};
const setup = (tabs = ["a", "b", "c"], active = "a") => {
  S().hydrate({
    profiles: PROFILES,
    windows: { w1: win("w1", tabs, active) },
    tabs: Object.fromEntries(tabs.map((id) => [id, tab(id, "w1", `https://${id}.com/`)])),
    focusedWindowId: "w1",
  });
  for (const id of tabs) S().updateTab(id, { navigation: { url: `https://${id}.com/`, seq: 1 } });
  stub.revealedTabs.length = 0;
};
const revealed = () => [...stub.revealedTabs];

test("a click or ⌘-number switch shows the page before React commits", () => {
  setup();
  S().activate("b");
  assert.deepEqual(revealed(), ["b"]);
  S().activate("b");
  assert.deepEqual(revealed(), ["b"], "the tab already in front: nothing");
  S().activate("c");
  assert.deepEqual(revealed(), ["b", "c"]);
});

test("closing the tab in front shows the one JS picks next", () => {
  setup(["a", "b", "c"], "b");
  S().closeTab("b");
  const next = S().windows.w1.activeTabIds.default;
  assert.ok(next && next !== "b");
  assert.deepEqual(revealed(), [next]);
});

test("a switch Chrome made (DevTools, an extension) is shown once the store follows it", () => {
  setup(["a", "b"], "a");
  const before = { strip: 1, window: 1, profile: "", tabs: [{ key: "a", browser: 1, index: 0, active: true, pinned: false }, { key: "b", browser: 2, index: 1, active: false, pinned: false }] };
  const after = { ...before, tabs: [{ ...before.tabs[0], active: false }, { ...before.tabs[1], active: true }] };
  useBrowser.setState(chromeChanged(S(), before, after, { seen: new Set(["a", "b"]) }));
  assert.equal(S().windows.w1.activeTabIds.default, "b");
  assert.deepEqual(revealed(), ["b"]);
});

test("nothing the native view can't show by itself", () => {
  setup(["a", "b", "c", "d"], "a");
  S().updateTab("b", { navigation: null, unloaded: true });
  S().activate("b");
  S().activate("a");
  assert.deepEqual(revealed(), ["a"], "a sleeping tab wakes through React; going back to a page is shown");
  stub.revealedTabs.length = 0;
  S().updateTab("c", { url: "", navigation: null });
  S().activate("c");
  assert.deepEqual(revealed(), [], "a New Tab page");
  S().activate("a");
  stub.revealedTabs.length = 0;
  patchPage("d", { newTabShown: true });
  S().activate("d");
  assert.deepEqual(revealed(), [], "a page under the New Tab page");
  patchPage("d", { newTabShown: null });
  S().activate("a");
  stub.revealedTabs.length = 0;
  patchPage("a", { fullscreen: true });
  S().activate("d");
  assert.deepEqual(revealed(), [], "leaving a full-screen page");
  patchPage("a", { fullscreen: false });
});

test("splits and profile switches are left to React", () => {
  setup(["a", "b", "c"], "a");
  S().createSplit(["b", "c"]);
  stub.revealedTabs.length = 0;
  S().activate("b");
  assert.deepEqual(revealed(), [], "into a split");
  S().activate("a");
  assert.deepEqual(revealed(), [], "out of a split");
  setup(["a", "b"], "a");
  useBrowser.setState((s) => ({
    tabs: { ...s.tabs, b: { ...s.tabs.b, profileId: "work" } },
    windows: { ...s.windows, w1: { ...s.windows.w1, profileId: "work", activeTabIds: { default: "a", work: "b" } } },
  }));
  assert.deepEqual(revealed(), [], "another profile's page");
});

test("a page Chrome opened in front (a link's new tab, DevTools, an extension) is shown over the page it replaces", () => {
  setup(["a", "b"], "a");
  const made = S().newTab("w1", { url: "https://made.example/", adoptId: "tab:5" });
  assert.deepEqual(revealed(), ["tab:5 over a"]);
  assert.equal(S().windows.w1.activeTabIds.default, made);
  stub.revealedTabs.length = 0;
  S().newTab("w1", { url: "https://behind.example/", adoptId: "tab:6", background: true });
  S().newTab("w1", { url: "https://dup.example/", adoptId: "clone:a" });
  assert.deepEqual(revealed(), [], "in the background, or a duplicate made from the tab");
  S().activate("b");
  stub.revealedTabs.length = 0;
  patchPage("b", { newTabShown: true });
  S().newTab("w1", { url: "https://other.example/", adoptId: "tab:7" });
  assert.deepEqual(revealed(), [], "over a New Tab page");
  patchPage("b", { newTabShown: null });
});

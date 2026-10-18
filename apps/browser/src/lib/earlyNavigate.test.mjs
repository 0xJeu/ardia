import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const { useBrowser } = await import("../store/browser.ts");
const { webviews } = await import("./webviews.ts");
const { setEarlyNavigateForTests, takeStartedNavigation } = await import("./earlyNavigate.ts");

const S = () => useBrowser.getState();
const handle = () => {
  const loads = [];
  return { loads, loadUrl: async (url, options) => void loads.push({ url, userInitiated: !!options?.userInitiated }) };
};
const setup = () => {
  const tab = {
    id: "a", windowId: "w1", profileId: "default", url: "https://a.com/", title: "", favicon: null, pinned: false, muted: false, zoom: 1,
    customTitle: null, customIcon: null, pinnedUrl: null, navigation: { url: "https://a.com/", seq: 1 }, openerId: null, createdAt: 0, lastActiveAt: 0,
  };
  const win = { id: "w1", profileId: "default", incognito: false, tabIds: ["a"], activeTabIds: { default: "a" }, sidebarOpen: true, frame: null, createdAt: 0 };
  S().hydrate({ profiles: { default: { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 } }, windows: { w1: win }, tabs: { a: tab }, focusedWindowId: "w1" });
  webviews.clear();
};

test("a navigation starts in the store action, once, and its view effect skips it", () => {
  setup();
  setEarlyNavigateForTests(true);
  const view = handle();
  webviews.set("a", view);
  S().navigate("a", "https://b.com/");
  const seq = S().tabs.a.navigation.seq;
  assert.deepEqual(view.loads, [{ url: "https://b.com/", userInitiated: true }]);
  assert.equal(takeStartedNavigation("a", seq), true);
  assert.equal(takeStartedNavigation("a", seq), false);
});

test("a view that remounted after the start loads the page itself", () => {
  setup();
  setEarlyNavigateForTests(true);
  webviews.set("a", handle());
  S().navigate("a", "https://b.com/");
  const seq = S().tabs.a.navigation.seq;
  webviews.set("a", handle());
  assert.equal(takeStartedNavigation("a", seq), false);
});

test("an older navigation's start doesn't cover a newer one", () => {
  setup();
  setEarlyNavigateForTests(true);
  webviews.set("a", handle());
  S().navigate("a", "https://b.com/");
  const first = S().tabs.a.navigation.seq;
  assert.equal(takeStartedNavigation("a", first + 1), false);
});

test("with no view yet, or the switch off, the view effect loads as before", () => {
  setup();
  setEarlyNavigateForTests(true);
  S().navigate("a", "https://b.com/");
  assert.equal(takeStartedNavigation("a", S().tabs.a.navigation.seq), false);
  setEarlyNavigateForTests(false);
  const view = handle();
  webviews.set("a", view);
  S().navigate("a", "https://c.com/");
  assert.equal(view.loads.length, 0);
  assert.equal(takeStartedNavigation("a", S().tabs.a.navigation.seq), false);
});

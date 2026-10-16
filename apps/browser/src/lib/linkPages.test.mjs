import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const { useBrowser } = await import("../store/browser.ts");
const { activeTabId } = await import("../store/model.ts");
const { linkProfile } = await import("../store/launchTab.ts");
const { claimLinkPage } = await import("./linkPages.ts");
const { flushPersistence, startPersistence } = await import("./persist.ts");
const stub = await import("../test-native-stub.mjs");

const S = () => useBrowser.getState();
startPersistence();
const PROFILES = {
  default: { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 },
  work: { id: "work", name: "Work", color: "blue", icon: null, createdAt: 0 },
};
const setup = (extra = {}) => {
  S().hydrate({
    profiles: PROFILES,
    windows: { w1: { id: "w1", profileId: "default", incognito: false, tabIds: ["a"], activeTabIds: { default: "a" }, sidebarOpen: true, frame: null, createdAt: 0 } },
    tabs: { a: { id: "a", windowId: "w1", profileId: "default", url: "https://a.com/", title: "", favicon: null, pinned: false, muted: false, zoom: 1, customTitle: null, customIcon: null, pinnedUrl: null, navigation: null, openerId: null, createdAt: 0, lastActiveAt: 0 } },
    focusedWindowId: "w1",
    ...extra,
  });
  stub.linkClaims.length = 0;
};
const URL = "http://127.0.0.1:9462/static?id=link";

test("a link opened in Little Ardia claims the page the engine started for it", () => {
  setup();
  const windowId = S().createWindow({ small: true, url: URL, profileId: "default" });
  const tabId = activeTabId(S(), windowId);
  claimLinkPage(tabId, URL);
  assert.deepEqual(stub.linkClaims, [{ key: tabId, url: URL, profile: "" }]);
});

test("a link opened as a tab or a window of another profile claims under that profile", () => {
  setup();
  const tabId = S().newTab("w1", { url: URL, profileId: "default" });
  claimLinkPage(tabId, URL);
  const windowId = S().createWindow({ url: URL, profileId: "work" });
  claimLinkPage(activeTabId(S(), windowId), URL);
  assert.deepEqual(stub.linkClaims, [
    { key: tabId, url: URL, profile: "" },
    { key: activeTabId(S(), windowId), url: URL, profile: "work" },
  ]);
});

test("nothing is claimed when the tab won't load exactly that address", () => {
  setup();
  const typed = S().newTab("w1", { url: "example.com", profileId: "default" });
  claimLinkPage(typed, "example.com");
  claimLinkPage("gone", URL);
  claimLinkPage(undefined, URL);
  const adopted = S().newTab("w1", { url: URL, adoptId: "tab:9" });
  claimLinkPage(adopted, URL);
  assert.deepEqual(stub.linkClaims, []);
});

test("session.json names the profile the next launch opens links in", () => {
  setup({ lastProfileId: "work" });
  flushPersistence();
  assert.equal(JSON.parse(stub.docs.get("session.json")).linkProfile, "work");
  assert.equal(linkProfile(S()), "work");
  S().hydrate({ profiles: PROFILES, windows: {}, tabs: {} });
  flushPersistence();
  assert.equal(JSON.parse(stub.docs.get("session.json")).linkProfile, "");
});

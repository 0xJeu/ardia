import assert from "node:assert/strict";
import { test } from "node:test";
import { engineForUrl, engineMark, ruleFor, siteOf, tabEngine, typedNavigationEngine } from "./engines.ts";
import { makeTab, snapshotTab } from "./model.ts";

const tab = (id, patch = {}) => ({ id, url: "", navigation: null, openerId: null, ...patch });
const state = (tabs, settings = {}) => ({
  tabs: Object.fromEntries(tabs.map((t) => [t.id, t])),
  settings: { pageEngine: "chromium", websiteEngines: {}, ...settings },
});

test("a site is its scheme, host and port, and nothing else", () => {
  assert.equal(siteOf("https://www.Netflix.com/watch/1?x=2#y"), "https://www.netflix.com");
  assert.equal(siteOf("http://localhost:8080/a"), "http://localhost:8080");
  assert.equal(siteOf("https://example.com:443/"), "https://example.com");
  assert.equal(siteOf("ardia://settings"), null);
  assert.equal(siteOf("not a url"), null);
});

test("rules match the exact site, never its subdomains", () => {
  const s = state([], { websiteEngines: { "https://netflix.com": "webkit" } });
  assert.equal(ruleFor(s, "https://netflix.com/browse"), "webkit");
  assert.equal(ruleFor(s, "https://www.netflix.com/browse"), undefined);
  assert.equal(ruleFor(s, "http://netflix.com/"), undefined);
  assert.equal(engineForUrl(s, "https://www.netflix.com/"), "chromium");
  assert.equal(engineForUrl({ settings: { ...s.settings, pageEngine: "webkit" } }, "https://example.com/"), "webkit");
});

test("a tab keeps its engine, else follows its adoption, its opener, then rules", () => {
  const rules = { websiteEngines: { "https://www.netflix.com": "webkit" } };
  const s = state(
    [
      tab("fixed", { engine: "chromium", url: "https://www.netflix.com/" }),
      tab("popup", { adoptId: "webkit:3" }),
      tab("chrome", { adoptId: "ardiacore:9", url: "https://www.netflix.com/" }),
      tab("opener", { engine: "webkit", url: "https://www.netflix.com/" }),
      tab("link", { openerId: "opener", url: "https://example.com/" }),
      tab("typed", { url: "https://www.netflix.com/" }),
      tab("copy", { adoptId: "clone:opener" }),
    ],
    rules,
  );
  assert.equal(tabEngine(s, "fixed"), "chromium");
  assert.equal(tabEngine(s, "popup"), "webkit");
  assert.equal(tabEngine(s, "chrome"), "chromium");
  assert.equal(tabEngine(s, "link"), "webkit");
  assert.equal(tabEngine(s, "typed"), "webkit");
  assert.equal(tabEngine(s, "copy"), "webkit");
  assert.equal(tabEngine(s, "gone"), "chromium");
});

test("typing an address follows a rule, else keeps the page's engine", () => {
  const s = state([tab("w", { engine: "webkit", url: "https://www.netflix.com/" }), tab("blank")], { websiteEngines: { "https://www.youtube.com": "chromium" } });
  assert.equal(typedNavigationEngine(s, s.tabs.w, "https://www.youtube.com/"), "chromium");
  assert.equal(typedNavigationEngine(s, s.tabs.w, "https://example.com/"), "webkit");
  assert.equal(typedNavigationEngine(s, s.tabs.blank, "https://example.com/"), "chromium");
});

test("Chromium's own pages always open in Chromium", () => {
  const s = state([tab("v", { engine: "webkit", url: "ardia://version" }), tab("w", { engine: "webkit", url: "https://a.com/" })], { pageEngine: "webkit" });
  assert.equal(tabEngine(s, "v"), "chromium");
  assert.equal(typedNavigationEngine(s, s.tabs.w, "ardia://extensions"), "chromium");
  assert.equal(typedNavigationEngine(s, s.tabs.w, "chrome-extension://abc/options.html"), "chromium");
});

test("the mark shows only on web pages away from the default engine", () => {
  const s = state([tab("w", { engine: "webkit", url: "https://a.com/" }), tab("c", { engine: "chromium", url: "https://a.com/" }), tab("n", { engine: "webkit", url: "ardia://history" })]);
  assert.equal(engineMark(s, "w"), "webkit");
  assert.equal(engineMark(s, "c"), null);
  assert.equal(engineMark(s, "n"), null);
});

test("a closed WebKit tab reopens in WebKit, whatever restore id it carries", () => {
  const closed = snapshotTab({ ...makeTab("w1", "default", "https://www.netflix.com/"), engine: "webkit" });
  assert.equal(closed.engine, "webkit");
  const reopened = { ...makeTab("w1", "default", closed.url, closed), adoptId: "restore:old", navigation: null };
  const s = state([reopened]);
  assert.equal(tabEngine(s, reopened.id), "webkit");
  assert.equal(snapshotTab(makeTab("w1", "default", "https://a.com/")).engine, undefined);
});

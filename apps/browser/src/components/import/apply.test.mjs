import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const { useBrowser } = await import("../../store/browser.ts");
const { importArcSpace, importFavicons, applyResult } = await import("./apply.ts");

const S = () => useBrowser.getState();

test("imported favicons use the destination engine profile and fragment-free page", async () => {
  S().hydrate({});
  const { engineProfile } = await import("../../store/model.ts");
  const calls = [];
  globalThis.acTestEngineCall = (...args) => { calls.push(args); return Promise.resolve({}); };
  try {
    const icons = [{ page: "https://a.test/#x", icon: "https://a.test/i.png", png: "AAAA" }];
    await importFavicons("default", icons);
    assert.deepEqual(calls, [["ac_favicons_set", engineProfile("default"), { ...icons[0], page: "https://a.test/" }]]);
    await importFavicons("incognito:default", icons);
    await importFavicons("unknown", icons);
    await importFavicons("default", []);
    assert.equal(calls.length, 1);
  } finally {
    delete globalThis.acTestEngineCall;
  }
});

test("applyResult stores favicons before creating favorite tabs and survives individual failures", async () => {
  S().hydrate({});
  const url = "https://favorite.test/";
  const calls = [];
  globalThis.acTestEngineCall = (name, profile, args) => {
    if (name === "ac_favicons_set") {
      assert.equal(Object.values(S().tabs).some((t) => t.url === url), false);
      calls.push(args.page);
      if (calls.length === 1) return Promise.reject(new Error("unavailable"));
    }
    return Promise.resolve({});
  };
  try {
    await applyResult("default", {
      favicons: [{ page: "https://first.test/", icon: "https://first.test/i.png", png: "AAAA" }, { page: url, icon: `${url}i.png`, png: "AAAA" }],
      favorites: [{ url, title: "Favorite", pinned: true }],
      tabs: [], spaces: [], history: [], credentials: [],
    }, "Chrome");
    assert.deepEqual(calls, ["https://first.test/", url]);
    const favorite = Object.values(S().tabs).find((t) => t.url === url);
    assert.equal(favorite.favicon, "https://favorite.test/favicon.ico");
  } finally {
    delete globalThis.acTestEngineCall;
  }
});

test("Arc rows and open tabs carry only their own origin favicon fallback", () => {
  S().hydrate({});
  importArcSpace("default", {
    pinned: [{ type: "url", title: "Row", url: "https://x.test/page" }, { type: "url", title: "File", url: "file:///tmp/a.html" }],
    tabs: [{ title: "Open", url: "http://open.test:8080/path", pinned: false }],
  }, "Space");
  assert.equal(Object.values(S().tabs).find((t) => t.title === "Row").favicon, "https://x.test/favicon.ico");
  assert.equal(Object.values(S().tabs).find((t) => t.title === "File").favicon, null);
  assert.equal(Object.values(S().tabs).find((t) => t.title === "Open").favicon, "http://open.test:8080/favicon.ico");
});

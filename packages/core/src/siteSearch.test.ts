import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILT_IN_ENGINES } from "./engines.ts";
import { leavesSiteSearchOnBackspace, offeredSiteSearch, siteSearchKey, type SearchScope, type SiteSearchKeyState } from "./siteSearch.ts";

const sources = { engines: BUILT_IN_ENGINES };

function bar(typed: string, completion = "", scope: SearchScope | null = null, scopeFrom = ""): SiteSearchKeyState {
  return { typed, completion, scope, offered: scope ? null : offeredSiteSearch(typed, completion, sources), scopeFrom };
}

test("Tab enters site search while inline completion is showing: 'google' + '.com'", () => {
  const state = bar("google", ".com");
  assert.equal(state.offered?.name, "Google");
  const action = siteSearchKey("Tab", false, state);
  assert.equal(action?.kind, "enter");
  assert.equal(action?.kind === "enter" && action.scope.name, "Google");
  assert.equal(action?.kind === "enter" && action.from, "google.com");
});

test("Tab enters site search from a short prefix the completion finishes: 'goo' + 'gle.com'", () => {
  const action = siteSearchKey("Tab", false, bar("goo", "gle.com"));
  assert.deepEqual(action?.kind === "enter" && [action.scope.name, action.from], ["Google", "goo" + "gle.com"]);
});

test("Tab enters site search for a typed site with no completion: 'x.com'", () => {
  const action = siteSearchKey("Tab", false, bar("x.com"));
  assert.deepEqual(action?.kind === "enter" && [action.scope.kind, action.scope.name, action.from], ["site", "X", "x.com"]);
});

test("Tab accepts the completion when the row offers no site search", () => {
  const state = bar("exampl", "e.org");
  assert.equal(state.offered, null);
  assert.deepEqual(siteSearchKey("Tab", false, state), { kind: "accept", text: "example.org" });
});

test("Tab with nothing to enter or accept is left to the caller (it moves the selection)", () => {
  assert.equal(siteSearchKey("Tab", false, bar("hello world")), null);
  assert.equal(siteSearchKey("Tab", false, bar("")), null);
});

test("Shift+Tab never enters site search", () => {
  assert.equal(siteSearchKey("Tab", true, bar("google", ".com")), null);
});

test("Tab inside site search does not enter it again", () => {
  const google = bar("google", ".com").offered!;
  assert.equal(siteSearchKey("Tab", false, bar("", "", google, "google.com")), null);
});

test("Backspace in an empty site search field leaves it and restores the text that was there", () => {
  const x = bar("x.com").offered!;
  const state = bar("", "", x, "x.com");
  assert.equal(leavesSiteSearchOnBackspace(state.scope, state.typed), true);
  assert.deepEqual(siteSearchKey("Backspace", false, state), { kind: "leave", text: "x.com" });
});

test("Backspace with text in the site search field just deletes a character", () => {
  const x = bar("x.com").offered!;
  const state = bar("elon", "", x, "x.com");
  assert.equal(leavesSiteSearchOnBackspace(state.scope, state.typed), false);
  assert.equal(siteSearchKey("Backspace", false, state), null);
});

test("Backspace outside site search is a plain delete", () => {
  assert.equal(leavesSiteSearchOnBackspace(null, ""), false);
  assert.equal(siteSearchKey("Backspace", false, bar("x.co")), null);
});

test("no site search is offered for text with spaces", () => {
  assert.equal(offeredSiteSearch("google maps", "", sources), null);
  assert.equal(offeredSiteSearch("  ", ".com", sources), null);
});

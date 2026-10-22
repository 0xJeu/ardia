import assert from "node:assert/strict";
import { test } from "node:test";
import { BANG_LIST, BANG_LIST_UNICODE } from "./bangList.ts";
import { bangTable, bangUrl, joinBangTables, escapeSearchTerms, fillBangTemplate, findBang, parseLooseJson, slimBangs } from "./bangs.ts";
import { buildSuggestions } from "./suggest.ts";

const filler = Array.from({ length: 1000 }, (_, i) => ({ s: `Site ${i}`, ts: [`site${i}`], u: `https://site${i}.example/?q={searchTerms}` }));

function heliumFile(entries: unknown[]): string {
  const body = JSON.stringify([...entries, ...filler], null, 1).replace(/"\n(\s*)([\]}])/g, '",\n$1$2');
  return `// Generated at 2026-10-14T11:11:02.825Z\n// MIT License\n//\n\n${body}\n`;
}

const fixture = slimBangs(
  heliumFile([
    { s: "GitHub", ts: ["gh", "git", "github"], u: "https://github.com/search?q={searchTerms}" },
    { s: "GitHub Repo", ts: ["ghr"], f: 1, u: "https://github.com/{searchTerms}" },
    { s: "Wikipedia", ts: ["w", "wiki"], u: "https://wikipedia.org/w/index.php?search={searchTerms}" },
    { s: "YouTube", ts: ["yt", "ют"], u: "https://www.youtube.com/results?search_query={searchTerms}" },
    { s: "Zig", ts: ["zig"], u: "https://ziglang.org/documentation/master/std/#?{searchTerms}" },
    { s: "Gmail", ts: ["gmail"], u: "https://mail.google.com/mail/u/0/#search/{searchTerms}" },
    { s: "T3 Chat", ts: ["t3"], u: "https://www.t3.chat/new?q={searchTerms}", sc: "ai" },
    { s: "Microsoft Copilot", ts: ["copilot"], u: "https://copilot.microsoft.com/?q={searchTerms}" },
    { s: "DuckDuckGo AI Chat", ts: ["ddg-chat"], u: "https://duckduckgo.com/?q={searchTerms}&ia=chat&bang=true" },
    { s: "Not a web page", ts: ["ftp"], u: "ftp://example.com/{searchTerms}" },
    { s: "Taken", ts: ["gh"], u: "https://taken.example/?q={searchTerms}" },
  ]),
)!;
const table = bangTable(fixture);
const url = (text: string) => {
  const match = findBang(text, table);
  return match && bangUrl(match);
};

test("a bang at the start or the end of the text picks the site, any case", () => {
  assert.equal(url("!gh react"), "https://github.com/search?q=react");
  assert.equal(url("react !w"), "https://wikipedia.org/w/index.php?search=react");
  assert.equal(url("!GH react hooks"), "https://github.com/search?q=react+hooks");
  assert.equal(url("  react   hooks   !Wiki "), "https://wikipedia.org/w/index.php?search=react+hooks");
  assert.equal(url("!ют cats"), "https://www.youtube.com/results?search_query=cats");
  assert.deepEqual(
    findBang("!gh react", table)?.bang,
    { trigger: "gh", name: "GitHub", template: "https://github.com/search?q={searchTerms}", home: "https://github.com/" },
  );
});

test("a bare bang opens the site's home", () => {
  assert.equal(url("!yt"), "https://www.youtube.com/");
  assert.equal(url("  !W  "), "https://wikipedia.org/");
});

test("an unknown bang, a lone '!' or a '!' inside a word is no bang", () => {
  for (const text of ["!nope react", "react !nope", "hello!", "wow ! nice", "!", "! gh react", "hi!gh", "say !gh in the middle", "example.com/!gh", "?!gh react", "a!w"]) {
    assert.equal(findBang(text, table), null, text);
  }
  assert.equal(findBang("!gh react", null), null);
});

test("the first matching end wins, and the other bang stays in the query", () => {
  assert.equal(url("!gh react !w"), "https://github.com/search?q=react+!w");
  assert.equal(url("!nope react !w"), "https://wikipedia.org/w/index.php?search=!nope+react");
});

test("terms after '?' are escaped as a query parameter, with '+' for spaces, like Chrome's search engines", () => {
  assert.equal(url("!gh a+b & c/d #x 100%"), "https://github.com/search?q=a%2Bb+%26+c%2Fd+%23x+100%25");
  assert.equal(url("!gh 日本 語"), "https://github.com/search?q=%E6%97%A5%E6%9C%AC+%E8%AA%9E");
  assert.equal(url("!gh it's (ok)*!~"), "https://github.com/search?q=it's+(ok)*!~");
  assert.equal(url("!zig std.mem a b"), "https://ziglang.org/documentation/master/std/#?std.mem+a+b");
});

test("terms in the path keep '/' and escape what would end the path, spaces as %20", () => {
  assert.equal(url("!ghr facebook/react"), "https://github.com/facebook/react");
  assert.equal(url("!ghr a b?c#d%e"), "https://github.com/a%20b%3Fc%23d%25e");
  assert.equal(url("!gmail from:me"), "https://mail.google.com/mail/u/0/#search/from%3Ame");
  assert.equal(escapeSearchTerms("é ü", false), "%C3%A9%20%C3%BC");
  assert.equal(escapeSearchTerms("a\ud800b", true), "a%EF%BF%BDb");
  assert.equal(fillBangTemplate("https://a.example/{searchTerms}/x?q={searchTerms}", "p q"), "https://a.example/p%20q/x?q=p%20q");
});

test("templates that aren't web pages are left out; every other bang stays, and a trigger keeps its first site", () => {
  assert.equal(table.get("ftp"), undefined);
  assert.equal(table.get("t3")?.name, "T3 Chat");
  assert.equal(url("!copilot hi"), "https://copilot.microsoft.com/?q=hi");
  assert.equal(table.get("gh")?.name, "GitHub");
});

test("Helium's file format: comments, trailing commas and '//' inside strings", () => {
  assert.deepEqual(parseLooseJson('// head\n[\n {"u": "https://a//b", /* c */ "ts": ["x",],},\n // tail\n]\n'), [{ u: "https://a//b", ts: ["x"] }]);
  assert.deepEqual(parseLooseJson('["a\\\\", "b,]", "c\\"//"]'), ["a\\", "b,]", 'c"//']);
});

test("a broken, empty or tiny response is not a bang list", () => {
  for (const body of ["", "<html>oops</html>", "{}", "[]", '[{"s":"A","ts":["a"],"u":"https://a.example/{searchTerms}"}]', heliumFile([]).slice(0, 5000)]) {
    assert.equal(slimBangs(body), null, body.slice(0, 40));
  }
});

test("the bundled list has the common bangs", () => {
  assert.match(BANG_LIST, /^[\x00-\x7f]*$/);
  const bundled = joinBangTables([bangTable(BANG_LIST), bangTable(BANG_LIST_UNICODE)]);
  assert.ok(bundled.size > 13000, String(bundled.size));
  assert.equal(bangUrl(findBang("!ют cats", bundled)!), "https://www.youtube.com/results?search_query=cats");
  assert.equal(bangUrl(findBang("!gh react", bundled)!), "https://github.com/search?q=react");
  assert.equal(bangUrl(findBang("react !w", bundled)!), "https://wikipedia.org/w/index.php?search=react");
  assert.equal(bangUrl(findBang("!yt", bundled)!), "https://www.youtube.com/");
  assert.equal(bundled.get("t3")?.name, "T3 Chat");
});

test("the command bar's top row is the bang's search, then the site's pages from history", () => {
  const source = {
    tabs: [],
    history: [
      { url: "https://github.com/facebook/react", title: "facebook/react", favicon: null, visits: 9, lastVisit: 1 },
      { url: "https://react.dev/", title: "React", favicon: null, visits: 30, lastVisit: 1 },
    ],
  };
  const result = buildSuggestions("!gh react", source, { now: 2, bangs: table, remote: ["react native"] });
  assert.deepEqual(result.items, [
    { kind: "search", query: "react", url: "https://github.com/search?q=react", engine: "GitHub", bang: true },
    { kind: "page", url: "https://github.com/facebook/react", title: "facebook/react", favicon: null, visited: true },
  ]);
  assert.equal(result.completion, "");
  assert.deepEqual(buildSuggestions("!yt", source, { bangs: table }).items, [{ kind: "page", url: "https://www.youtube.com/", title: "YouTube", favicon: null }]);
  assert.equal(buildSuggestions("hello!", source, { bangs: table }).items[0]?.kind, "search");
  assert.equal(buildSuggestions("!gh react", source, { bangs: null }).items.some((s) => s.kind === "search" && s.bang), false);
  const scoped = buildSuggestions("!gh react", source, { bangs: table, scope: { kind: "site", name: "X", host: "x.com", url: "https://x.com/search?q=%s" } });
  assert.equal(scoped.items[0]?.kind === "search" && scoped.items[0].url, "https://x.com/search?q=!gh%20react");
});

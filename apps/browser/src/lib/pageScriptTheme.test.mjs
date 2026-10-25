import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const script = readFileSync(new URL("../../../../packages/ardiacore/ios/page_script.js", import.meta.url), "utf8");
const start = script.indexOf("  const parse = (css) =>");
const end = script.indexOf("  if (window.visualViewport)");
assert.ok(start > 0 && end > start, "page_script.js has the theme block");
const source = script.slice(start, end);

function page({ meta = "#fff", bodyBackground = "rgba(0, 0, 0, 0)", htmlBackground = "rgba(0, 0, 0, 0)", header = null, headerPosition = "static" } = {}) {
  const reports = [];
  const frames = [];
  const observers = [];
  const element = (nodeName, parentElement, background, position = "static") => ({
    nodeName,
    parentElement,
    background,
    position,
    attrs: {},
    getAttribute(name) {
      return this.attrs[name] ?? null;
    },
  });
  const html = element("HTML", null, htmlBackground);
  const body = element("BODY", html, bodyBackground);
  const top = element("DIV", body, header ?? "rgba(0, 0, 0, 0)", headerPosition);
  html.appendChild = () => {};
  class MutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.targets = new Map();
      observers.push(this);
    }
    observe(target, options) {
      this.targets.set(target, options);
    }
  }
  const parseColor = (value) => {
    if (!value) return "";
    if (value.startsWith("rgb")) return value;
    const h = value.length === 4 ? value.replace(/[0-9a-f]/gi, (d) => d + d) : value;
    return `rgb(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)})`;
  };
  const themeMeta = { getAttribute: (name) => (name === "content" ? meta : null) };
  const context = {
    document: {
      documentElement: html,
      body,
      head: element("HEAD", html, "rgba(0, 0, 0, 0)"),
      querySelectorAll: () => (meta ? [themeMeta] : []),
      createElement: () => ({ style: {}, remove() {} }),
      elementFromPoint: () => top,
      addEventListener() {},
    },
    getComputedStyle: (el) => ({
      backgroundColor: el.background,
      position: el.position,
      colorScheme: "normal",
      color: parseColor(el.style?.color),
    }),
    MutationObserver,
    innerWidth: 1000,
    scrollY: 0,
    performance,
    setTimeout() {},
    clearTimeout() {},
    addEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    apply: Reflect.apply,
    raf: (fn) => frames.push(fn),
    guard: (fn) => fn,
    onReady: (fn) => fn(),
    send: (_kind, data) => reports.push(JSON.parse(JSON.stringify(data))),
  };
  context.window = context;
  runInNewContext(source, context);
  const restyle = (el, background) => {
    const oldValue = el.getAttribute("style");
    el.background = background;
    el.attrs.style = background;
    for (const observer of observers)
      if (observer.targets.get(el)?.attributeFilter?.includes("style")) observer.callback([{ type: "attributes", target: el, attributeName: "style", oldValue }]);
    while (frames.length) frames.shift()();
  };
  return { last: () => reports.at(-1), body, restyle };
}

test("a white theme-color over a dark page follows the page", () => {
  assert.deepEqual(page({ bodyBackground: "rgb(17, 17, 17)" }).last(), { color: "#111111", source: "background" });
});

test("a dark theme-color over a light page follows the page", () => {
  assert.deepEqual(page({ meta: "#0d1117", bodyBackground: "rgb(255, 255, 255)" }).last(), { color: "#FFFFFF", source: "background" });
});

test("a theme-color that matches the page is kept", () => {
  assert.deepEqual(page({ bodyBackground: "rgb(250, 250, 250)" }).last(), { color: "#FFFFFF", source: "meta" });
});

test("a theme-color that matches a dark header on a light page is kept", () => {
  assert.deepEqual(page({ meta: "#24292f", bodyBackground: "rgb(255, 255, 255)", header: "rgb(36, 41, 47)", headerPosition: "sticky" }).last(), {
    color: "#24292F",
    source: "meta",
  });
});

test("a brand theme-color that is neither light nor dark is kept", () => {
  assert.deepEqual(page({ meta: "#1da1f2", bodyBackground: "rgb(0, 0, 0)" }).last(), { color: "#1DA1F2", source: "meta" });
});

test("with no painted background or header, theme-color is kept", () => {
  assert.deepEqual(page({ meta: "#0d1117" }).last(), { color: "#0D1117", source: "meta" });
});

test("a white theme-color under a dark header on an unpainted page follows the header", () => {
  assert.deepEqual(page({ header: "rgb(32, 33, 36)", headerPosition: "fixed" }).last(), { color: "#202124", source: "header" });
});

test("switching the page between dark and light switches between the page and theme-color", () => {
  const p = page({ bodyBackground: "rgb(17, 17, 17)" });
  assert.equal(p.last().source, "background");
  p.restyle(p.body, "rgb(255, 255, 255)");
  assert.deepEqual(p.last(), { color: "#FFFFFF", source: "meta" });
  p.restyle(p.body, "rgb(31, 31, 31)");
  assert.deepEqual(p.last(), { color: "#1F1F1F", source: "background" });
});

import assert from "node:assert/strict";
import { test } from "node:test";
const { reloadMenuItems, siteOrigin } = await import("./reloadMenu.ts");

const G = { control: "⌃", option: "⌥", shift: "⇧", command: "⌘" };
const keys = (i) => (i.key ? ["control", "option", "shift", "command"].filter((m) => i.modifiers?.includes(m)).map((m) => G[m]).join("") + i.key.toUpperCase() : "");
const render = (items, depth = 0) =>
  items.flatMap((i) => [
    "  ".repeat(depth) + (i.separator ? "---" : [i.checked ? "✓" : "", i.title, keys(i), i.symbol ? `[${i.symbol}]` : "", i.swatch ? "(swatch)" : "", i.enabled === false ? "(off)" : "", i.children ? "›" : ""].filter(Boolean).join(" ")),
    ...(i.children ? render(i.children, depth + 1) : []),
  ]);

const SITE = ["Site Settings [gearshape] ›", "  Clear Cookies and Site Data… [trash]", "  ---", "  Site Controls…"];

test("the reload button's menu: the site's ad blocker as a checkmark, then Site Settings with the actions Ardia has", () => {
  assert.deepEqual(render(reloadMenuItems({ blocker: "on" })), ["✓ Block Ads & Trackers [hand.raised]", "---", ...SITE]);
  assert.deepEqual(render(reloadMenuItems({ blocker: "off" }))[0], "Block Ads & Trackers [hand.raised]");
  assert.deepEqual(render(reloadMenuItems({ blocker: "offInSettings" }))[0], "Block Ads & Trackers [hand.raised]");
  assert.deepEqual(render(reloadMenuItems({ blocker: "unavailable" }))[0], "Block Ads & Trackers [hand.raised] (off)");
});

test("only web pages have a site to configure", () => {
  assert.equal(siteOrigin("https://a.com/x?y"), "https://a.com");
  assert.equal(siteOrigin("ardia://newtab"), null);
  assert.equal(siteOrigin("not a url"), null);
});

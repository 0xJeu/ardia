import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const calls = [];
const replies = [];
globalThis.acTestCliControl = (on) => {
  calls.push(on);
  return new Promise((resolve) => replies.push(resolve));
};
const { useBrowser } = await import("../store/browser.ts");
const cli = await import("./cliControl.ts");
const settle = () => new Promise((r) => setImmediate(r));
const setOn = (on) => useBrowser.getState().updateSettings({ cliControl: on });
const emit = (status) => globalThis.acTestCliEvents.forEach((l) => l(status));

cli.startCliControl();
await settle();
replies.shift()({ state: "off", generation: 0 });
await settle();

test("a failure from a superseded enable doesn't turn off a newer retry", async () => {
  calls.length = 0;
  setOn(true);
  const first = replies.shift();
  setOn(false);
  replies.shift()({ state: "off", generation: 1 });
  setOn(true);
  replies.shift()({ state: "starting", generation: 2 });
  await settle();
  first({ state: "off", generation: 1, reason: "Couldn't listen on 127.0.0.1." });
  emit({ state: "off", generation: 1, reason: "Couldn't listen on 127.0.0.1." });
  await settle();
  assert.deepEqual(calls, [true, false, true]);
  assert.equal(useBrowser.getState().settings.cliControl, true);
  assert.equal(cli.useCli.getState().server?.generation, 2);
});

test("a failure of the current start still turns the setting off and keeps the reason", async () => {
  emit({ state: "off", generation: 2, reason: "Couldn't write ArdiaControl.json: is a directory" });
  await settle();
  assert.equal(useBrowser.getState().settings.cliControl, false);
  assert.match(cli.useCli.getState().server?.reason ?? "", /is a directory/);
  assert.deepEqual(calls, [true, false, true, false]);
});

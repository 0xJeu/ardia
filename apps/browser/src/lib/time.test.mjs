import assert from "node:assert/strict";
import { test } from "node:test";
import { durationFromHours, durationTitle, hoursFrom } from "./time.ts";

test("duration amounts convert to hours", () => {
  assert.equal(hoursFrom(30, "minutes"), 0.5);
  assert.equal(hoursFrom(36, "hours"), 36);
  assert.equal(hoursFrom(2, "days"), 48);
});

test("hours use the largest exact whole-minute unit", () => {
  for (const [hours, amount, unit] of [[0.5, 30, "minutes"], [1.5, 90, "minutes"], [36, 36, "hours"], [48, 2, "days"], [720, 30, "days"], [7 / 60, 7, "minutes"]]) {
    assert.deepEqual(durationFromHours(hours), { amount, unit });
  }
});

test("duration titles use singular and plural units", () => {
  for (const [hours, title] of [[0.5, "30 minutes"], [1 / 60, "1 minute"], [1, "1 hour"], [12, "12 hours"], [36, "36 hours"], [24, "1 day"], [48, "2 days"], [168, "7 days"], [720, "30 days"]]) {
    assert.equal(durationTitle(hours), title);
  }
});

test("custom cleanup selection and draft units wait for submission", async () => {
  const { readFileSync } = await import("node:fs");
  const { transpileModule, JsxEmit, ModuleKind } = await import("typescript");
  const source = readFileSync(new URL("../components/settings/panes/Tabs.tsx", import.meta.url), "utf8");
  const code = source.slice(source.indexOf("const CLEAN_UP ="), source.indexOf("export function TabsPane")) + source.slice(source.indexOf("function CleanUpSettings()"), source.indexOf("function LayoutChoice("));
  let hours = 24;
  let states = [];
  let cursor = 0;
  let effects = [];
  let dependencies = [];
  const writes = [];
  const useState = (initial) => {
    const index = cursor++;
    if (!(index in states)) states[index] = initial;
    return [states[index], (value) => { states[index] = value; }];
  };
  const useEffect = (run, deps) => {
    const index = cursor++;
    if (!dependencies[index] || deps.some((value, i) => value !== dependencies[index][i])) effects.push(run);
    dependencies[index] = deps;
  };
  const React = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) };
  const compiled = transpileModule(code, { compilerOptions: { jsx: JsxEmit.React, module: ModuleKind.CommonJS } }).outputText;
  const { CleanUpSettings, CustomDurationDetails } = new Function("React", "useState", "useEffect", "useSettings", "updateSettings", "durationFromHours", "hoursFrom", "durationTitle", "Group", "Row", "Checkbox", "PopUp", "TextField", "View", "space", `${compiled}; return { CleanUpSettings, CustomDurationDetails };`)(React, useState, useEffect, (select) => select({ cleanUpInactiveTabsAfterHours: hours }), (patch) => { hours = patch.cleanUpInactiveTabsAfterHours; writes.push(hours); }, durationFromHours, hoursFrom, durationTitle, "Group", "Row", "Checkbox", "PopUp", "TextField", "View", { m: 8 });
  const render = (component, props) => {
    cursor = 0;
    const tree = component(props);
    effects.splice(0).forEach((run) => run());
    return tree;
  };
  const pane = () => render(CleanUpSettings);
  const menu = (tree) => tree.props.children[0].props.children[0].props;
  const details = (tree) => tree.props.children[1];
  let tree = pane();
  menu(tree).onChange("custom");
  tree = pane();
  assert.equal(menu(tree).value, "custom");
  assert.equal(menu(tree).options[1].title, "Custom…");
  assert.ok(details(tree));
  assert.deepEqual(writes, []);
  const detailProps = details(tree).props;
  menu(tree).onChange("12");
  tree = pane();
  assert.equal(menu(tree).value, "12");
  assert.ok(!details(tree));
  hours = 24;
  writes.length = 0;
  states = [];
  dependencies = [];
  const fields = () => render(CustomDurationDetails, { ...detailProps, hours }).props.children[0].props.children;
  let [amount, unit] = fields();
  assert.equal(amount.props.value, "1");
  assert.equal(unit.props.value, "days");
  unit.props.onChange("minutes");
  assert.deepEqual(writes, []);
  [amount] = fields();
  amount.props.onChangeText("30");
  assert.deepEqual(writes, []);
  [amount] = fields();
  amount.props.onSubmit();
  assert.equal(hours, 0.5);
  [amount, unit] = fields();
  unit.props.onChange("hours");
  assert.equal(hours, 30);
  amount.props.onChangeText("0");
  [amount] = fields();
  amount.props.onBlur();
  assert.equal(hours, 30);
  [amount] = fields();
  assert.equal(amount.props.value, "30");
  states = [];
  dependencies = [];
  hours = 0.75;
  tree = pane();
  assert.equal(menu(tree).value, "custom");
  assert.equal(menu(tree).options[1].title, "Custom…");
  assert.ok(details(tree));
  menu(tree).onChange("12");
  tree = pane();
  assert.equal(menu(tree).value, "12");
  assert.ok(!details(tree));
});

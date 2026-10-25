import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;

const P = await import("./profileTheme.ts");
const { profileTheme, PROFILE_COLORS } = await import("./theme.ts");
const { readableDark, padColor, startingTheme } = P;

const color = (r, g, b) => ({ r, g, b, a: 1 });

const solid = (c, extra = {}) => ({ stops: [{ x: 0.5, y: 0.5, color: c }], intensity: 1, mode: "light", grain: 0, texture: "grain", translucency: 0, ...extra });

test("a black theme gets light text even in light mode, and a white one dark text in dark mode", () => {
  assert.equal(readableDark(solid(color(0, 0, 0)), false), true);
  assert.equal(readableDark(solid(color(1, 1, 1)), true), false);
  const black = profileTheme({ color: "plum", theme: solid(color(0, 0, 0)) }, false);
  assert.equal(black.dark, true);
  assert.equal(black.textPrimary, "#FFFFFF");
  assert.equal(black.backdrop.themeAppearance, "dark", "the native backdrop goes dark with the text");
  const white = profileTheme({ color: "plum", theme: solid(color(1, 1, 1), { mode: "dark" }) }, true);
  assert.equal(white.dark, false);
  assert.equal(white.backdrop.themeAppearance, "light");
});

test("no theme the old colour pad could make changes appearance in light mode, nor at its defaults in dark", () => {
  for (let h = 0; h < 1; h += 0.02) for (let r = 0; r <= 0.5; r += 0.05) {
    const x = 0.5 + r * Math.cos(h * 2 * Math.PI), y = 0.5 + r * Math.sin(h * 2 * Math.PI);
    for (const intensity of [0, 0.5, 1]) for (const translucency of [0, 0.5, 1]) {
      assert.equal(readableDark(solid(padColor(x, y), { intensity, translucency }), false), false, `${x},${y}`);
    }
  }
  for (const spec of Object.values(PROFILE_COLORS)) {
    const theme = startingTheme(spec.swatch);
    assert.equal(readableDark(theme, false), false, spec.name);
    assert.equal(readableDark(theme, true), true, spec.name);
    assert.equal(profileTheme({ color: "plum", theme }, true).backdrop.themeAppearance, "auto", spec.name);
  }
});

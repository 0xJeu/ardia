import { padPosition, sanitizeTheme, THEME_TEXTURES } from "../../lib/profileTheme";
import type { ProfileTheme, ThemeColor, ThemeMode, ThemeTexture } from "../../store/types";

type Json = Record<string, unknown>;

const obj = (v: unknown): Json | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null);
const payload = (v: unknown): unknown => obj(v)?._0;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function arcColor(v: unknown): ThemeColor | null {
  const c = obj(v);
  if (!c) return null;
  const r = num(c.red), g = num(c.green), b = num(c.blue);
  if (r === null || g === null || b === null) return null;
  return { r, g, b, a: num(c.alpha) ?? 1 };
}

function appearanceOf(v: unknown, preferDark: boolean): "light" | "dark" | "auto" | null {
  const wrapper = obj(v);
  if (!wrapper) return null;
  const single = payload(wrapper.single);
  if (single === "light" || single === "dark") return single;
  const based = obj(wrapper.appearanceBased);
  if (based) {
    if (based.light === "light" && based.dark === "dark") return "auto";
    const pick = preferDark ? based.dark : based.light;
    if (pick === "light" || pick === "dark") return pick;
  }
  return null;
}

function backgroundOf(theme: Json, preferDark: boolean): Json | null {
  const background = obj(theme.background);
  if (!background) return null;
  const single = obj(payload(background.single));
  if (single) return single;
  const based = obj(background.appearanceBased);
  return obj(preferDark ? based?.dark : based?.light) ?? obj(based?.light) ?? obj(based?.dark);
}

export function parseArcTheme(input: unknown): ProfileTheme | null {
  let raw = input;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const theme = obj(raw);
  if (!theme) return null;
  const forced = appearanceOf(theme.windowAppearance, false);
  const background = backgroundOf(theme, forced === "dark");
  const kind = obj(payload(obj(background?.style)?.color));
  if (!kind) return null;

  const gradient = obj(payload(kind.blendedGradient));
  const single = obj(payload(kind.blendedSingleColor));
  const basic = obj(payload(kind.basicColor));
  const config = gradient ?? single ?? basic;
  if (!config) return null;

  let colors: ThemeColor[];
  if (gradient) {
    const base = (Array.isArray(gradient.baseColors) ? gradient.baseColors : []).map(arcColor).filter((c): c is ThemeColor => !!c).slice(0, 2);
    const overlay = (Array.isArray(gradient.overlayColors) ? gradient.overlayColors : []).map(arcColor).filter((c): c is ThemeColor => !!c);
    const third = overlay.length > 1 ? overlay[overlay.length - 1] : undefined;
    colors = third ? [...(base.length === 1 ? [base[0]!, base[0]!] : base), third] : base;
  } else {
    const color = arcColor(config.color);
    colors = color ? [color] : [];
  }
  if (!colors.length) return null;

  const modifiers = obj(config.modifiers);
  const texture = THEME_TEXTURES.includes(modifiers?.overlay as ThemeTexture) ? (modifiers!.overlay as ThemeTexture) : "grain";
  const translucencyStyle = config.translucencyStyle;
  const mode: ThemeMode =
    forced ?? (translucencyStyle === "light" || translucencyStyle === "dark" ? translucencyStyle : "auto");

  return sanitizeTheme({
    stops: colors.map((color) => ({ color, ...padPosition(color) })),
    intensity: num(modifiers?.intensityFactor) ?? 1,
    mode,
    grain: basic ? 0 : (num(modifiers?.noiseFactor) ?? 0),
    texture,
    translucency: basic ? 0 : 1,
  });
}

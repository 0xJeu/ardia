import type { BrowserState } from "../store/browser";
import { themeFor } from "./theme";

export type LaunchBackdrop = {
  dark: boolean;
  vibrancy: boolean;
  colors: [string, string];
  tintColor: string;
  tintAlpha: number;
  tintLightness: number;
  grainOpacity: number;
};

export function launchBackdrop(s: Pick<BrowserState, "windows" | "profiles" | "ui">, windowId: string | null | undefined): LaunchBackdrop | null {
  const w = windowId ? s.windows[windowId] : undefined;
  if (!w || w.incognito || w.kind === "small") return null;
  const dark = s.ui.appDark;
  const theme = themeFor(`${s.profiles[w.profileId]?.color ?? "plum"}:${dark ? "dark" : "light"}`);
  return { dark, vibrancy: true, colors: theme.windowTint, ...theme.backdrop, grainOpacity: theme.grain };
}

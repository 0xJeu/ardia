import type { MenuItem, MenuShortcut } from "@ardia/shell";
import { useBrowser } from "../store/browser";
import { shortcutSources } from "./commandCatalog";
import { formatShortcut, resolveShortcuts, storedShortcut, type ResolvedShortcuts, type Shortcut, type ShortcutOverrides, type ShortcutSource } from "./shortcuts";

type MenuModifier = NonNullable<Extract<MenuItem, { id: string }>["modifiers"]>[number];
type ShortcutState = { settings: { shortcuts: ShortcutOverrides }; profileOrder: readonly string[] };
type MenuBar = { listed: ReadonlySet<string>; fixed: readonly ShortcutSource[] };

let menuBar: MenuBar | undefined;
let resolvedFor: { overrides: ShortcutOverrides; profiles: readonly string[]; menuBar: MenuBar | undefined; resolved: ResolvedShortcuts } | undefined;

const fixedSource = (item: MenuShortcut): ShortcutSource => ({
  id: item.id,
  fixed: true,
  keys: [{ key: item.defaultKey, modifiers: item.defaultModifiers }, ...(item.aliases ?? []).map(storedShortcut)],
});

export function setMenuBarShortcuts(items: readonly MenuShortcut[]) {
  menuBar = { listed: new Set(items.map((item) => item.id)), fixed: items.filter((item) => !item.remappable).map(fixedSource) };
}

export function resolvedShortcuts({ settings, profileOrder }: ShortcutState): ResolvedShortcuts {
  const overrides = settings.shortcuts;
  const bar = menuBar;
  if (resolvedFor?.overrides !== overrides || resolvedFor.profiles !== profileOrder || resolvedFor.menuBar !== bar) {
    const listedIfKnown = bar ? Object.keys(overrides).filter((id) => bar.listed.has(id)) : Object.keys(overrides);
    const sources = [...shortcutSources(profileOrder, listedIfKnown), ...(bar?.fixed ?? [])];
    resolvedFor = { overrides, profiles: profileOrder, menuBar: bar, resolved: resolveShortcuts(sources, overrides) };
  }
  return resolvedFor.resolved;
}

export const shortcutOf = (id: string, s: ShortcutState = useBrowser.getState()): Shortcut | undefined => resolvedShortcuts(s).bindings.get(id)?.[0];

export function shortcutHint(id: string, s: ShortcutState = useBrowser.getState()): string | undefined {
  const shortcut = shortcutOf(id, s);
  return shortcut && formatShortcut(shortcut);
}

export function menuShortcut(id: string, s: ShortcutState = useBrowser.getState()): { key?: string; modifiers?: MenuModifier[] } {
  const shortcut = shortcutOf(id, s);
  if (!shortcut || shortcut.modifiers.includes("function")) return {};
  return { key: shortcut.key, modifiers: shortcut.modifiers.filter((m): m is MenuModifier => m !== "function") };
}

export function withShortcut(title: string, hint: string | undefined): string {
  return hint ? `${title} (${hint})` : title;
}

export const useShortcutHint = (id: string): string | undefined => useBrowser((s) => shortcutHint(id, s));

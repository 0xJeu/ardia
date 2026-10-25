import type { MenuItem } from "@ardia/shell";
import { useBrowser } from "../store/browser";
import { shortcutSources } from "./commandCatalog";
import { formatShortcut, resolveShortcuts, type ResolvedShortcuts, type Shortcut, type ShortcutOverrides } from "./shortcuts";

type MenuModifier = NonNullable<Extract<MenuItem, { id: string }>["modifiers"]>[number];
type ShortcutState = { settings: { shortcuts: ShortcutOverrides }; profileOrder: readonly string[] };

let resolvedFor: { overrides: ShortcutOverrides; profiles: readonly string[]; resolved: ResolvedShortcuts } | undefined;

function resolved({ settings, profileOrder }: ShortcutState): ResolvedShortcuts {
  if (resolvedFor?.overrides !== settings.shortcuts || resolvedFor.profiles !== profileOrder) {
    const sources = shortcutSources(profileOrder, Object.keys(settings.shortcuts));
    resolvedFor = { overrides: settings.shortcuts, profiles: profileOrder, resolved: resolveShortcuts(sources, settings.shortcuts) };
  }
  return resolvedFor.resolved;
}

export const shortcutOf = (id: string, s: ShortcutState = useBrowser.getState()): Shortcut | undefined => resolved(s).bindings.get(id)?.[0];

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

import type { MenuItem } from "../../platform/menus";
import { menuShortcut } from "../commands/commandShortcuts";
import { folderChildren } from "../bookmarks/bookmarks";
import type { BrowserState } from "../browser/store";
import { bookmarkProfileId, windowTitle } from "../browser/model";
import { groupLabel } from "../pins/organize";
import { groupPath } from "../groups/groups";

export { menuSections as sections } from "../app/menuSections";

export type Choice = Extract<MenuItem, { id: string }>;

export const sep = { separator: true } as const;

export const hintWhen = (on: boolean, command: string, s?: BrowserState) => (on ? menuShortcut(command, s) : {});

const sameModifiers = (a: readonly string[] = [], b: readonly string[] = []) => a.length === b.length && a.every((m) => b.includes(m));

export function withAlternate(primary: Choice, alternate: Choice, commands: readonly [string, string] | null, s?: BrowserState): MenuItem[] {
  const keys = commands ? [menuShortcut(commands[0], s), menuShortcut(commands[1], s)] : [];
  const [a, b] = keys;
  if (a?.key && b?.key && a.key === b.key && sameModifiers(b.modifiers, [...(a.modifiers ?? []), "option"])) {
    return [{ ...primary, ...a }, { ...alternate, ...b, alternate: true }];
  }
  return [
    { ...primary, modifiers: [] },
    { ...alternate, modifiers: ["option"], alternate: true },
  ];
}

export function profileItems(s: BrowserState, isCurrent: (profileId: string) => boolean): MenuItem[] {
  return [
    ...s.profileOrder.map((id) => ({ id: `profile:${id}`, title: s.profiles[id]!.name, checked: isCurrent(id), enabled: !isCurrent(id) })),
    sep,
    { id: "profile:new", title: "New Profile…" },
  ];
}

export function windowItems(s: BrowserState, windowId: string): MenuItem[] {
  const others = s.windowOrder.filter((id) => id !== windowId && !s.windows[id]!.incognito && s.windows[id]!.kind !== "small");
  return [...others.map((id) => ({ id: `window:${id}`, title: windowTitle(s, id) })), ...(others.length ? [sep] : []), { id: "window:new", title: "New Window" }];
}

export function groupItems(s: BrowserState, windowId: string, exclude: string | undefined): MenuItem[] {
  const w = s.windows[windowId];
  const byTitle = (a: Choice, z: Choice) => (a.title < z.title ? -1 : a.title > z.title ? 1 : 0);
  const listed = Object.values(s.groups)
    .filter((g) => g.windowId === windowId && g.profileId === w?.profileId && g.id !== exclude)
    .map((g) => ({ pinned: g.pinned, item: { id: `group:${g.id}`, title: groupPath(s.groups, g.id).map((id) => groupLabel(s, s.groups[id]!)).join(" › ") } }));
  const pinned = listed.filter((g) => g.pinned).map((g) => g.item).sort(byTitle);
  const rest = listed.filter((g) => !g.pinned).map((g) => g.item).sort(byTitle);
  if (!pinned.length) return rest;
  return [{ id: "group:header", title: "Pinned", enabled: false }, ...pinned, ...(rest.length ? [sep, ...rest] : [])];
}

export function bookmarkFolderItems(s: BrowserState, windowId: string): MenuItem[] {
  const roots = s.bookmarks.roots[bookmarkProfileId(s, s.windows[windowId])];
  const folders = roots ? [...folderChildren(s.bookmarks, roots.bar), ...folderChildren(s.bookmarks, roots.other)].filter((n) => n.kind === "folder") : [];
  return [
    { id: "folder:bar", title: "Bookmarks Bar" },
    ...(roots ? [{ id: `folder:${roots.other}`, title: "Other Bookmarks" }] : []),
    ...folders.map((f) => ({ id: `folder:${f.id}`, title: f.title })),
    sep,
    { id: "folder:new", title: "New Folder…" },
  ];
}

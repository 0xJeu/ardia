import { closeGroup } from "../../lib/actions";
import { useBrowser, type BrowserState } from "../../store/browser";
import { rootOf } from "../../store/groups";
import { closeIntent, closeKind, openPages } from "../../store/tabs";
import { middleClickTab } from "./menus";

export type CloseControl = { icon: "xmark" | "minus"; tooltip: string };

const CLOSE_TAB: CloseControl = { icon: "xmark", tooltip: "Close Tab (⌘W)" };
const UNLOAD_TAB: CloseControl = { icon: "minus", tooltip: "Unload Tab (⌘W)" };
const REMOVE_PIN: CloseControl = { icon: "xmark", tooltip: "Remove Pinned Tab" };
const CLOSE_GROUP: CloseControl = { icon: "xmark", tooltip: "Close Group" };
const UNLOAD_GROUP: CloseControl = { icon: "minus", tooltip: "Unload Tabs" };

const TAB_CONTROLS = { close: CLOSE_TAB, unload: UNLOAD_TAB, removePin: REMOVE_PIN } as const;

export const tabCloseControl = (s: BrowserState, tabId: string): CloseControl => TAB_CONTROLS[closeKind(s, tabId)];

export const useTabCloseControl = (tabId: string) => useBrowser((s) => tabCloseControl(s, tabId));

const openMembers = (s: BrowserState, groupId: string) => (s.groups[groupId]?.tabIds ?? []).flatMap((id) => openPages(s, id));

export function groupCloseControl(s: BrowserState, groupId: string): CloseControl | null {
  if (!s.groups[groupId]) return null;
  if (!rootOf(s.groups, groupId)?.pinned) return CLOSE_GROUP;
  return openMembers(s, groupId).length ? UNLOAD_GROUP : null;
}

export const useGroupCloseControl = (groupId: string) => useBrowser((s) => groupCloseControl(s, groupId));

export function pressGroupClose(groupId: string) {
  const s = useBrowser.getState();
  const control = groupCloseControl(s, groupId);
  if (control === UNLOAD_GROUP) s.closeTabs(openMembers(s, groupId));
  else if (control === CLOSE_GROUP) void closeGroup(groupId);
}

export function pressTabClose(tabId: string) {
  const s = useBrowser.getState();
  const intent = closeIntent(s, tabId);
  if (intent.kind === "unload") s.closeTabs(intent.ids);
  else middleClickTab(tabId);
}

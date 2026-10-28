import { showMenu, type MenuItem } from "../../platform/menus";
import { closeGroup, moveGroupToProfile, moveGroupToWindow } from "../browser/actions";
import { useBrowser, type BrowserState } from "../browser/store";
import { activeTabId, isIncognitoProfile } from "../browser/model";
import { groupOf } from "../pins/organize";
import { hasOwnGroupIcon } from "../groups/groupIcons";
import type { GroupColor } from "../browser/types";
import { copyUrls, openIconPicker, startRename } from "./actions";
import { toggleNewTabBar } from "../omnibox/newTabBar";
import { hintWhen, profileItems, sections, windowItems, withAlternate } from "./menuParts";

export type GroupColorMenu = (current: GroupColor | null, siteColor: string | null | undefined) => MenuItem[];

const store = () => useBrowser.getState();

export function groupMenuItems(s: BrowserState, windowId: string, groupId: string, colors: MenuItem[]): MenuItem[] {
  const g = s.groups[groupId];
  if (!g) return [];
  const shown = groupOf(s, activeTabId(s, windowId))?.id === groupId;
  const incognito = isIncognitoProfile(g.profileId);
  return sections(
    g.parentId ? [] : [{ id: "pin", title: g.pinned ? "Unpin Group" : "Pin Group", symbol: g.pinned ? "pin.slash" : "pin" }],
    [
      { id: "newTab", title: "New Tab in Group", symbol: "plus.app", ...hintWhen(shown, "newTabInGroup", s) },
      { id: "nest", title: "New Nested Group" },
      { id: "duplicate", title: "Duplicate Group", symbol: "plus.square.on.square" },
    ],
    [
      { id: "moveToProfile", title: "Move to Profile", symbol: "person", enabled: !incognito, children: profileItems(s, (id) => id === g.profileId) },
      ...(g.pinned ? [] : [{ id: "moveToWindow", title: "Move to Window", symbol: "macwindow", enabled: !incognito, children: windowItems(s, windowId) }]),
    ],
    [
      { id: "rename", title: "Rename…", symbol: "pencil" },
      { id: "icon", title: hasOwnGroupIcon(g.icon) ? "Change Icon…" : "Add Icon…", symbol: "photo" },
      { id: "color", title: "Color", symbol: "paintpalette", children: colors },
    ],
    withAlternate({ id: "copy", title: "Copy All Links", symbol: "link" }, { id: "copyMd", title: "Copy All Links as Markdown", symbol: "link" }, null),
    [
      { id: "ungroup", title: "Ungroup", symbol: "folder.badge.minus" },
      { id: "bookmarkBar", title: "Move to Bookmarks Bar", symbol: "bookmark" },
      { id: "close", title: "Close Group", symbol: "xmark", ...hintWhen(shown, "closeTabGroup", s) },
      { id: "delete", title: "Delete Group", symbol: "trash" },
    ],
  );
}

export async function openGroupMenu(windowId: string, groupId: string, colorMenu: GroupColorMenu) {
  const s = store();
  const g = s.groups[groupId];
  if (!g) return;
  const siteColor = g.tabIds.map((id) => s.live[id]?.themeColor).find(Boolean);
  const choice = await showMenu(groupMenuItems(s, windowId, groupId, colorMenu(g.color, siteColor)));
  if (choice) runGroupChoice(windowId, groupId, choice);
}

function runGroupChoice(windowId: string, groupId: string, choice: string) {
  const s = store();
  const g = s.groups[groupId];
  if (!g || g.windowId !== windowId) return;
  const target = { kind: "group" as const, id: groupId };
  if (choice === "rename") void startRename(windowId, target);
  else if (choice === "icon") void openIconPicker(windowId, target);
  else if (choice.startsWith("color:")) s.updateGroup(groupId, { color: (choice.slice(6) || null) as GroupColor | null });
  else if (choice === "newTab") {
    if (toggleNewTabBar(windowId, { kind: "group", groupId })) return;
    const id = s.newTabInGroup(groupId);
    if (id) store().activate(id);
  } else if (choice === "nest") {
    const child = s.newNestedGroup(groupId);
    const tabId = store().groups[child]?.tabIds[0];
    if (tabId) store().activate(tabId);
    if (child) void startRename(windowId, { kind: "group", id: child });
  } else if (choice === "pin") s.moveGroup(groupId, { pinned: !g.pinned });
  else if (choice === "duplicate") s.duplicateGroup(groupId);
  else if (choice.startsWith("profile:")) void moveGroupToProfile(groupId, choice.slice(8));
  else if (choice.startsWith("window:")) moveGroupToWindow(groupId, choice.slice(7));
  else if (choice === "copy") copyUrls(g.tabIds, false);
  else if (choice === "copyMd") copyUrls(g.tabIds, true);
  else if (choice === "ungroup") s.ungroup(groupId);
  else if (choice === "bookmarkBar") s.moveGroupToBookmarksBar(groupId);
  else if (choice === "close") void closeGroup(groupId);
  else if (choice === "delete") s.deleteGroup(groupId);
}

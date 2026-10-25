import type { CommandAction } from "@ardia/core";
import type { BrowserCommand } from "@ardia/shell";
import { isBookmarked } from "../../store/bookmarks";
import { useBrowser, type BrowserState } from "../../store/browser";
import { activeTab, bookmarkProfileId, isPinnedRow, pinnedSectionTitle } from "../../store/model";
import { canTidyPins } from "../../store/tidyPins";
import { shortcutHint } from "../../lib/commandShortcuts";
import type { Tab } from "../../store/types";
import { organizeActions } from "./organizeActions";

type Context = { s: BrowserState; windowId: string; tab: Tab | undefined };

type ActionDef = {
  command: BrowserCommand;
  arg?: string;
  title: string | ((c: Context) => string);
  icon: string;
  keywords?: string[];
  needs?: "page" | "tab" | "profiles" | "pins";
};

const page = "page" as const;

const DEFS: ActionDef[] = [
  { command: "newTab", title: "New Tab", icon: "plus", keywords: ["open tab"] },
  { command: "newWindow", title: "New Window", icon: "macwindow" },
  { command: "newIncognitoWindow", title: "New Incognito Window", icon: "eyeglasses", keywords: ["private window", "incognito"] },
  { command: "closeTab", title: "Close Tab", icon: "xmark", needs: "tab" },
  { command: "closeAllTabs", title: "Close All Tabs", icon: "xmark.square", keywords: ["clear unpinned tabs", "close unpinned tabs", "clear today"] },
  { command: "reopenClosedTab", title: "Reopen Closed Tab", icon: "arrow.uturn.backward", keywords: ["undo close", "restore tab"] },
  {
    command: "togglePin",
    title: ({ tab }) => (isPinnedRow(tab) ? "Unpin Tab" : tab?.pinned ? "Unpin from Top Apps" : "Move to Top Apps"),
    icon: "pin",
    keywords: ["pin", "unpin", "pin tab", "unpin tab", "remove from top apps", "favorites"],
    needs: "tab",
  },
  {
    command: "togglePin",
    arg: "row",
    title: ({ s, tab }) => (isPinnedRow(tab) ? "Move to Top Apps" : `Move to ${pinnedSectionTitle(s, tab)}`),
    icon: "list.bullet",
    keywords: ["pin", "pinned tabs", "pin as row", "move to pinned", "favorites"],
    needs: "tab",
  },
  { command: "duplicateTab", title: "Duplicate Tab", icon: "plus.square.on.square", needs: "tab" },
  { command: "renameTab", title: "Rename Tab", icon: "pencil", needs: "tab" },
  { command: "searchTabs", title: "Search Tabs", icon: "magnifyingglass" },
  { command: "cleanUpTabs", title: "Clean Up Tabs", icon: "sparkles", keywords: ["tidy tabs"] },
  { command: "tidyPins", title: "Tidy Pins", icon: "sparkles", keywords: ["tidy pinned tabs", "organize pins", "pinned folders", "remove duplicate pins"], needs: "pins" },
  { command: "newGroupWithTabs", title: "New Group with Tab", icon: "folder.badge.plus", keywords: ["tab group"], needs: "tab" },
  { command: "reload", title: "Reload Page", icon: "arrow.clockwise", keywords: ["refresh"], needs: page },
  { command: "forceReload", title: "Force Reload Page", icon: "arrow.clockwise", keywords: ["hard reload", "hard refresh"], needs: page },
  { command: "toggleMute", title: ({ tab }) => (tab?.muted ? "Unmute Site" : "Mute Site"), icon: "speaker.slash", keywords: ["mute", "unmute", "silence"], needs: page },
  { command: "copyUrl", title: "Copy URL", icon: "link", keywords: ["copy link"], needs: page },
  { command: "copyUrlAsMarkdown", title: "Copy URL as Markdown", icon: "link", keywords: ["markdown link"], needs: page },
  { command: "findInPage", title: "Find in Page", icon: "text.magnifyingglass", needs: page },
  {
    command: "bookmarkPage",
    title: ({ s, windowId, tab }) =>
      tab?.url && isBookmarked(s.bookmarks, bookmarkProfileId(s, s.windows[windowId]), tab.url) ? "Remove Bookmark" : "Bookmark This Page",
    icon: "bookmark",
    keywords: ["add bookmark", "bookmark"],
    needs: page,
  },
  { command: "print", title: "Print", icon: "printer", needs: page },
  { command: "share", title: "Share", icon: "square.and.arrow.up", keywords: ["airdrop", "share link", "send link"], needs: page },
  { command: "zoomIn", title: "Zoom In", icon: "plus.magnifyingglass", needs: page },
  { command: "zoomOut", title: "Zoom Out", icon: "minus.magnifyingglass", needs: page },
  { command: "zoomReset", title: "Actual Size", icon: "1.magnifyingglass", keywords: ["reset zoom"], needs: page },
  { command: "devTools", title: "Developer Tools", icon: "hammer", keywords: ["inspect", "devtools", "console"], needs: page },
  { command: "toggleFullUrl", title: ({ s }) => (s.settings.showFullUrl ? "Hide Full URL" : "Show Full URL"), icon: "text.alignleft" },
  { command: "toggleSidebar", title: "Auto-Hide Tabs", icon: "sidebar.left", keywords: ["toggle sidebar", "hide sidebar", "show sidebar", "focus mode"] },
  { command: "toggleBookmarksBar", title: "Toggle Bookmarks Bar", icon: "menubar.rectangle", keywords: ["bookmarks bar"] },
  { command: "downloads", title: "Downloads", icon: "arrow.down.circle", keywords: ["show downloads", "dl"] },
  { command: "showHistory", title: "History", icon: "clock", keywords: ["show history"] },
  { command: "manageBookmarks", title: "Bookmarks", icon: "book", keywords: ["manage bookmarks", "show bookmarks"] },
  { command: "openSettings", title: "Settings", icon: "gearshape", keywords: ["preferences", "prefs", "options"] },
  { command: "clearBrowsingData", title: "Clear Browsing Data", icon: "trash", keywords: ["clear history", "clear cache", "clear cookies"] },
  { command: "importBrowserData", title: "Import Browser Data", icon: "square.and.arrow.down", keywords: ["import bookmarks", "import passwords"] },
  { command: "keyboardShortcuts", title: "Keyboard Shortcuts", icon: "keyboard", keywords: ["shortcuts", "hotkeys"] },
  { command: "mergeAllWindows", title: "Merge All Windows", icon: "rectangle.stack", needs: "profiles" },
  { command: "newProfile", title: "New Profile", icon: "person.crop.circle.badge.plus", keywords: ["create profile"], needs: "profiles" },
  { command: "setAppearance", arg: "dark", title: "Dark Appearance", icon: "moon", keywords: ["dark mode"] },
  { command: "setAppearance", arg: "light", title: "Light Appearance", icon: "sun.max", keywords: ["light mode"] },
  { command: "setAppearance", arg: "auto", title: "Use System Appearance", icon: "circle.lefthalf.filled", keywords: ["auto appearance", "system appearance"] },
];

const actionId = (d: Pick<ActionDef, "command" | "arg">) => (d.arg ? `${d.command}:${d.arg}` : d.command);

export function barActions(s: BrowserState, windowId: string): CommandAction[] {
  const w = s.windows[windowId];
  const tab = activeTab(s, windowId);
  const c: Context = { s, windowId, tab };
  const out: CommandAction[] = [];
  for (const d of DEFS) {
    if (d.needs === "page" && !tab?.url) continue;
    if (d.needs === "tab" && !tab) continue;
    if (d.needs === "profiles" && w?.incognito) continue;
    if (d.needs === "pins" && !canTidyPins(s, windowId)) continue;
    const id = actionId(d);
    const hint = shortcutHint(id, s);
    out.push({
      id,
      title: typeof d.title === "string" ? d.title : d.title(c),
      icon: d.icon,
      ...(hint ? { hint } : {}),
      ...(d.keywords ? { keywords: d.keywords } : {}),
    });
  }
  if (w && !w.incognito) {
    s.profileOrder.forEach((id) => {
      if (id === w.profileId) return;
      const name = s.profiles[id]?.name ?? "";
      const action = `switchProfile:${id}`;
      out.push({ id: action, title: `Switch to ${name}`, icon: "person.crop.circle", hint: shortcutHint(action, s), keywords: [name, "profile", "space"] });
    });
  }
  out.push(...organizeActions(s, windowId));
  return out;
}

const barActionsOf = new WeakMap<BrowserState, Map<string, CommandAction[]>>();

export function currentBarActions(windowId: string): CommandAction[] {
  const s = useBrowser.getState();
  let byWindow = barActionsOf.get(s);
  if (!byWindow) barActionsOf.set(s, (byWindow = new Map()));
  let actions = byWindow.get(windowId);
  if (!actions) byWindow.set(windowId, (actions = barActions(s, windowId)));
  return actions;
}

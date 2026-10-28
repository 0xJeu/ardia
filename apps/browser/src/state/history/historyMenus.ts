import { confirm } from "../../platform/dialogs";
import { showMenu, type MenuItem } from "../../platform/menus";
import { menuSections } from "../app/menuSections";
import { copyLinkItems, openAllItems, openLinkItems, runLinkChoice, type Link } from "../bookmarks/linkMenus";

export async function confirmRemoveSelected(windowId: string): Promise<boolean> {
  const { confirmed } = await confirm({
    title: "Remove selected items?",
    message: "Are you sure you want to delete these pages from your history?",
    confirmTitle: "Remove",
    destructive: true,
    windowId,
  });
  return confirmed;
}

export function historyRowMenuItems(count: number): MenuItem[] {
  if (count > 1)
    return menuSections(openAllItems(count, count), copyLinkItems(count), [{ id: "remove", title: `Remove ${count} Pages from History…`, symbol: "trash" }]);
  return menuSections(
    openLinkItems(),
    [...copyLinkItems(), { id: "more", title: "More from This Site", symbol: "magnifyingglass" }],
    [{ id: "remove", title: "Remove from History", symbol: "trash" }],
  );
}

export async function openHistoryRowMenu(entries: Link[], windowId: string, onMoreFromSite: (url: string) => void, onRemove: (urls: string[]) => void) {
  if (!entries.length) return;
  const choice = await showMenu(historyRowMenuItems(entries.length));
  if (runLinkChoice(choice, entries, windowId)) return;
  if (choice === "more") onMoreFromSite(entries[0]!.url);
  if (choice === "remove") {
    if (entries.length > 1 && !(await confirmRemoveSelected(windowId))) return;
    onRemove(entries.map((e) => e.url));
  }
}

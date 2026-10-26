import { showMenu } from "@ardia/shell";
import { useBrowser } from "../../state/browser/store";
import { activeTabId } from "../../state/browser/model";
import { clickTab } from "../../state/sidebar/actions";
import { renameFolder } from "../sidebar/tileFolderUi";
import { folderMenuItems, tileFolderMenuItems } from "./stripGroups";

export async function openFolderMenu(windowId: string, groupId: string) {
  const s = useBrowser.getState();
  const choice = await showMenu(folderMenuItems(s, groupId, activeTabId(s, windowId)));
  if (choice?.startsWith("t:") && useBrowser.getState().tabs[choice.slice(2)]) clickTab(windowId, choice.slice(2));
}

export async function openTileFolderStripMenu(windowId: string, folderId: string) {
  const s = useBrowser.getState();
  const choice = await showMenu(tileFolderMenuItems(s, windowId, folderId, activeTabId(s, windowId)));
  if (choice === "rename") void renameFolder(windowId, folderId);
  else if (choice?.startsWith("t:") && useBrowser.getState().tabs[choice.slice(2)]) clickTab(windowId, choice.slice(2));
}

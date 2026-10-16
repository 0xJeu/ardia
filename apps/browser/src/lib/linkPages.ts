import { claimLinkTab } from "@ardia/ardiacore";
import { useBrowser } from "../store/browser";
import { engineProfile } from "../store/model";

export function claimLinkPage(tabId: string | undefined, url: string) {
  const tab = tabId ? useBrowser.getState().tabs[tabId] : undefined;
  if (tab && tab.navigation?.url === url && !tab.adoptId && !tab.wakeAdoptId) claimLinkTab(tab.id, url, engineProfile(tab.profileId));
}

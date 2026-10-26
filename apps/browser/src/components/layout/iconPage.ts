import { faviconOutlived } from "../../lib/favicons";
import { useBrowser } from "../../store/browser";
import { pageOf, patchPage } from "./pageState";

export function adoptIconPage(tabId: string) {
  if (pageOf(tabId).iconPage === null) patchPage(tabId, { iconPage: useBrowser.getState().tabs[tabId]?.url || null });
}

export function noteIconPage(tabId: string) {
  patchPage(tabId, { iconPage: useBrowser.getState().tabs[tabId]?.url || null });
}

export function dropOutlivedFavicon(tabId: string, url: string, isLoading: boolean) {
  const tab = useBrowser.getState().tabs[tabId];
  if (!isLoading && tab?.favicon && faviconOutlived(pageOf(tabId).iconPage, url)) useBrowser.getState().updateTab(tabId, { favicon: null });
}

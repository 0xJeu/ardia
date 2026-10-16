import { releaseLinkTabs } from "@ardia/ardiacore";
import { focus, openWindow } from "../../lib/actions";
import { claimLinkPage } from "../../lib/linkPages";
import { runsJavaScript } from "../../lib/scriptUrls";
import { useBrowser } from "../../store/browser";
import { activeTabId } from "../../store/model";
import { isSmall, lastActiveProfile, mainWindowFor } from "../../store/small";

const store = () => useBrowser.getState();

export function openLittleArdia(url?: string, profileId?: string): string {
  const id = store().createWindow({ small: true, url, profileId });
  if (!url) store().openPanel(id, "");
  return id;
}

const opensInLittleArdia = (url: string) => /^(https?|file):/i.test(url);

export function openExternalUrls(given: string[]) {
  try {
    openUrlsFromApps(given);
  } finally {
    releaseLinkTabs();
  }
}

function openUrlsFromApps(given: string[]) {
  const settings = store().settings;
  const urls = settings.allowJavaScriptFromAppleEvents ? given : given.filter((url) => !runsJavaScript(url, settings));
  if (!urls.length) return;
  const [url] = urls;
  const profileId = lastActiveProfile(store());
  if (store().settings.openLinksInLittleArdia && urls.length === 1 && url && opensInLittleArdia(url)) {
    const windowId = openLittleArdia(url, profileId);
    return void claimLinkPage(activeTabId(store(), windowId), url);
  }
  openLinksInMainWindow(urls, profileId);
}

function openLinksInMainWindow(urls: string[], profileId: string) {
  let target = mainWindowFor(store(), profileId);
  for (const url of urls) {
    const s = store();
    const w = target ? s.windows[target] : undefined;
    const blank = w && w.tabIds.length === 1 ? s.tabs[w.tabIds[0]!] : undefined;
    if (!w) {
      target = openWindow({ url, profileId });
      claimLinkPage(activeTabId(store(), target), url);
    } else if (blank && !blank.url && !blank.navigation && blank.profileId === profileId && !s.windowUi[w.id]?.panel.open) s.navigate(blank.id, url);
    else claimLinkPage(s.newTab(w.id, { url, profileId }), url);
  }
  if (target) focus(target);
}

export function openInMainWindow(windowId: string) {
  const s = store();
  if (!isSmall(s, windowId)) return;
  const tabId = activeTabId(s, windowId);
  const tab = tabId ? s.tabs[tabId] : undefined;
  const target = mainWindowFor(s, tab?.profileId ?? s.windows[windowId]!.profileId);
  if (!tab?.url) {
    s.closeWindow(windowId);
    if (target) focus(target);
    else openWindow({ profileId: tab?.profileId });
    return;
  }
  const moved = s.moveTabsToWindow([tab.id], target ?? null);
  if (moved) focus(moved);
}

export function closeLittleArdia(windowId: string) {
  if (isSmall(store(), windowId)) store().closeWindow(windowId);
}

export function closeLittleArdiaOnEscape(tabId: string) {
  const s = store();
  const tab = s.tabs[tabId];
  if (!tab || !isSmall(s, tab.windowId) || s.find[tabId]?.open || s.windowUi[tab.windowId]?.panel.open) return;
  closeLittleArdia(tab.windowId);
}

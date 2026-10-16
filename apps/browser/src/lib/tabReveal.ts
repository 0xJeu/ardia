import { revealOffered, revealTab } from "@ardia/ardiacore";
import { pageOf } from "../components/layout/pageState";
import { useBrowser, type BrowserState } from "../store/browser";
import { activeTabId } from "../store/model";
import { splitOf } from "../store/splits";
import type { Tab } from "../store/types";

const WEB_PAGE = /^(https?|file):/i;

const OFFERED = /^(tab|ardiacore):/;

export type Switch = { tabId: string; offered?: string; over: string };

const hasPage = (t: Tab | undefined): t is Tab => !!t && !!(t.navigation || t.adoptId) && WEB_PAGE.test(t.url);

export function switchedTabs(s: BrowserState, prev: BrowserState): Switch[] {
  if (s.windows === prev.windows) return [];
  const out: Switch[] = [];
  for (const id in s.windows) {
    const w = s.windows[id]!;
    const was = prev.windows[id];
    if (!was || w === was || w.profileId !== was.profileId || w.kind === "small") continue;
    const next = activeTabId(s, id);
    const before = activeTabId(prev, id);
    if (!next || !before || next === before) continue;
    if (splitOf(prev, before) || splitOf(s, next) || pageOf(before).fullscreen) continue;
    const tab = s.tabs[next];
    const had = prev.tabs[next];
    if (!hasPage(tab) || tab.windowId !== id) continue;
    const page = pageOf(next);
    if (page.newTabShown || page.fullscreen) continue;
    if (hasPage(had)) out.push({ tabId: next, over: before });
    else if (!had && tab.adoptId && OFFERED.test(tab.adoptId) && hasPage(prev.tabs[before]) && !pageOf(before).newTabShown)
      out.push({ tabId: next, offered: tab.adoptId, over: before });
  }
  return out;
}

export function startTabReveal() {
  useBrowser.subscribe((s, prev) => {
    for (const { tabId, offered, over } of switchedTabs(s, prev)) {
      if (offered) revealOffered(offered, over);
      else revealTab(tabId);
    }
  });
}

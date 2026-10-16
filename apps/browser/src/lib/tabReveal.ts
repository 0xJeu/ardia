import { revealTab } from "@ardia/ardiacore";
import { pageOf } from "../components/layout/pageState";
import { useBrowser, type BrowserState } from "../store/browser";
import { activeTabId } from "../store/model";
import { splitOf } from "../store/splits";

const WEB_PAGE = /^(https?|file):/i;

export function switchedTabs(s: BrowserState, prev: BrowserState): string[] {
  if (s.windows === prev.windows) return [];
  const out: string[] = [];
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
    if (!tab || !had || !(had.navigation || had.adoptId) || !(tab.navigation || tab.adoptId) || !WEB_PAGE.test(tab.url) || tab.windowId !== id) continue;
    const page = pageOf(next);
    if (page.newTabShown || page.fullscreen) continue;
    out.push(next);
  }
  return out;
}

export function startTabReveal() {
  useBrowser.subscribe((s, prev) => {
    for (const id of switchedTabs(s, prev)) revealTab(id);
  });
}

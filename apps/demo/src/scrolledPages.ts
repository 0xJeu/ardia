import { noteScroll } from "../../browser/src/components/layout/toolbarAutoHide";
import { useBrowser, type BrowserState } from "../../browser/src/store/browser";
import { splitOf } from "../../browser/src/store/splits";

const SCROLL_AFTER_SWITCH_MS = 700;
const TEXT_ENTRY = "input, textarea, [contenteditable=''], [contenteditable='true']";

function shownTabs(s: BrowserState) {
  const w = s.windows[s.ui.focusedWindowId ?? ""];
  const active = w?.activeTabIds[w.profileId];
  if (!active) return [];
  return splitOf(s, active)?.tabIds ?? [active];
}

const hidesToolbar = (s: BrowserState) => s.settings.hideToolbarWhileScrolling && s.settings.addressBar === "toolbar";

const keyOf = (s: BrowserState) => (hidesToolbar(s) ? shownTabs(s).join(",") : "");

const typing = () => document.activeElement instanceof Element && document.activeElement.matches(TEXT_ENTRY);

export function startScrolledPages() {
  let marked = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const scroll = (key: string) => {
    if (!key || keyOf(useBrowser.getState()) !== key || typing()) return;
    for (const id of key.split(",")) noteScroll(id, { state: "down" });
  };
  useBrowser.subscribe((s, prev) => {
    const key = keyOf(s);
    if (key === marked) return;
    marked = key;
    clearTimeout(timer);
    if (!hidesToolbar(prev)) scroll(key);
    else timer = setTimeout(() => scroll(key), SCROLL_AFTER_SWITCH_MS);
  });
}

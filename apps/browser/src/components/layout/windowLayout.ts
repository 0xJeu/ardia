import { create } from "zustand";
import { switchOn } from "../../lib/killSwitches";
import { layout } from "../../lib/theme";
import { useBrowser, type BrowserState } from "../../store/browser";
import { useWindowId } from "../../store/hooks";

export function useTabLayout(): "sidebar" | "top" {
  const windowId = useWindowId();
  return useBrowser((s) => s.windows[windowId]?.tabLayout ?? s.settings.tabLayout);
}

// Arc's layout: the address bar stays in the sidebar while it's hidden, as Arc's does (the card has no toolbar row and
// the bar shows in the peek panel). With the slide's switch off it moves to a toolbar on the card, as before.
export function addressBarInSidebar(s: BrowserState, windowId: string): boolean {
  const w = s.windows[windowId];
  return (
    !!w &&
    s.settings.addressBar === "sidebar" &&
    (w.sidebarOpen || switchOn("sidebarSlide")) &&
    (w.tabLayout ?? s.settings.tabLayout) === "sidebar"
  );
}

export function useAddressBarInSidebar(): boolean {
  const windowId = useWindowId();
  return useBrowser((s) => addressBarInSidebar(s, windowId));
}

export const SIDEBAR_FIELD = { top: 48, height: layout.rowHeight, radius: 10 } as const;
// Dia: 34pt button, 41pt footer whose 28pt band is centred above its bottom 3pt (22pt up, where the profile dots sit).
// Centred on that band, the button is 5pt off the window's bottom and sidebarInset off its left: its radius-10 corner
// runs concentric with the window's, as the card's does.
export const SIDEBAR_FOOTER_DOWNLOADS = { bottom: 3 + (41 - 3 - 34) / 2, size: 34 } as const;
export function listTopGap(addressBar: boolean): number {
  return addressBar ? 6 : layout.pinnedTop - layout.sidebarHeader;
}

export const SIDEBAR_HEADER_WITH_FIELD = SIDEBAR_FIELD.top + SIDEBAR_FIELD.height;

type UrlAnchor = { left: number; top: number; width: number; sidebar?: { height: number } };

export const useUrlAnchors = create<Record<string, UrlAnchor>>()(() => ({}));

export function setUrlAnchor(windowId: string, anchor: UrlAnchor) {
  const current = useUrlAnchors.getState()[windowId];
  if (current && current.left === anchor.left && current.top === anchor.top && current.width === anchor.width && current.sidebar?.height === anchor.sidebar?.height) return;
  useUrlAnchors.setState({ [windowId]: anchor });
}

// The toolbar extensions' width in each window (all its toolbars lay out the same), as the toolbars publish it: the card
// places the URL anchor from it without its own hooks on the stores it comes from, which ran a selector each on every
// store update and re-rendered the card as extensions loaded.
export const useToolbarExtensionsWidths = create<Record<string, number>>()(() => ({}));

export function setToolbarExtensionsWidth(windowId: string, width: number) {
  if (useToolbarExtensionsWidths.getState()[windowId] === width) return;
  useToolbarExtensionsWidths.setState({ [windowId]: width });
}

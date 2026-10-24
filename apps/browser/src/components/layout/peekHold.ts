import { menuShown, watchMenus } from "@ardia/shell";
import { useBrowser } from "../../store/browser";
import { pointerOnCard } from "../sidebar/hover";
import { sidebarUi, useSidebarUi } from "../sidebar/state";

export function peekHeld(windowId: string): boolean {
  if (menuShown()) return true;
  const ui = sidebarUi();
  if (ui.renaming?.windowId === windowId || ui.iconPicker?.windowId === windowId) return true;
  if (ui.hover?.windowId === windowId && pointerOnCard()) return true;
  return !!useBrowser.getState().windowUi[windowId]?.downloadsOpen;
}

export function watchPeekHolds(changed: () => void): () => void {
  const stops = [watchMenus(changed), useSidebarUi.subscribe(changed), useBrowser.subscribe(changed)];
  return () => stops.forEach((stop) => stop());
}

import { useBrowser, type BrowserState } from "../browser/store";
import { shownPageId } from "./peek";

export const usePeeks = <T>(select: (peeks: BrowserState["peeks"]) => T): T => useBrowser((s) => select(s.peeks));

export const useShownPageId = (windowId: string) => useBrowser((s) => shownPageId(s, windowId));

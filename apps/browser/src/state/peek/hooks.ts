import { useBrowser, type BrowserState } from "../browser/store";

export const usePeeks = <T>(select: (peeks: BrowserState["peeks"]) => T): T => useBrowser((s) => select(s.peeks));

import { useBrowser } from "../browser/store";
import { engineMark } from "./engines";

export const useEngineMark = (tabId: string) => useBrowser((s) => engineMark(s, tabId));

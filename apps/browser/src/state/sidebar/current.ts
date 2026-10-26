import { useBrowser } from "../browser/store";
import { cleanUpCandidates } from "../pins/organize";
import { addressBarInSidebar } from "../windows/layout";

const store = () => useBrowser.getState();

export const isAddressBarInSidebar = (windowId: string) => addressBarInSidebar(store(), windowId);

export const cleanUpCandidateCount = (windowId: string) => cleanUpCandidates(store(), windowId).length;

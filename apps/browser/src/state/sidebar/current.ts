import { useBrowser } from "../browser/store";
import { addressBarInSidebar } from "../windows/layout";

const store = () => useBrowser.getState();

export const isAddressBarInSidebar = (windowId: string) => addressBarInSidebar(store(), windowId);

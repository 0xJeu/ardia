import { storeAction } from "../browser/store";

export const toggleSidebar = storeAction("toggleSidebar");
export const restoreClosed = storeAction("restoreClosed");
export const openPanel = storeAction("openPanel");
export const closePanel = storeAction("closePanel");
export const setDownloadsOpen = storeAction("setDownloadsOpen");
export const setFind = storeAction("setFind");
export const removeDownload = storeAction("removeDownload");
export const clearDownloads = storeAction("clearDownloads");

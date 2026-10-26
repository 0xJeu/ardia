import { storeAction } from "../browser/store";

export const updateSettings = storeAction("updateSettings");
export const setSearchEngine = storeAction("setSearchEngine");
export const addCustomEngine = storeAction("addCustomEngine");
export const updateCustomEngine = storeAction("updateCustomEngine");
export const removeCustomEngine = storeAction("removeCustomEngine");

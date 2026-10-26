import { useBrowser } from "./store";

export const currentSettings = () => useBrowser.getState().settings;
export const currentTab = (tabId: string) => useBrowser.getState().tabs[tabId];
export const currentWindow = (windowId: string) => useBrowser.getState().windows[windowId];
export const currentProfile = (profileId: string) => useBrowser.getState().profiles[profileId];
export const currentGroup = (groupId: string) => useBrowser.getState().groups[groupId];
export const focusedWindowId = () => useBrowser.getState().ui.focusedWindowId;

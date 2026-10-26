import { showAutofillSuggestions, type CardNetwork } from "@ardia/ardiacore";
import { useBrowser } from "../browser/store";
import { activeTabId } from "../browser/model";
import { isTabReady } from "../tabs/pageState";
import { openSettings } from "../settings/settingsWindows";

export type { CardNetwork };

export async function requestAutofill(windowId: string, arg: string | null, tabId = activeTabId(useBrowser.getState(), windowId)) {
  const passwords = arg === "passwords";
  if (isTabReady(tabId) && (await showAutofillSuggestions(tabId, passwords ? "passwords" : "field"))) return;
  const s = useBrowser.getState();
  const w = s.windows[windowId];
  const profileId = w && !w.incognito && s.profiles[w.profileId] ? w.profileId : null;
  openSettings(passwords ? "passwords" : "autofill", profileId);
}

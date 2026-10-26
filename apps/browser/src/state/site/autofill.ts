import { showAutofillSuggestions, type CardNetwork } from "@ardia/ardiacore";
import { useBrowser } from "../browser/store";
import { activeTabId } from "../browser/model";
import { browserIdOf } from "../extensions/actions";
import { openSettings } from "../settings/settingsWindows";

export type { CardNetwork };

export async function requestAutofill(windowId: string, arg: string | null, tabId = activeTabId(useBrowser.getState(), windowId)) {
  const passwords = arg === "passwords";
  const browserId = browserIdOf(tabId);
  if (browserId && (await showAutofillSuggestions(browserId, passwords ? "passwords" : "field"))) return;
  const s = useBrowser.getState();
  const w = s.windows[windowId];
  const profileId = w && !w.incognito && s.profiles[w.profileId] ? w.profileId : null;
  openSettings(passwords ? "passwords" : "autofill", profileId);
}

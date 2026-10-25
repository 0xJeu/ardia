import { claimLaunchTab, prepareTabTransfer, releaseTabTransfer } from "@ardia/ardiacore";
import { isInternalTab } from "../components/pages/urls";
import { useBrowser } from "../store/browser";
import { changedIds } from "../store/changes";
import { earlyLaunchTabOn, launchTab } from "../store/launchTab";
import { engineProfile } from "../store/model";
import { tabEngine } from "../store/engines";
import type { Tab } from "../store/types";
import { webviews } from "./webviews";

export const wantsPage = (t: Tab | undefined): t is Tab => !!t && !!(t.navigation || t.adoptId) && !isInternalTab(t);

const handedOff = new Map<string, string>();

const handedOffSeqs = new Map<string, number | undefined>();

export const isHandedOff = (tabId: string) => handedOff.has(tabId);

export const arrivesHandedOff = (tabId: string, seq: number | undefined) => handedOff.has(tabId) && handedOffSeqs.get(tabId) === seq;

export function handOff(tabId: string, profile: string, seq: number | undefined) {
  handedOff.set(tabId, profile);
  handedOffSeqs.set(tabId, seq);
  prepareTabTransfer(tabId);
}

export function startTabPages() {
  claimLaunch();
  useBrowser.subscribe((s, prev) => {
    if (s.tabs === prev.tabs) return;
    for (const id of changedIds(s.tabs, prev.tabs)) {
      const tab = s.tabs[id];
      const before = prev.tabs[id];
      const profile = tab && engineProfile(tab.profileId);
      if (tab && before && tab.windowId !== before.windowId && webviews.has(id) && profile === engineProfile(before.profileId)) handOff(id, profile!, tab.navigation?.seq);
      const kept = handedOff.get(id);
      if (kept !== undefined && !(wantsPage(tab) && profile === kept)) {
        handedOff.delete(id);
        handedOffSeqs.delete(id);
        releaseTabTransfer(id);
      }
    }
  });
}

function claimLaunch() {
  const s = useBrowser.getState();
  const launch = earlyLaunchTabOn() ? launchTab(s, s.ui.focusedWindowId) : null;
  const tab = launch ? s.tabs[launch.id] : undefined;
  const kept = launch && wantsPage(tab) && tab.navigation?.url === launch.url && tabEngine(s, launch.id) === "chromium" ? launch : null;
  if (kept) {
    handedOff.set(kept.id, kept.profile);
    handedOffSeqs.set(kept.id, tab?.navigation?.seq);
  }
  claimLaunchTab(kept?.id ?? "", kept?.url ?? "", kept?.profile ?? "");
}

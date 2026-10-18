import type { WebViewHandle } from "@ardia/ardiacore";
import { killSwitchEnvironment } from "@ardia/shell";
import { webviews } from "./webviews";

type Navigation = { url: string; seq: number; userInitiated?: boolean };

const started = new Map<string, { seq: number; view: WebViewHandle }>();
let enabled: boolean | undefined;

const earlyNavigateOn = () => (enabled ??= killSwitchEnvironment("ARDIA_EARLY_NAVIGATE") !== "off");

export function startNavigation(tabId: string, navigation: Navigation) {
  const view = webviews.get(tabId);
  if (!view || !earlyNavigateOn()) return;
  started.set(tabId, { seq: navigation.seq, view });
  void view.loadUrl(navigation.url, { userInitiated: !!navigation.userInitiated });
}

export function takeStartedNavigation(tabId: string, seq: number | undefined) {
  const start = started.get(tabId);
  if (!start || seq === undefined || start.seq !== seq) return false;
  started.delete(tabId);
  return start.view === webviews.get(tabId);
}

export const setEarlyNavigateForTests = (on: boolean) => void (enabled = on);

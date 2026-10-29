import { appUrlRoute } from "@ardia/core";
import type { SettingsPane } from "../settings/settingsWindows";

const PANES: Record<string, SettingsPane> = {
  general: "general",
  profiles: "profiles",
  people: "profiles",
  manageprofile: "profiles",
  sync: "sync",
  syncsetup: "sync",
  tabs: "tabs",
  appearance: "appearance",
  privacy: "privacy",
  passwords: "passwords",
  autofill: "autofill",
  addresses: "autofill",
  payments: "autofill",
  extensions: "extensions",
  search: "search",
  searchengines: "search",
  engines: "engines",
  shortcuts: "shortcuts",
  livefolders: "liveFolders",
  calendar: "calendar",
  advanced: "advanced",
};

export type AppUrlAction = { kind: "newTab" } | { kind: "settings"; pane: SettingsPane | undefined };

export function appUrlAction(url: string): AppUrlAction | null {
  const route = appUrlRoute(url);
  if (route?.kind === "newTab") return { kind: "newTab" };
  if (route?.kind !== "settings") return null;
  if (route.section === null) return { kind: "settings", pane: undefined };
  const pane = PANES[route.section.toLowerCase()];
  return pane ? { kind: "settings", pane } : null;
}

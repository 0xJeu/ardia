import { prepare, type Searchable } from "./searchMatch";
import type { SettingsPane } from "../../state/settings/settingsWindows";
import type { Settings } from "../../state/settings/settings";
import { generalRows } from "./rows/generalRows";
import { privacyRows } from "./rows/privacyRows";
import { toolRows } from "./rows/toolRows";
import type { SettingSection, SettingsEnv } from "./rows/types";

export const PANES: { id: SettingsPane; title: string; icon: string }[] = [
  { id: "general", title: "General", icon: "gearshape" },
  { id: "profiles", title: "Profiles", icon: "person.2" },
  { id: "sync", title: "Sync", icon: "arrow.triangle.2.circlepath" },
  { id: "tabs", title: "Tabs", icon: "square.on.square" },
  { id: "appearance", title: "Appearance", icon: "circle.lefthalf.filled" },
  { id: "privacy", title: "Privacy & Security", icon: "hand.raised" },
  { id: "passwords", title: "Passwords", icon: "key" },
  { id: "autofill", title: "Autofill", icon: "creditcard" },
  { id: "extensions", title: "Extensions", icon: "puzzlepiece.extension" },
  { id: "search", title: "Search Engine", icon: "magnifyingglass" },
  { id: "engines", title: "Engines", icon: "safari" },
  { id: "shortcuts", title: "Keyboard Shortcuts", icon: "keyboard" },
  { id: "liveFolders", title: "Live Folders", icon: "dot.radiowaves.left.and.right" },
  { id: "calendar", title: "Calendar", icon: "calendar" },
  { id: "advanced", title: "Advanced", icon: "slider.horizontal.3" },
];

const ROWS = { ...generalRows, ...privacyRows, ...toolRows };

type RowKeysOf<P extends SettingsPane> = (typeof ROWS)[P][number] extends infer S ? (S extends { rows: infer R } ? keyof R & string : never) : never;
export type SettingId = { [P in SettingsPane]: `${P}.${RowKeysOf<P>}` }[SettingsPane];

export type SettingEntry = Searchable & { id: SettingId; pane: SettingsPane; section: string; advanced: boolean; shown?: (settings: Settings, env: SettingsEnv) => boolean };

const paneTitle = (pane: SettingsPane) => PANES.find((p) => p.id === pane)!.title;

export const SETTINGS: SettingEntry[] = PANES.flatMap(({ id: pane }) =>
  (ROWS[pane] as SettingSection[]).flatMap(({ section, rows }) =>
    Object.entries(rows).map(([key, row]) => ({ ...row, id: `${pane}.${key}` as SettingId, pane, paneTitle: paneTitle(pane), section, advanced: !!row.advanced })),
  ),
);

const byId = new Map(SETTINGS.map((s) => [s.id, s]));

export const findSetting = (id: string): SettingEntry | undefined => byId.get(id as SettingId);

export function setting(id: SettingId): SettingEntry {
  const entry = byId.get(id);
  if (!entry) throw new Error(`no setting ${id}`);
  return entry;
}

export const SETTINGS_INDEX = prepare(SETTINGS);

export const unshownSettings = (settings: Settings, env: SettingsEnv) =>
  SETTINGS.filter((e) => e.shown && !e.shown(settings, env))
    .map((e) => e.id)
    .join("\n");

export const sectionEntries = (pane: SettingsPane, section: string) => SETTINGS.filter((s) => s.pane === pane && s.section === section);

export const ADVANCED_PANES = new Set(PANES.map((p) => p.id).filter((pane) => SETTINGS.some((s) => s.pane === pane) && SETTINGS.every((s) => s.pane !== pane || s.advanced)));

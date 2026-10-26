import { useBrowser } from "../browser/store";
import type { Tab } from "../browser/types";
import { groupLabel } from "../pins/organize";
import { splitOf, splitRowPanes } from "../splits/splits";
import { tabTitle } from "./actions";

export const useIsInSplit = (tabId: string) => useBrowser((s) => !!splitOf(s, tabId));

export const useDragGhostLabel = (folderName: string | undefined, groupId: string | undefined, tab: Tab | undefined) =>
  useBrowser((s) => folderName ?? (groupId && s.groups[groupId] ? groupLabel(s, s.groups[groupId]!) : tab ? tabTitle(tab) : ""));

export const useSplitRowKey = (splitId: string) => useBrowser((s) => splitRowPanes(s, s.splits[splitId]).join(","));

export const useIconPickerCurrent = (kind: "tab" | "group" | "live" | "folder", id: string, liveIcon: string | null | undefined) =>
  useBrowser((s) => (kind === "tab" ? s.tabs[id]?.customIcon : kind === "live" ? liveIcon : s.groups[id]?.icon) ?? null);

import { useShallow } from "zustand/react/shallow";
import { useBrowser, type BrowserState } from "../browser/store";
import { activeTabId } from "../browser/model";
import type { Tab } from "../browser/types";
import { cleanedTabsFor, groupLabel } from "../pins/organize";
import { canTidyPins } from "../pins/tidyPins";
import { folderIn } from "../pins/tileFolders";
import { useStoreWhile } from "../tabs/tabWatch";
import { splitOf, splitRowPanes } from "../splits/splits";
import { downloadsIn } from "../windows/ui";
import { tabTitle } from "./actions";
import { groupEntries, keptEntry, sidebarEntries } from "./entries";
import { groupTabIds } from "./groupPanelRows";
import { capture, type Capture } from "./listCapture";
import type { Hover } from "./sidebarUi";

export const useIsInSplit = (tabId: string) => useBrowser((s) => !!splitOf(s, tabId));

export const useDragGhostLabel = (folderName: string | undefined, groupId: string | undefined, tab: Tab | undefined) =>
  useBrowser((s) => folderName ?? (groupId && s.groups[groupId] ? groupLabel(s, s.groups[groupId]!) : tab ? tabTitle(tab) : ""));

export const useSplitRowKey = (splitId: string) => useBrowser((s) => splitRowPanes(s, s.splits[splitId]).join(","));

export const useIconPickerCurrent = (kind: "tab" | "group" | "live" | "folder", id: string, liveIcon: string | null | undefined) =>
  useBrowser((s) => (kind === "tab" ? s.tabs[id]?.customIcon : kind === "live" ? liveIcon : s.groups[id]?.icon) ?? null);

export const useCapturedGroupEntries = (groupId: string, captured: Capture) =>
  useBrowser(
    useShallow((s) => {
      const list = groupEntries(s, groupId);
      return capture(captured, s, list, list);
    }),
  );

export const useCapturedSidebarEntries = (windowId: string, profileId: string, captured: Capture) =>
  useBrowser((s) => {
    const entries = sidebarEntries(s, windowId, profileId);
    return capture(captured, s, entries.list, entries);
  });

export const useKeptEntry = (windowId: string, profileId: string, entries: string[]) => useBrowser((s) => keptEntry(s, windowId, profileId, entries));

export const useGroupFirstTabIcon = (groupId: string) =>
  useBrowser(
    useShallow((s) => {
      const t = s.tabs[s.groups[groupId]?.tabIds[0] ?? ""];
      return t && { url: t.url, favicon: t.favicon, customIcon: t.customIcon, profileId: t.profileId };
    }),
  );

export const useHasDownloads = (windowId: string) => useBrowser((s) => downloadsIn(s, windowId).length > 0);

export const useNoTiles = (windowId: string, profileId: string) => useBrowser((s) => sidebarEntries(s, windowId, profileId).tiles.length === 0);

const NO_CELLS: string[] = [];

export const useSidebarCells = (windowId: string, profileId: string, offScreen: boolean) =>
  useBrowser((s) => (offScreen ? NO_CELLS : sidebarEntries(s, windowId, profileId).cells));

export const useCanTidyPins = (windowId: string, profileId: string, offScreen: boolean) => useBrowser((s) => !offScreen && canTidyPins(s, windowId, profileId));

export const useCleanedCount = (windowId: string) => useBrowser((s) => cleanedTabsFor(s, windowId).length);

export const useShownTabId = (windowId: string) => useBrowser((s) => activeTabId(s, windowId));

export const useIsShownTab = (windowId: string, tabId: string) => useBrowser((s) => activeTabId(s, windowId) === tabId);

export const useHoverOrphaned = (windowId: string, hover: Hover | null) =>
  useStoreWhile(
    useBrowser,
    !!hover,
    (s) => (hover?.kind === "tab" && !s.tabs[hover.id]) || (hover?.kind === "group" && !s.groups[hover.id]) || (hover?.kind === "folder" && !folderIn(s, windowId, hover.id)),
  );

export const useGroupPanelTabIds = (groupId: string) => useBrowser(useShallow((s) => groupTabIds(s.groups, groupId)));

export const useTabsById = (ids: string[]) => useBrowser(useShallow((s) => ids.map((id) => s.tabs[id])));

export const useLayoutFromWorkspace = <T>(measure: (s: BrowserState) => T): T => useBrowser(measure);

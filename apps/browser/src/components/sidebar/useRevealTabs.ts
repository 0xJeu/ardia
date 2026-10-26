import { useEffect, type RefObject } from "react";
import type { ScrollView, View } from "react-native";
import { live } from "../../state/live/store";
import { workspaceSnapshot } from "../../state/browser/current";
import { watchRevealTargets } from "../../state/sidebar/reveal";
import { ancestorIds } from "../../state/groups/groups";
import { groupOf } from "../../state/pins/organize";
import { splitOf } from "../../state/splits/splits";
import { measureRow } from "../../state/sidebar/sidebarUi";
import { rowSpan } from "./geometry";
import type { SidebarGeometry } from "./pageLayout";

export function useRevealTabs(windowId: string, scroll: RefObject<ScrollView | null>, scrollY: RefObject<number>, geometry: RefObject<SidebarGeometry>) {
  useEffect(() => {
    let switched: string | null = null;
    let opened: string | null = null;
    let frame = 0;
    let reveals = 0;
    const show = (y: number, height: number) => {
      const top = scrollY.current ?? 0;
      const { viewport, room, pad } = geometry.current;
      if (y - top < room) scroll.current?.scrollTo({ y: Math.max(0, y - pad), animated: true });
      else if (y + height - top > viewport - 8) scroll.current?.scrollTo({ y: y + height - viewport + 8, animated: true });
    };
    const reveal = () => {
      frame = 0;
      if (!geometry.current.viewport || !scroll.current) return;
      const mine = ++reveals;
      const tabId = switched ?? opened;
      switched = opened = null;
      const s = workspaceSnapshot();
      const profileId = s.windows[windowId]?.profileId;
      if (!tabId || !profileId) return;
      const pinned = s.tabs[tabId];
      if (geometry.current.tilesFixed && pinned?.pinned && !pinned.pinnedAsRow) return;
      const { regions, newTabAtTop } = geometry.current;
      const span = rowSpan(s, windowId, profileId, tabId, newTabAtTop);
      const pinnedHasLive = span?.section === "pinnedGroups" && live().folderOrder.some((id) => live().folders[id]?.profileId === profileId);
      if (span && !pinnedHasLive) return show(geometry.current.pad + regions[span.section] + span.top, span.height);
      const view = scroll.current as unknown as View;
      const split = splitOf(s, tabId);
      const inner = groupOf(s, tabId);
      const keys = [tabId, ...(split ? [`s:${split.id}`] : []), ...(inner ? [inner.id, ...ancestorIds(s.groups, inner.id)] : [])];
      const firstShown = (i: number): Promise<Awaited<ReturnType<typeof measureRow>>> =>
        i >= keys.length ? Promise.resolve(null) : measureRow(windowId, keys[i]!).then((row) => row ?? firstShown(i + 1));
      void firstShown(0).then((row) =>
        view.measureInWindow((_x, y) => row && mine === reveals && show(row.y - y + (scrollY.current ?? 0), row.height)),
      );
    };
    const schedule = () => {
      if ((switched || opened) && !frame) frame = requestAnimationFrame(reveal);
    };
    const unsubscribe = watchRevealTargets(windowId, (nowSwitched, nowOpened) => {
      if (nowSwitched) switched = nowSwitched;
      if (nowOpened) opened = nowOpened;
      schedule();
    });
    geometry.current.laidOut = schedule;
    return () => {
      cancelAnimationFrame(frame);
      unsubscribe();
      geometry.current.laidOut = undefined;
    };
  }, [windowId]);
}

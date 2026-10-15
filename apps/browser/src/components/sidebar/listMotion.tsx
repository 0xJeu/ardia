import { createContext, memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, View } from "react-native";
import { layout } from "../../lib/theme";
import { useBrowser, type BrowserState } from "../../store/browser";
import type { EntryMotion } from "./entryMotion";
import { groupEntries, sidebarEntries } from "./entries";
import { entryHeight } from "./geometry";
import { GhostEntry, snapshotEntry, type EntrySnapshot } from "./GhostEntry";

export const SLIDE_MS = 140;
export const FADE_MS = 100;
export const SLIDE_EASING = Easing.bezier(0.25, 0.1, 0.25, 1);
export const FADE_EASING = Easing.bezier(0, 0, 0.58, 1);
const ROW = layout.rowHeight;
const GAP = layout.rowGap;
const TAIL = "~tail";
const NONE: string[] = [];
const devScale = () => (__DEV__ ? ((globalThis as { sidebarMotionScale?: number }).sidebarMotionScale ?? 1) : 1);

export const ListMotionEnabled = createContext(false);

type Slide = { value: Animated.Value; from: number; at: number };
type Ghost = { id: number; anchor: string | null; y: number; snapshot: EntrySnapshot; opacity: Animated.Value };
type Snapshot = { state: BrowserState; list: string[] };
type Move = { key: string; from: number };
type Plan = { moves: Move[]; ghosts: Ghost[]; raised: string[]; clipped: string[] };
type Offsets = { at: Map<string, number>; end: number };
type Height = (s: BrowserState, entry: string) => number;
type Watched = { list: string[]; marks: unknown[] };
type Planner = (before: Snapshot, after: Snapshot, slides: Map<string, Slide>, ghosts: Ghost[], t: number) => Plan | null;
export type ListSlot = { entry: string } | { ghost: Ghost; top: number };

let ghostIds = 0;
const keepInStep = () => {};

const tabsOf = (s: BrowserState, entry: string): string[] => {
  const id = entry.slice(2);
  if (entry.startsWith("g:")) return s.groups[id]?.tabIds ?? [];
  if (entry.startsWith("s:")) return s.splits[id]?.tabIds ?? [];
  return [id];
};

const closedIn = (before: BrowserState, after: BrowserState) => (entry: string) => {
  const ids = tabsOf(before, entry);
  return ids.length > 0 && ids.every((id) => !after.tabs[id]);
};

const openedIn = (before: BrowserState, after: BrowserState) => (entry: string) => {
  const ids = tabsOf(after, entry);
  return ids.length > 0 && ids.every((id) => !before.tabs[id]);
};

function offsets(s: BrowserState, entries: string[], height: Height): Offsets {
  const at = new Map<string, number>();
  let y = 0;
  for (const e of entries) {
    at.set(e, y);
    y += height(s, e) + GAP;
  }
  return { at, end: y };
}

function shiftAt(slide: Slide | undefined, t: number): number {
  if (!slide) return 0;
  const p = Math.min(1, Math.max(0, (t - slide.at) / (SLIDE_MS * devScale())));
  return slide.from * (1 - SLIDE_EASING(p));
}

type Diff = {
  before: Snapshot;
  after: Snapshot;
  old: Offsets;
  next: Offsets;
  removed: string[];
  added: string[];
  slides: Map<string, Slide>;
  ghosts: Ghost[];
  t: number;
  tail: boolean;
  snapshot: (entry: string) => EntrySnapshot | null;
  clipAfter: string[];
};

function buildPlan({ before, after, old, next, removed, added, slides, ghosts, t, tail, snapshot, clipAfter }: Diff): Plan | null {
  const kept = new Set(after.list);
  const had = new Set(before.list);
  const moves: Move[] = [];
  for (const e of after.list) {
    if (!had.has(e)) continue;
    const delta = old.at.get(e)! - next.at.get(e)!;
    if (delta) moves.push({ key: e, from: shiftAt(slides.get(e), t) + delta });
  }
  if (tail && old.end !== next.end) moves.push({ key: TAIL, from: shiftAt(slides.get(TAIL), t) + old.end - next.end });
  const anchorAfter = (entry: string): string | null => {
    for (let i = before.list.indexOf(entry) + 1; i < before.list.length; i++) if (kept.has(before.list[i]!)) return before.list[i]!;
    return null;
  };
  const gone = new Set(removed);
  for (const g of ghosts) if (g.anchor && gone.has(g.anchor)) g.anchor = anchorAfter(g.anchor);
  const born = removed.flatMap((e): Ghost[] => {
    const shot = snapshot(e);
    if (!shot) return [];
    const y = old.at.get(e)! + shiftAt(slides.get(e), t);
    return [{ id: ++ghostIds, anchor: anchorAfter(e), y, snapshot: shot, opacity: new Animated.Value(1) }];
  });
  if (!moves.length) return born.length ? { moves, ghosts: born, raised: [], clipped: [] } : null;
  const fresh = new Set(added);
  const clipped = [...added, ...clipAfter].flatMap((e) => {
    const following = after.list[after.list.indexOf(e) + 1];
    return following === undefined ? (tail ? [TAIL] : []) : fresh.has(following) ? [] : [following];
  });
  return { moves, ghosts: born, raised: added, clipped };
}

type GroupChange = "same" | "grown" | "extended" | "other";

function groupChange(before: BrowserState, after: BrowserState, groupId: string): GroupChange {
  const was = before.groups[groupId];
  const now = after.groups[groupId];
  if (!was || !now) return "other";
  const had = new Set(was.tabIds);
  const has = new Set(now.tabIds);
  const gone = was.tabIds.filter((id) => !has.has(id));
  const came = now.tabIds.filter((id) => !had.has(id));
  if (!gone.length && !came.length) return "same";
  const expanded = !was.collapsed && !now.collapsed;
  if (expanded && !came.length && gone.every((id) => !after.tabs[id])) return "extended";
  if (!expanded || gone.length || !came.every((id) => !before.tabs[id])) return "other";
  return groupGrowsAtEnd(before, after, groupId) ? "grown" : "extended";
}

function groupGrowsAtEnd(before: BrowserState, after: BrowserState, groupId: string): boolean {
  const last = groupEntries(after, groupId).at(-1);
  return !!last && !groupEntries(before, groupId).includes(last);
}

function useMotion(devKey: string, entries: string[], watch: (s: BrowserState) => Watched, planner: Planner, place: (list: string[]) => Offsets, enabled: boolean, native: boolean) {
  const slides = useRef(new Map<string, Slide>()).current;
  const contexts = useRef(new Map<string, EntryMotion>()).current;
  const raised = useRef(new Set<string>()).current;
  const clipped = useRef(new Set<string>()).current;
  const ghosts = useRef<Ghost[]>([]);
  const pending = useRef<Snapshot | null>(null);
  const seen = useRef(entries);
  const queued = useRef<Plan | null>(null);
  const running = useRef(new Set<object>()).current;
  const [, rerender] = useState(0);
  const latest = useRef(watch);
  latest.current = watch;
  if (__DEV__ && enabled) {
    const dev = globalThis as { sidebarMotion?: Record<string, unknown> };
    dev.sidebarMotion = { ...dev.sidebarMotion, [devKey]: { slides, ghosts, raised, clipped } };
  }

  useEffect(() => {
    let last = latest.current(useBrowser.getState());
    const unsubscribe = useBrowser.subscribe((s, prev) => {
      if (s.tabs === prev.tabs && s.windows === prev.windows && s.groups === prev.groups && s.splits === prev.splits) return;
      const next = latest.current(s);
      if (next.list === last.list && next.marks.length === last.marks.length && next.marks.every((m, i) => m === last.marks[i])) return;
      if (!pending.current) pending.current = { state: prev, list: last.list };
      last = next;
      rerender((n) => n + 1);
    });
    return () => {
      unsubscribe();
      pending.current = null;
    };
  }, [devKey]);

  const before = pending.current;
  if (before) {
    pending.current = null;
    const plan = enabled ? planner(before, { state: useBrowser.getState(), list: entries }, slides, ghosts.current, Date.now()) : null;
    if (plan) {
      for (const m of plan.moves) if (!slides.has(m.key)) slides.set(m.key, { value: new Animated.Value(m.from), from: m.from, at: Date.now() });
      ghosts.current = [...ghosts.current, ...plan.ghosts];
      queued.current = plan;
    }
  }
  if (entries !== seen.current) {
    seen.current = entries;
    const live = new Set(entries);
    for (const key of slides.keys()) if (key !== TAIL && !live.has(key)) slides.delete(key);
    for (const key of contexts.keys()) if (!live.has(key)) contexts.delete(key);
    for (const key of raised) if (!live.has(key)) raised.delete(key);
    for (const key of clipped) if (key !== TAIL && !live.has(key)) clipped.delete(key);
  }

  useLayoutEffect(() => {
    const plan = queued.current;
    if (!plan) return;
    queued.current = null;
    const at = Date.now();
    for (const m of plan.moves) {
      const slide = slides.get(m.key);
      if (!slide) continue;
      slide.value.setValue(m.from);
      slide.from = m.from;
      slide.at = at;
      const token = {};
      running.add(token);
      const tracking = native ? slide.value.addListener(keepInStep) : null;
      Animated.timing(slide.value, { toValue: 0, duration: SLIDE_MS * devScale(), easing: SLIDE_EASING, useNativeDriver: native }).start(({ finished }) => {
        running.delete(token);
        if (tracking) slide.value.removeListener(tracking);
        if (finished) slide.value.setValue(0);
        if (running.size || (!raised.size && !clipped.size)) return;
        raised.clear();
        clipped.clear();
        rerender((n) => n + 1);
      });
    }
    for (const g of plan.ghosts) {
      Animated.timing(g.opacity, { toValue: 0, duration: FADE_MS * devScale(), easing: FADE_EASING, useNativeDriver: true }).start(() => {
        ghosts.current = ghosts.current.filter((x) => x !== g);
        rerender((n) => n + 1);
      });
    }
    const layered = raised.size > 0 || clipped.size > 0;
    raised.clear();
    clipped.clear();
    for (const key of plan.raised) raised.add(key);
    for (const key of plan.clipped) clipped.add(key);
    if (layered || raised.size || clipped.size) rerender((n) => n + 1);
  });

  const motion = (entry: string): EntryMotion | null => {
    const shift = slides.get(entry)?.value ?? null;
    const up = raised.has(entry);
    const clip = clipped.has(entry);
    if (!shift && !up && !clip) return null;
    const known = contexts.get(entry);
    if (known && known.shift === shift && known.raised === up && known.clipped === clip) return known;
    const next = { shift, raised: up, clipped: clip };
    contexts.set(entry, next);
    return next;
  };

  const slots = (list: string[]): ListSlot[] => {
    if (!ghosts.current.length) return list.map((entry) => ({ entry }));
    const { at, end } = place(entries);
    const mounted = new Set(list);
    const out: ListSlot[] = [];
    const byAnchor = new Map<string | null, Ghost[]>();
    for (const g of ghosts.current) {
      const anchor = g.anchor && at.has(g.anchor) ? g.anchor : null;
      if (anchor && !mounted.has(anchor)) continue;
      byAnchor.set(anchor, [...(byAnchor.get(anchor) ?? []), g]);
    }
    for (const entry of list) {
      for (const ghost of byAnchor.get(entry) ?? []) out.push({ ghost, top: ghost.y - at.get(entry)! });
      out.push({ entry });
    }
    for (const ghost of byAnchor.get(null) ?? []) out.push({ ghost, top: ghost.y - end });
    return out;
  };

  return { motion, slots, tail: slides.get(TAIL)?.value ?? null, tailClipped: clipped.has(TAIL) };
}

export function useListMotion(windowId: string, profileId: string, entries: string[], enabled: boolean) {
  const height: Height = (s, e) => entryHeight(s, windowId, profileId, e);
  const watch = (s: BrowserState): Watched => {
    const list = sidebarEntries(s, windowId, profileId).list;
    return { list, marks: list.flatMap((e) => (e.startsWith("g:") ? [groupEntries(s, e.slice(2))] : [])) };
  };
  const planner: Planner = (before, after, slides, ghosts, t) => {
    const had = new Set(before.list);
    const kept = new Set(after.list);
    const removed = before.list.filter((e) => !kept.has(e));
    const added = after.list.filter((e) => !had.has(e));
    if (!removed.every(closedIn(before.state, after.state)) || !added.every(openedIn(before.state, after.state))) return null;
    const changes = new Map<string, GroupChange>();
    for (const e of after.list) {
      if (!had.has(e) || !e.startsWith("g:")) continue;
      const change = groupChange(before.state, after.state, e.slice(2));
      if (change === "other" && height(before.state, e) !== height(after.state, e)) return null;
      if (change === "grown" || change === "extended") changes.set(e, change);
    }
    const grown = [...changes].flatMap(([e, c]) => (c === "grown" ? [e] : []));
    if (!removed.length && !added.length && !grown.length) return null;
    const old = offsets(before.state, before.list, height);
    const next = offsets(after.state, after.list, (s, e) => (changes.get(e) === "extended" ? height(before.state, e) : height(s, e)));
    const snapshot = (e: string) => snapshotEntry(before.state, windowId, profileId, e);
    return buildPlan({ before, after, old, next, removed, added, slides, ghosts, t, tail: true, snapshot, clipAfter: grown });
  };
  return useMotion(windowId, entries, watch, planner, (list) => offsets(useBrowser.getState(), list, height), enabled, true);
}

const rowHeight: Height = () => ROW;

export function useGroupMotion(windowId: string, profileId: string, groupId: string, entries: string[], enabled: boolean) {
  const watch = (s: BrowserState): Watched => ({ list: s.groups[groupId] ? groupEntries(s, groupId) : NONE, marks: [] });
  const planner: Planner = (before, after, slides, ghosts, t) => {
    const was = before.state.groups[groupId];
    const now = after.state.groups[groupId];
    if (!was || !now || was.collapsed || now.collapsed) return null;
    const had = new Set(before.list);
    const kept = new Set(after.list);
    const removed = before.list.filter((e) => !kept.has(e));
    const added = after.list.filter((e) => !had.has(e));
    if (!removed.length === !added.length) return null;
    if (!removed.every(closedIn(before.state, after.state)) || !added.every(openedIn(before.state, after.state))) return null;
    const old = offsets(before.state, before.list, rowHeight);
    const next = offsets(after.state, after.list, rowHeight);
    const snapshot = (e: string) => snapshotEntry(before.state, windowId, profileId, e);
    const extended = removed.length > 0 || !groupGrowsAtEnd(before.state, after.state, groupId);
    return buildPlan({ before, after, old, next, removed, added, slides, ghosts, t, tail: extended, snapshot, clipAfter: [] });
  };
  return useMotion(`${windowId}:${groupId}`, entries, watch, planner, (list) => offsets(useBrowser.getState(), list, rowHeight), enabled, false);
}

export const GhostSlot = memo(function GhostSlot({ ghost, top }: { ghost: Ghost; top: number }) {
  return (
    <View pointerEvents="none" style={{ height: 0, marginBottom: -GAP }}>
      <Animated.View style={{ position: "absolute", left: 0, right: 0, top, opacity: ghost.opacity }}>
        <GhostEntry snapshot={ghost.snapshot} />
      </Animated.View>
    </View>
  );
});

export function TailShift({ shift, clipped = false, children }: { shift: Animated.Value | null; clipped?: boolean; children: ReactNode }) {
  const style = useMemo(() => (shift ? { transform: [{ translateY: shift }] } : undefined), [shift]);
  return (
    <View style={clipped ? { marginTop: -GAP, paddingTop: GAP, overflow: "hidden" } : undefined}>
      <Animated.View style={style}>{children}</Animated.View>
    </View>
  );
}

export function BoxExtension({ extra }: { extra: Animated.Value | null }) {
  return <Animated.View style={extra ? { marginTop: extra } : undefined} />;
}

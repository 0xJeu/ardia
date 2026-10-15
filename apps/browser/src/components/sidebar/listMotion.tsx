import { createContext, memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, View } from "react-native";
import { layout, useTheme } from "../../lib/theme";
import { useBrowser, type BrowserState } from "../../store/browser";
import { useAnimatedStyle, type ClipSource, type EntryMotion } from "./entryMotion";
import { groupEntries } from "./entries";
import { entryHeight } from "./geometry";
import { ghostEntry, snapshotEntry, type EntrySnapshot } from "./GhostEntry";

export const SLIDE_MS = 140;
export const FADE_MS = 100;
export const SLIDE_EASING = Easing.bezier(0.25, 0.1, 0.25, 1);
export const FADE_EASING = Easing.bezier(0, 0, 0.58, 1);
const ROW = layout.rowHeight;
const GAP = layout.rowGap;
const TAIL = "~tail";
const devScale = () => (__DEV__ ? ((globalThis as { sidebarMotionScale?: number }).sidebarMotionScale ?? 1) : 1);

type Slide = { value: Animated.Value; from: number; at: number };
type Ghost = { id: number; anchor: string | null; y: number; snapshot: EntrySnapshot; opacity: Animated.Value };
type Snapshot = { state: BrowserState; list: string[] };
type Move = { key: string; from: number };
type Plan = { moves: Move[]; ghosts: Ghost[]; clipped: string[]; below: number };
type Offsets = { at: Map<string, number>; end: number };
type Height = (s: BrowserState, entry: string) => number;
type Planner = (before: Snapshot, after: Snapshot, slides: Map<string, Slide>, ghosts: Ghost[], t: number) => Plan | null;
export type ListSlot = { entry: string } | { ghost: Ghost; top: number };
export type Capture = { state: BrowserState | null; list: string[] | null; pending: Snapshot | null };
export type ListMotionScope = { enabled: boolean; slideBelow: ((entry: string, delta: number) => void) | null };

export const ListMotionContext = createContext<ListMotionScope>({ enabled: false, slideBelow: null });
export const newCapture = (): Capture => ({ state: null, list: null, pending: null });

export function capture<T>(into: Capture, s: BrowserState, list: string[], value: T): T {
  if (into.list && into.state && list !== into.list && !into.pending) into.pending = { state: into.state, list: into.list };
  into.list = list;
  into.state = s;
  return value;
}

let ghostIds = 0;

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
  if (!moves.length) return born.length ? { moves, ghosts: born, clipped: [], below: 0 } : null;
  const fresh = new Set(added);
  const clipped = [...added, ...clipAfter].flatMap((e) => {
    const following = after.list[after.list.indexOf(e) + 1];
    return following === undefined ? (tail ? [TAIL] : []) : fresh.has(following) ? [] : [following];
  });
  return { moves, ghosts: born, clipped, below: 0 };
}

type GroupChange = "same" | "grown" | "extended" | "other";

function groupGrowsAtEnd(before: BrowserState, after: BrowserState, groupId: string): boolean {
  const last = groupEntries(after, groupId).at(-1);
  return !!last && !groupEntries(before, groupId).includes(last);
}

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

type Core = {
  devKey: string;
  entries: string[];
  from: Capture;
  planner: Planner;
  place: (list: string[]) => Offsets;
  enabled: boolean;
  native: boolean;
  below?: ((delta: number) => void) | null;
};

function useMotion({ devKey, entries, from, planner, place, enabled, native, below }: Core) {
  const slides = useRef(new Map<string, Slide>()).current;
  const contexts = useRef(new Map<string, EntryMotion>()).current;
  const clipped = useRef(new Set<string>()).current;
  const watchers = useRef(new Map<string, Set<() => void>>()).current;
  const sources = useRef(new Map<string, ClipSource>()).current;
  const shown = useRef(new Set<string>()).current;
  const source = (key: string): ClipSource => {
    let known = sources.get(key);
    if (!known) {
      known = {
        clipped: () => clipped.has(key),
        subscribe: (changed) => {
          let set = watchers.get(key);
          if (!set) watchers.set(key, (set = new Set()));
          set.add(changed);
          return () => void set.delete(changed);
        },
      };
      sources.set(key, known);
    }
    return known;
  };
  const announce = () => {
    const changed = [...clipped].filter((k) => !shown.has(k)).concat([...shown].filter((k) => !clipped.has(k)));
    shown.clear();
    for (const key of clipped) shown.add(key);
    for (const key of changed) for (const notify of watchers.get(key) ?? []) notify();
  };
  const ghosts = useRef<Ghost[]>([]);
  const seen = useRef(entries);
  const latest = useRef(entries);
  latest.current = entries;
  const queued = useRef<Plan | null>(null);
  const running = useRef(new Set<object>()).current;
  const [, rerender] = useState(0);
  if (__DEV__ && enabled) {
    const dev = globalThis as { sidebarMotion?: Record<string, unknown> };
    dev.sidebarMotion = { ...dev.sidebarMotion, [devKey]: { slides, ghosts, clipped } };
  }

  const prepare = (plan: Plan, at: number) => {
    for (const m of plan.moves) if (!slides.has(m.key)) slides.set(m.key, { value: new Animated.Value(m.from), from: m.from, at });
    ghosts.current = [...ghosts.current, ...plan.ghosts];
    clipped.clear();
    for (const key of plan.clipped) clipped.add(key);
    queued.current = plan;
  };

  const before = from.pending;
  if (before) {
    from.pending = null;
    const plan = enabled ? planner(before, { state: useBrowser.getState(), list: entries }, slides, ghosts.current, Date.now()) : null;
    if (plan) prepare(plan, Date.now());
  }
  if (entries !== seen.current) {
    seen.current = entries;
    const live = new Set(entries);
    for (const key of slides.keys()) if (key !== TAIL && !live.has(key)) slides.delete(key);
    for (const key of contexts.keys()) if (!live.has(key)) contexts.delete(key);
    for (const key of clipped) if (key !== TAIL && !live.has(key)) clipped.delete(key);
  }

  const slideBelow = useRef((entry: string, delta: number) => {
    const list = latest.current;
    const i = list.indexOf(entry);
    if (i < 0) return;
    const t = Date.now();
    const keys = [...list.slice(i + 1), TAIL];
    prepare({ moves: keys.map((key) => ({ key, from: shiftAt(slides.get(key), t) + delta })), ghosts: [], clipped: [list[i + 1] ?? TAIL], below: 0 }, t);
    rerender((n) => n + 1);
  }).current;

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
      Animated.timing(slide.value, { toValue: 0, duration: SLIDE_MS * devScale(), easing: SLIDE_EASING, useNativeDriver: native }).start(({ finished }) => {
        running.delete(token);
        if (finished) slide.value.setValue(0);
        if (running.size || !clipped.size) return;
        clipped.clear();
        announce();
      });
    }
    for (const g of plan.ghosts) {
      Animated.timing(g.opacity, { toValue: 0, duration: FADE_MS * devScale(), easing: FADE_EASING, useNativeDriver: true }).start(() => {
        ghosts.current = ghosts.current.filter((x) => x !== g);
        rerender((n) => n + 1);
      });
    }
    announce();
    if (plan.below) below?.(plan.below);
  });

  const motion = (entry: string): EntryMotion | null => {
    const shift = slides.get(entry)?.value ?? null;
    const known = contexts.get(entry);
    if (!shift && !known && !clipped.has(entry)) return null;
    if (known && known.shift === shift) return known;
    const next = { shift, clip: source(entry) };
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

  return { motion, slots, slideBelow, tail: slides.get(TAIL)?.value ?? null, tailClip: source(TAIL) };
}

export function useListMotion(windowId: string, profileId: string, entries: string[], from: Capture, enabled: boolean) {
  const height: Height = (s, e) => entryHeight(s, windowId, profileId, e);
  const planner: Planner = (before, after, slides, ghosts, t) => {
    const had = new Set(before.list);
    const kept = new Set(after.list);
    const removed = before.list.filter((e) => !kept.has(e));
    const added = after.list.filter((e) => !had.has(e));
    if (!removed.length && !added.length) return null;
    if (!removed.every(closedIn(before.state, after.state)) || !added.every(openedIn(before.state, after.state))) return null;
    const changes = new Map<string, GroupChange>();
    for (const e of after.list) {
      if (!had.has(e) || !e.startsWith("g:")) continue;
      const change = groupChange(before.state, after.state, e.slice(2));
      if (change === "other" && height(before.state, e) !== height(after.state, e)) return null;
      if (change === "grown" || change === "extended") changes.set(e, change);
    }
    const grown = [...changes].flatMap(([e, c]) => (c === "grown" ? [e] : []));
    const old = offsets(before.state, before.list, height);
    const next = offsets(after.state, after.list, (s, e) => (changes.get(e) === "extended" ? height(before.state, e) : height(s, e)));
    const snapshot = (e: string) => snapshotEntry(before.state, windowId, profileId, e);
    return buildPlan({ before, after, old, next, removed, added, slides, ghosts, t, tail: true, snapshot, clipAfter: grown });
  };
  return useMotion({ devKey: windowId, entries, from, planner, place: (list) => offsets(useBrowser.getState(), list, height), enabled, native: true });
}

const rowHeight: Height = () => ROW;

export function useGroupMotion(windowId: string, profileId: string, groupId: string, entries: string[], from: Capture, scope: ListMotionScope, enabled: boolean) {
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
    const atEnd = !removed.length && groupGrowsAtEnd(before.state, after.state, groupId);
    const plan = buildPlan({ before, after, old, next, removed, added, slides, ghosts, t, tail: !atEnd, snapshot, clipAfter: [] });
    if (!atEnd) return plan;
    return { ...(plan ?? { moves: [], ghosts: [], clipped: [] }), below: old.end - next.end };
  };
  const below = scope.slideBelow ? (delta: number) => scope.slideBelow?.(`g:${groupId}`, delta) : null;
  return useMotion({ devKey: `${windowId}:${groupId}`, entries, from, planner, place: (list) => offsets(useBrowser.getState(), list, rowHeight), enabled, native: false, below });
}

export const GhostSlot = memo(function GhostSlot({ ghost, top }: { ghost: Ghost; top: number }) {
  const style = useMemo(() => ({ opacity: ghost.opacity }), [ghost.opacity]);
  const [fade, ref] = useAnimatedStyle(style);
  const theme = useTheme();
  return (
    <View pointerEvents="none" {...fade} ref={ref} style={[{ height: 0, marginBottom: -GAP }, fade.style as object]}>
      {ghostEntry(ghost.snapshot, theme, top)}
    </View>
  );
});


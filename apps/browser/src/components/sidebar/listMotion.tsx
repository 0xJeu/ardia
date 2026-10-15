import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, View } from "react-native";
import { layout } from "../../lib/theme";
import { useBrowser, type BrowserState } from "../../store/browser";
import type { EntryMotion } from "./entryMotion";
import { sidebarEntries } from "./entries";
import { entryHeight } from "./geometry";
import { GhostEntry, snapshotEntry, type EntrySnapshot } from "./GhostEntry";

export const SLIDE_MS = 140;
export const FADE_MS = 100;
export const SLIDE_EASING = Easing.bezier(0.25, 0.1, 0.25, 1);
export const FADE_EASING = Easing.bezier(0, 0, 0.58, 1);
const GAP = layout.rowGap;
const TAIL = "~tail";
const devScale = () => (__DEV__ ? ((globalThis as { sidebarMotionScale?: number }).sidebarMotionScale ?? 1) : 1);

type Slide = { value: Animated.Value; from: number; at: number };
type Ghost = { id: number; anchor: string | null; y: number; snapshot: EntrySnapshot; opacity: Animated.Value };
type Snapshot = { state: BrowserState; list: string[] };
type Move = { key: string; from: number };
type Plan = { moves: Move[]; ghosts: Ghost[]; raised: string[]; clipped: string[] };
export type ListSlot = { entry: string } | { ghost: Ghost; top: number };

let ghostIds = 0;
const keepInStep = () => {};

const tabsOf = (s: BrowserState, entry: string): string[] => {
  const id = entry.slice(2);
  if (entry.startsWith("g:")) return s.groups[id]?.tabIds ?? [];
  if (entry.startsWith("s:")) return s.splits[id]?.tabIds ?? [];
  return [id];
};

function offsets(s: BrowserState, windowId: string, profileId: string, entries: string[]) {
  const at = new Map<string, number>();
  let y = 0;
  for (const e of entries) {
    at.set(e, y);
    y += entryHeight(s, windowId, profileId, e) + GAP;
  }
  return { at, end: y };
}

function shiftAt(slide: Slide | undefined, t: number): number {
  if (!slide) return 0;
  const p = Math.min(1, Math.max(0, (t - slide.at) / (SLIDE_MS * devScale())));
  return slide.from * (1 - SLIDE_EASING(p));
}

function planChange(before: Snapshot, after: Snapshot, windowId: string, profileId: string, slides: Map<string, Slide>, ghosts: Ghost[], t: number): Plan | null {
  const kept = new Set(after.list);
  const had = new Set(before.list);
  const removed = before.list.filter((e) => !kept.has(e));
  const added = after.list.filter((e) => !had.has(e));
  if (!removed.length && !added.length) return null;
  const closed = (e: string) => {
    const ids = tabsOf(before.state, e);
    return ids.length > 0 && ids.every((id) => !after.state.tabs[id]);
  };
  const opened = (e: string) => {
    const ids = tabsOf(after.state, e);
    return ids.length > 0 && ids.every((id) => !before.state.tabs[id]);
  };
  if (!removed.every(closed) || !added.every(opened)) return null;
  const old = offsets(before.state, windowId, profileId, before.list);
  const next = offsets(after.state, windowId, profileId, after.list);
  const moves: Move[] = [];
  for (const e of after.list) {
    if (!had.has(e)) continue;
    const delta = old.at.get(e)! - next.at.get(e)!;
    if (delta) moves.push({ key: e, from: shiftAt(slides.get(e), t) + delta });
  }
  if (old.end !== next.end) moves.push({ key: TAIL, from: shiftAt(slides.get(TAIL), t) + old.end - next.end });
  const anchorAfter = (entry: string): string | null => {
    for (let i = before.list.indexOf(entry) + 1; i < before.list.length; i++) if (kept.has(before.list[i]!)) return before.list[i]!;
    return null;
  };
  const gone = new Set(removed);
  for (const g of ghosts) if (g.anchor && gone.has(g.anchor)) g.anchor = anchorAfter(g.anchor);
  const born = removed.flatMap((e): Ghost[] => {
    const snapshot = snapshotEntry(before.state, windowId, profileId, e);
    if (!snapshot) return [];
    const y = old.at.get(e)! + shiftAt(slides.get(e), t);
    return [{ id: ++ghostIds, anchor: anchorAfter(e), y, snapshot, opacity: new Animated.Value(1) }];
  });
  if (!moves.length) return { moves, ghosts: born, raised: [], clipped: [] };
  const fresh = new Set(added);
  const clipped = added.flatMap((e) => {
    const next = after.list[after.list.indexOf(e) + 1];
    return next === undefined ? [TAIL] : fresh.has(next) ? [] : [next];
  });
  return { moves, ghosts: born, raised: added, clipped };
}

export function useListMotion(windowId: string, profileId: string, entries: string[], enabled: boolean) {
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
  if (__DEV__ && enabled) {
    const dev = globalThis as { sidebarMotion?: Record<string, unknown> };
    dev.sidebarMotion = { ...dev.sidebarMotion, [windowId]: { slides, ghosts, raised, clipped } };
  }

  useEffect(() => {
    let last = sidebarEntries(useBrowser.getState(), windowId, profileId).list;
    const unsubscribe = useBrowser.subscribe((s, prev) => {
      if (s.tabs === prev.tabs && s.windows === prev.windows && s.groups === prev.groups && s.splits === prev.splits) return;
      const list = sidebarEntries(s, windowId, profileId).list;
      if (list === last) return;
      if (!pending.current) pending.current = { state: prev, list: last };
      last = list;
    });
    return () => {
      unsubscribe();
      pending.current = null;
    };
  }, [windowId, profileId]);

  if (entries !== seen.current) {
    seen.current = entries;
    const before = pending.current;
    pending.current = null;
    const plan = enabled && before ? planChange(before, { state: useBrowser.getState(), list: entries }, windowId, profileId, slides, ghosts.current, Date.now()) : null;
    const live = new Set(entries);
    for (const key of slides.keys()) if (key !== TAIL && !live.has(key)) slides.delete(key);
    for (const key of contexts.keys()) if (!live.has(key)) contexts.delete(key);
    for (const key of raised) if (!live.has(key)) raised.delete(key);
    for (const key of clipped) if (key !== TAIL && !live.has(key)) clipped.delete(key);
    if (plan) {
      for (const m of plan.moves) if (!slides.has(m.key)) slides.set(m.key, { value: new Animated.Value(m.from), from: m.from, at: Date.now() });
      ghosts.current = [...ghosts.current, ...plan.ghosts];
      queued.current = plan;
    }
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
      const tracking = slide.value.addListener(keepInStep);
      Animated.timing(slide.value, { toValue: 0, duration: SLIDE_MS * devScale(), easing: SLIDE_EASING, useNativeDriver: true }).start(({ finished }) => {
        running.delete(token);
        slide.value.removeListener(tracking);
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
    if (layered || plan.raised.length) rerender((n) => n + 1);
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
    const { at, end } = offsets(useBrowser.getState(), windowId, profileId, entries);
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

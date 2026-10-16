import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { View } from "react-native";
import type { NativePagerConfig, PagerSnapshot, PagerStateEvent, SwipeAreaHandle, SwipeAreaProps } from "@ardia-real/ardiacore";

const SETTLE_MS = 320;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

type Pager = {
  config: NativePagerConfig;
  position: number;
  selected: number;
  sequence: number;
  profileId: string | null;
  frame: number;
  onPosition: (position: number) => void;
  onState: (event: PagerStateEvent) => void;
};

const pagers = new Map<string, Pager>();

function emitState(pager: Pager, phase: PagerStateEvent["phase"]) {
  pager.onState({ phase, sequence: pager.sequence, position: pager.position, selected: pager.selected, profileId: pager.profileId, velocity: 0 });
}

function slideTo(key: string, index: number, profileId: string | null): Promise<boolean> {
  const pager = pagers.get(key);
  if (!pager || index < 0 || index >= pager.config.count) return Promise.resolve(false);
  cancelAnimationFrame(pager.frame);
  pager.sequence++;
  pager.selected = index;
  pager.profileId = profileId;
  emitState(pager, "selected");
  const from = pager.position;
  const start = performance.now();
  return new Promise((resolve) => {
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / SETTLE_MS);
      pager.position = from + (index - from) * easeOut(t);
      pager.onPosition(pager.position);
      if (t < 1) {
        pager.frame = requestAnimationFrame(step);
        return;
      }
      pager.frame = 0;
      emitState(pager, "settled");
      resolve(true);
    };
    pager.frame = requestAnimationFrame(step);
  });
}

const orderOf = (order: string | undefined) => (order ? order.split("\n") : []);

export const switchPager = (key: string, index: number, order?: string) => slideTo(key, index, orderOf(order)[index] ?? null);

export const stepPager = (key: string, delta: -1 | 1, wrap = false, order?: string) => {
  const pager = pagers.get(key);
  if (!pager) return Promise.resolve(false);
  const count = pager.config.count;
  const target = wrap ? (pager.selected + delta + count) % count : pager.selected + delta;
  return slideTo(key, target, orderOf(order)[target] ?? null);
};

export const selectPager = (key: string, profileId: string, order: string) => slideTo(key, orderOf(order).indexOf(profileId), profileId);

export function pagerState(key: string): PagerSnapshot | null {
  const pager = pagers.get(key);
  if (!pager) return null;
  return {
    sequence: pager.sequence,
    selectionSequence: pager.sequence,
    position: pager.position,
    selected: pager.selected,
    phase: "idle",
    profileId: pager.profileId,
    velocity: 0,
    count: pager.config.count,
  };
}

export const devPagerState = async (key: string) => pagerState(key);

export const SwipeArea = forwardRef<SwipeAreaHandle, SwipeAreaProps>(function SwipeArea(
  { onSwipe: _onSwipe, onPagerState, onPagerPosition, nativePager, canSwipeBack: _back, canSwipeForward: _forward, tracksUnavailableDirections: _tracks, allowsVerticalMotion: _vertical, isPager: _isPager, ...props },
  ref,
) {
  useImperativeHandle(ref, () => ({ devSimulate: async () => ({ error: "not on the web" }) }));
  const latest = useRef({ onPagerState, onPagerPosition });
  latest.current = { onPagerState, onPagerPosition };

  useEffect(() => {
    if (!nativePager) return;
    const existing = pagers.get(nativePager.key);
    const pager: Pager = existing ?? {
      config: nativePager,
      position: nativePager.selected,
      selected: nativePager.selected,
      sequence: nativePager.ack ?? 0,
      profileId: null,
      frame: 0,
      onPosition: (position) => (latest.current.onPagerPosition as ((e: unknown) => void) | undefined)?.({ nativeEvent: { position } }),
      onState: (event) => latest.current.onPagerState?.(event),
    };
    pager.config = nativePager;
    if (!existing) {
      pagers.set(nativePager.key, pager);
      pager.onPosition(pager.position);
    } else if (pager.selected !== nativePager.selected && !pager.frame) {
      pager.selected = nativePager.selected;
      pager.position = nativePager.selected;
      pager.onPosition(pager.position);
    }
  }, [nativePager?.key, nativePager?.selected, nativePager?.count]);

  useEffect(() => {
    const key = nativePager?.key;
    return () => {
      if (!key) return;
      const pager = pagers.get(key);
      if (pager) cancelAnimationFrame(pager.frame);
      pagers.delete(key);
    };
  }, [nativePager?.key]);

  return <View pointerEvents="box-none" {...props} />;
});

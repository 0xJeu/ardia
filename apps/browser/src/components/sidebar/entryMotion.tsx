import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, type Ref } from "react";
import type { Animated, View } from "react-native";

export type ClipSource = { clipped: () => boolean; subscribe: (changed: () => void) => () => void };
export type EntryMotion = { shift: Animated.Value | null; clip: ClipSource };

export const EntryMotionContext = createContext<EntryMotion | null>(null);

type AnimatedPropsHook = (props: object) => [Record<string, unknown>, (instance: View | null) => void];
const useAnimatedProps: AnimatedPropsHook = require("react-native/Libraries/Animated/useAnimatedProps").default;

export function useClipped(source: ClipSource | null | undefined) {
  const [, changed] = useReducer((n: number) => n + 1, 0);
  useEffect(() => source?.subscribe(changed), [source]);
  return !!source?.clipped();
}

export const useEntryClipped = (applies: boolean) => {
  const clipped = useClipped(useContext(EntryMotionContext)?.clip);
  return applies && clipped;
};

export function useAnimatedStyle(style: object | null, own?: (view: View | null) => void): [Record<string, unknown>, Ref<View>] {
  const props = useMemo(() => (style ? { style } : {}), [style]);
  const [animated, attach] = useAnimatedProps(props);
  const ref = useCallback(
    (view: View | null) => {
      attach(view);
      own?.(view);
    },
    [attach, own],
  );
  return [animated, ref];
}

export function useShift(shift: Animated.Value | null, own?: (view: View | null) => void) {
  const style = useMemo(() => (shift ? { transform: [{ translateY: shift }] } : null), [shift]);
  return useAnimatedStyle(style, own);
}

export const useEntryShift = (own?: (view: View | null) => void) => useShift(useContext(EntryMotionContext)?.shift ?? null, own);

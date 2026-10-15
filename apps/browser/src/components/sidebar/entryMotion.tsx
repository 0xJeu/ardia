import { createContext, useContext, useMemo, type ReactNode } from "react";
import { Animated } from "react-native";

export type EntryMotion = { shift: Animated.Value | null; raised: boolean; clipped: boolean };

export const EntryMotionContext = createContext<EntryMotion | null>(null);

export const useEntryLayering = (topLevel: boolean) => {
  const motion = useContext(EntryMotionContext);
  return { raised: topLevel && !!motion?.raised, clipped: topLevel && !!motion?.clipped };
};

export function EntryShift({ topLevel, children }: { topLevel: boolean; children: ReactNode }) {
  const motion = useContext(EntryMotionContext);
  const shift = topLevel ? motion?.shift : null;
  const style = useMemo(() => (shift ? { transform: [{ translateY: shift }] } : undefined), [shift]);
  return <Animated.View style={style}>{children}</Animated.View>;
}

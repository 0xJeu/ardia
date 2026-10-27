import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Text, type TextStyle } from "react-native";
import { FadeMask } from "../ui";
import { curve } from "../ui/motion";
import { mediaMotion } from "./tokens";

type MarqueeGroup = {
  progress: Animated.Value;
  report(key: string, overflow: number): void;
};

export function useMarqueeGroup(resetKey: string): MarqueeGroup {
  const progress = useRef(new Animated.Value(0)).current;
  const [overflows, setOverflows] = useState<Record<string, number>>({});
  const max = Math.max(0, ...Object.values(overflows));
  useEffect(() => {
    progress.setValue(0);
    if (max < 1) return;
    const duration = (max / mediaMotion.marqueeSpeed) * 1000;
    const leg = (toValue: number) => Animated.timing(progress, { toValue, duration, easing: curve.linear, useNativeDriver: true });
    const loop = Animated.loop(Animated.sequence([Animated.delay(mediaMotion.marqueePause), leg(1), Animated.delay(mediaMotion.marqueePause), leg(0)]));
    loop.start();
    return () => loop.stop();
  }, [max, resetKey]);
  return useMemo(
    () => ({
      progress,
      report: (key, overflow) => setOverflows((o) => (Math.abs((o[key] ?? 0) - overflow) < 0.5 ? o : { ...o, [key]: overflow })),
    }),
    [progress],
  );
}

export function Marquee({
  id,
  text,
  group,
  style,
  height,
}: {
  id: string;
  text: string;
  group: MarqueeGroup;
  style: TextStyle;
  height: number;
}) {
  const [box, setBox] = useState(0);
  const [natural, setNatural] = useState(0);
  const overflow = box > 0 && natural > box + 0.5 ? natural - box : 0;
  useEffect(() => group.report(id, overflow), [overflow]);
  const x = useMemo(() => overflow ? group.progress.interpolate({ inputRange: [0, 1], outputRange: [0, -overflow] }) : 0, [group.progress, overflow]);
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    if (!overflow) return;
    const listener = group.progress.addListener(({ value }) => setProgress(value));
    return () => group.progress.removeListener(listener);
  }, [group.progress, overflow]);
  const leading = overflow ? Math.min(1, Math.max(0, progress / 0.03)) : 0;
  const trailing = overflow ? Math.min(1, Math.max(0, (1 - progress) / 0.03)) : 0;
  return (
    <FadeMask leading={leading} trailing={trailing} style={{ height, overflow: "hidden" }} onLayout={(e) => setBox(e.nativeEvent.layout.width)}>
      <Animated.View style={{ position: "absolute", left: 0, top: 0, height, width: 4000, flexDirection: "row", alignItems: "center", transform: [{ translateX: x }] }}>
        <Text numberOfLines={1} onLayout={(e) => setNatural(e.nativeEvent.layout.width)} style={style}>
          {text}
        </Text>
      </Animated.View>
    </FadeMask>
  );
}

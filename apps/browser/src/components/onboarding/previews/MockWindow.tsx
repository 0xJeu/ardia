import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { useTheme } from "../../../lib/theme";
import { DEFAULT_SETTINGS, type Settings } from "../../../store/settings";
import { DEMOS } from "./demos";
import type { PreviewId } from "./ids";
import {
  Chevrons,
  Clip,
  DARK_WINDOW,
  geo,
  hairline,
  LIGHT_WINDOW,
  Lights,
  MAC_LIGHTS,
  PILL,
  ROW,
  SIDE_FIELD,
  SideRows,
  SITE,
  TabRow,
  TOOLBAR_H,
  TOP_TAB,
  useDemo,
  type Geo,
  type Pal,
} from "./kit";

const FALLBACK = { width: 420, height: 300 };
const MOVE = { duration: 340, easing: Easing.out(Easing.cubic) };
const FADE = { duration: 320, easing: Easing.out(Easing.cubic) };
const WINDOW_LIGHT: Pal = { ...LIGHT_WINDOW, lights: MAC_LIGHTS };
const WINDOW_DARK: Pal = { ...DARK_WINDOW, lights: MAC_LIGHTS };
const fill = StyleSheet.absoluteFill;

type Look = { top: boolean; addressInSidebar: boolean; appearance: Settings["appearance"]; siteColor: boolean };

function lookOf(settings: Partial<Settings>): Look {
  const top = (settings.tabLayout ?? DEFAULT_SETTINGS.tabLayout) === "top";
  return {
    top,
    addressInSidebar: !top && (settings.addressBar ?? DEFAULT_SETTINGS.addressBar) === "sidebar",
    appearance: settings.appearance ?? DEFAULT_SETTINGS.appearance,
    siteColor: settings.extendWebsiteColor ?? DEFAULT_SETTINGS.extendWebsiteColor,
  };
}

function useTo(value: number, native: boolean, config = MOVE) {
  const v = useRef(new Animated.Value(value)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const run = Animated.timing(v, { toValue: value, ...config, useNativeDriver: native, isInteraction: false });
    run.start();
    return () => run.stop();
  }, [value]);
  return v;
}

export function MockWindow({ settings, accent, focus }: { settings: Partial<Settings>; accent: string; focus: PreviewId | null }) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0 && (width !== size?.width || height !== size?.height)) setSize({ width, height });
  };
  const box = size ?? FALLBACK;
  return (
    <View style={{ flex: 1, alignSelf: "stretch" }} onLayout={onLayout}>
      {size ? <Window width={box.width} height={box.height} settings={settings} accent={accent} focus={focus} /> : null}
    </View>
  );
}

function Window({ width, height, settings, accent, focus }: { width: number; height: number; settings: Partial<Settings>; accent: string; focus: PreviewId | null }) {
  const g = useMemo(() => geo(width, height), [width, height]);
  const look = lookOf(settings);
  const appDark = useTheme().dark;
  const lay = useTo(look.top ? 1 : 0, false);
  const addr = useTo(look.addressInSidebar ? 1 : 0, false);
  const site = useTo(look.siteColor ? 1 : 0, true, FADE);
  const darkShown = useTo(look.appearance === "light" ? 0 : 1, true, FADE);
  const edge = useEdge(look.appearance, width);
  const inner = useMemo(() => Animated.multiply(edge, -1), [edge]);
  const focusShown = useTo(focus ? 1 : 0, true, { duration: 220, easing: Easing.out(Easing.quad) });
  const [demo, setDemo] = useState(focus);
  useEffect(() => {
    if (focus) return setDemo(focus);
    const timer = setTimeout(() => setDemo(null), 240);
    return () => clearTimeout(timer);
  }, [focus]);
  const focusDark = look.appearance === "dark" || (look.appearance === "auto" && appDark);
  const focusPal = focusDark ? WINDOW_DARK : WINDOW_LIGHT;
  const radius = 5.5 * g.k;
  return (
    <View style={{ width, height, borderRadius: radius, overflow: "hidden", borderWidth: hairline(g), borderColor: appDark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.12)" }}>
      <Animated.View style={[fill, { opacity: focusShown.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}>
        <WindowState g={g} pal={WINDOW_LIGHT} accent={accent} lay={lay} addr={addr} site={site} />
        <Animated.View style={[fill, { opacity: darkShown }]}>
          <Clip g={g} x={edge} inner={inner} width={g.W} height={g.H}>
            <WindowState g={g} pal={WINDOW_DARK} accent={accent} lay={lay} addr={addr} site={site} />
          </Clip>
        </Animated.View>
      </Animated.View>
      {demo ? (
        <Animated.View style={[fill, { opacity: focusShown, backgroundColor: focusPal.frame }]}>
          <AccentTint accent={accent} alpha={focusDark ? 0.2 : 0.14} />
          <FocusDemo key={demo} id={demo} g={g} pal={focusPal} />
        </Animated.View>
      ) : null}
    </View>
  );
}

function useEdge(appearance: Settings["appearance"], width: number) {
  const edge = useRef(new Animated.Value(appearance === "auto" ? width / 2 : 0)).current;
  const shown = useRef(appearance !== "light");
  useEffect(() => {
    if (appearance === "light") {
      shown.current = false;
      return;
    }
    const target = appearance === "auto" ? width / 2 : 0;
    if (!shown.current) {
      shown.current = true;
      edge.setValue(target);
      return;
    }
    const run = Animated.timing(edge, { toValue: target, ...MOVE, duration: 420, useNativeDriver: true, isInteraction: false });
    run.start();
    return () => run.stop();
  }, [appearance, width]);
  return edge;
}

const FocusDemo = memo(function FocusDemo({ id, g, pal }: { id: PreviewId; g: Geo; pal: Pal }) {
  const { Scene, duration } = DEMOS[id];
  const p = useDemo(true, duration);
  return <Scene g={g} pal={pal} p={p} />;
});

function AccentTint({ accent, alpha }: { accent: string; alpha: number }) {
  const [layers, setLayers] = useState({ below: accent, above: accent });
  const fade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (accent === layers.above) return;
    setLayers({ below: layers.above, above: accent });
    fade.setValue(0);
    const run = Animated.timing(fade, { toValue: 1, ...FADE, useNativeDriver: true, isInteraction: false });
    run.start();
    return () => run.stop();
  }, [accent]);
  return (
    <View pointerEvents="none" style={[fill, { opacity: alpha }]}>
      <View style={[fill, { backgroundColor: layers.below }]} />
      <Animated.View style={[fill, { backgroundColor: layers.above, opacity: fade }]} />
    </View>
  );
}

const PAGE_LINES = [0.84, 0.76, 0.8, 0.5, 0.82, 0.66, 0.78, 0.56, 0.8, 0.7, 0.84, 0.6, 0.76, 0.5];

function FluidPage({ g, pal }: { g: Geo; pal: Pal }) {
  const u = g.k;
  const count = Math.max(0, Math.floor((g.H - 10 - TOOLBAR_H - 30) / 5.2));
  return (
    <>
      <View style={{ position: "absolute", left: 0, right: 0, top: TOOLBAR_H * u, height: 17 * u, backgroundColor: SITE }}>
        <View style={{ position: "absolute", left: 8 * u, top: 6 * u, width: "34%", height: 2.6 * u, borderRadius: u, backgroundColor: "rgba(255,255,255,0.85)" }} />
        <View style={{ position: "absolute", left: 8 * u, top: 10.6 * u, width: "22%", height: 1.8 * u, borderRadius: 0.9 * u, backgroundColor: "rgba(255,255,255,0.5)" }} />
      </View>
      {Array.from({ length: count }, (_, i) => (
        <View
          key={i}
          style={{ position: "absolute", left: 8 * u, top: (TOOLBAR_H + 23 + i * 5.2) * u, width: `${PAGE_LINES[i % PAGE_LINES.length]! * 100}%`, height: 1.8 * u, borderRadius: 0.9 * u, backgroundColor: pal.bar }}
        />
      ))}
    </>
  );
}

const WindowState = memo(function WindowState({
  g,
  pal,
  accent,
  lay,
  addr,
  site,
}: {
  g: Geo;
  pal: Pal;
  accent: string;
  lay: Animated.Value;
  addr: Animated.Value;
  site: Animated.Value;
}) {
  const u = g.k;
  const lerp = (v: Animated.Value, a: number, b: number) => v.interpolate({ inputRange: [0, 1], outputRange: [a, b] });
  const step = TOP_TAB.w + TOP_TAB.gap;
  const tabs = Math.max(1, Math.min(5, Math.floor((g.W - TOP_TAB.x - 30) / step)));
  const sideRows = Math.max(1, Math.min(6, Math.floor((g.H - ROW.topWithField - 8) / ROW.pitch)));
  const pillLeft = Animated.add(lerp(lay, (43 + PILL.x) * u, (5 + PILL.x) * u), lerp(addr, 0, (SIDE_FIELD.x - 43 - PILL.x) * u));
  const pillTop = Animated.add(lerp(lay, (5 + PILL.y) * u, (14 + PILL.y) * u), lerp(addr, 0, (SIDE_FIELD.y - 5 - PILL.y) * u));
  const pillWidth = Animated.add(lerp(lay, PILL.w * u, (PILL.w + 18) * u), lerp(addr, 0, (SIDE_FIELD.w - PILL.w) * u));
  const pillHeight = lerp(addr, PILL.h * u, SIDE_FIELD.h * u);
  return (
    <View style={[fill, { backgroundColor: pal.frame }]}>
      <AccentTint accent={accent} alpha={pal === WINDOW_DARK ? 0.2 : 0.14} />
      <Animated.View style={[{ position: "absolute", left: 0, right: 0, top: 0, height: 13.5 * u }, { opacity: lay }]}>
        <Animated.View style={[fill, { backgroundColor: SITE, opacity: site }]} />
      </Animated.View>
      <Lights g={g} pal={pal} />
      <Animated.View style={[fill, { opacity: lerp(lay, 1, 0), transform: [{ translateX: lerp(lay, 0, -40 * u) }] }]}>
        <Animated.View style={[fill, { transform: [{ translateY: lerp(addr, 0, (ROW.topWithField - ROW.top) * u) }] }]}>
          <SideRows g={g} pal={pal} n={sideRows} sel={0} />
        </Animated.View>
      </Animated.View>
      <Animated.View style={[fill, { opacity: lay, transform: [{ translateY: lerp(lay, -6 * u, 0) }] }]}>
        {Array.from({ length: tabs }, (_, i) => (
          <TabRow key={i} g={g} pal={pal} i={i} x={TOP_TAB.x + i * step} y={TOP_TAB.y} w={TOP_TAB.w} selected={i === 0} />
        ))}
      </Animated.View>
      <Animated.View
        style={{
          position: "absolute",
          left: lerp(lay, 43 * u, 5 * u),
          top: lerp(lay, 5 * u, 14 * u),
          width: lerp(lay, (g.W - 48) * u, (g.W - 10) * u),
          height: lerp(lay, (g.H - 10) * u, (g.H - 19) * u),
          borderRadius: 4 * u,
          backgroundColor: pal.card,
          borderWidth: hairline(g),
          borderColor: pal.cardBorder,
          overflow: "hidden",
        }}
      >
        <Animated.View style={[fill, { transform: [{ translateY: lerp(addr, 0, -(TOOLBAR_H - 1) * u) }] }]}>
          <FluidPage g={g} pal={pal} />
        </Animated.View>
        <View style={{ position: "absolute", left: 0, right: 0, top: 0, height: TOOLBAR_H * u }}>
          <Animated.View style={[fill, { opacity: lerp(addr, 1, 0) }]}>
            <Animated.View style={[fill, { backgroundColor: SITE, opacity: site }]} />
            <Chevrons g={g} pal={pal} />
          </Animated.View>
        </View>
      </Animated.View>
      <Animated.View style={{ position: "absolute", left: pillLeft, top: pillTop, width: pillWidth, height: pillHeight, borderRadius: lerp(addr, (PILL.h / 2) * u, (SIDE_FIELD.h / 2) * u), backgroundColor: pal.bar }}>
        <Animated.View style={{ position: "absolute", left: 3.5 * u, top: lerp(addr, (PILL.h / 2 - 0.8) * u, (SIDE_FIELD.h / 2 - 0.8) * u), width: 20 * u, height: 1.6 * u, borderRadius: 0.8 * u, backgroundColor: pal.text }} />
      </Animated.View>
    </View>
  );
});

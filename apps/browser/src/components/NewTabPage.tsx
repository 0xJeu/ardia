import { AreaLight, EdgeLight, PowerUp } from "@arcadia/shaders";
import { useEffect, useState } from "react";
import { Surface, VisualEffect } from "@arcadia/shell";
import { AccessibilityInfo, Animated, StyleSheet, View } from "react-native";
import { hex, layout, useTheme } from "../lib/theme";
import { springParams } from "./layout/swipeMotion";
import { NewTabExtras } from "./ntp";
import { Omnibox } from "./Omnibox";

const REBRAND = true;
const BAR_HEIGHT = 112;
// The painted hills in each profile colour, as Dia paints its mark per colour; green is the brand painting. Three layers
// (back hill, front hill, sun; docs/brand/arcadia/build.py) that make the painting at rest and rise one after another.
const MARKS = {
  green: { back: require("../../assets/ntp-mark-back.png"), front: require("../../assets/ntp-mark-front.png"), sun: require("../../assets/ntp-mark-sun.png") },
  plum: { back: require("../../assets/ntp-mark-plum-back.png"), front: require("../../assets/ntp-mark-plum-front.png"), sun: require("../../assets/ntp-mark-plum-sun.png") },
  blue: { back: require("../../assets/ntp-mark-blue-back.png"), front: require("../../assets/ntp-mark-blue-front.png"), sun: require("../../assets/ntp-mark-blue-sun.png") },
  purple: { back: require("../../assets/ntp-mark-purple-back.png"), front: require("../../assets/ntp-mark-purple-front.png"), sun: require("../../assets/ntp-mark-purple-sun.png") },
  pink: { back: require("../../assets/ntp-mark-pink-back.png"), front: require("../../assets/ntp-mark-pink-front.png"), sun: require("../../assets/ntp-mark-pink-sun.png") },
  red: { back: require("../../assets/ntp-mark-red-back.png"), front: require("../../assets/ntp-mark-red-front.png"), sun: require("../../assets/ntp-mark-red-sun.png") },
  orange: { back: require("../../assets/ntp-mark-orange-back.png"), front: require("../../assets/ntp-mark-orange-front.png"), sun: require("../../assets/ntp-mark-orange-sun.png") },
  yellow: { back: require("../../assets/ntp-mark-yellow-back.png"), front: require("../../assets/ntp-mark-yellow-front.png"), sun: require("../../assets/ntp-mark-yellow-sun.png") },
  neutral: { back: require("../../assets/ntp-mark-neutral-back.png"), front: require("../../assets/ntp-mark-neutral-front.png"), sun: require("../../assets/ntp-mark-neutral-sun.png") },
};
const MARK_SIZE = 100;
const MARK_ABOVE_BAR = 84.1;
// The intro. Each layer starts `hidden` pt down, just under the bar's top edge, and springs up: the front hill first, the
// far hill from behind it, then the sun from behind both, drifting a little left as it climbs. The back hill trails the
// front one all the way, so the paint under the front hill never shows. Settled by about 0.8 s. Drawn back to front.
const SUN_DELAY = 250;
const MARK_LAYERS = [
  { name: "sun", hidden: 56, delay: SUN_DELAY, spring: springParams(0.56, 0.9) },
  { name: "back", hidden: 40.5, delay: 170, spring: springParams(0.46, 0.84) },
  { name: "front", hidden: 34, delay: 80, spring: springParams(0.42, 0.76) },
] as const;
const SUN_DRIFT = 6;
const SUN_DRIFT_SPRING = springParams(0.6, 1);
const DIA_OFFSET = 1;
const NEGATE_ANGLE = true;

type Frame = { x: number; y: number; width: number; height: number };
type Size = { width: number; height: number };
let lastSize: Size | null = null;
const introPlayed = new Set<string>();
const frameStyle = (f: Frame) => ({ left: f.x, top: f.y, width: f.width, height: f.height });

let reduceMotion = false;
AccessibilityInfo.isReduceMotionEnabled().then((on) => (reduceMotion = on), () => {});
AccessibilityInfo.addEventListener("reduceMotionChanged", (on) => (reduceMotion = on));

function EdgeLightLayer({ bar, color }: { bar: Frame; color: string }) {
  const container = { x: bar.x - 10, y: bar.y - 10, width: bar.width + 20, height: Math.max(bar.height + 20, 480) };
  const local = (f: Frame) => ({ x: f.x - container.x, y: f.y - container.y, width: f.width, height: f.height });
  const rect = local(bar);
  return (
    <View pointerEvents="none" style={{ position: "absolute", ...frameStyle(container) }}>
      <EdgeLight
        style={StyleSheet.absoluteFill}
        rectFrame={rect}
        cornerRadius={20}
        lightStart={{ x: rect.x + rect.width / 2, y: rect.y + rect.height + 300 }}
        lightEnd={{ x: rect.x + rect.width / 2, y: rect.y }}
        lightColor={color}
        animationDuration={1}
      />
    </View>
  );
}

function barWidth(viewWidth: number) {
  const content = viewWidth < 708 ? (viewWidth <= 636 ? viewWidth - 20 : 616) : viewWidth < 1700 ? 652 : 774;
  return Math.min(content, viewWidth - 28);
}

export function NewTabPage({ tabId, toolbar = true }: { tabId: string; toolbar?: boolean }) {
  const theme = useTheme();
  const [size, setSizeState] = useState<Size | null>(lastSize);
  const setSize = (next: Size) => {
    lastSize = next;
    setSizeState((prev) => (prev && prev.width === next.width && prev.height === next.height ? prev : next));
  };
  const [panelHeight, setPanelHeight] = useState(BAR_HEIGHT);
  const [playIntro] = useState(() => !introPlayed.has(tabId));
  const [rise] = useState(() => {
    const intro = playIntro && !reduceMotion;
    const layers = MARK_LAYERS.map((l) => ({ ...l, y: new Animated.Value(intro ? l.hidden : 0) }));
    return { layers, drift: new Animated.Value(intro ? SUN_DRIFT : 0) };
  });
  useEffect(() => {
    introPlayed.add(tabId);
  }, [tabId]);
  useEffect(() => {
    if (!playIntro || reduceMotion) return;
    const spring = (value: Animated.Value, delay: number, params: ReturnType<typeof springParams>) =>
      Animated.spring(value, { toValue: 0, delay, ...params, useNativeDriver: true });
    const intro = Animated.parallel([
      ...rise.layers.map((l) => spring(l.y, l.delay, l.spring)),
      spring(rise.drift, SUN_DELAY, SUN_DRIFT_SPRING),
    ]);
    intro.start();
    return () => intro.stop();
  }, [playIntro, rise]);

  if (!size) return <View style={{ flex: 1 }} onLayout={(e) => setSize(e.nativeEvent.layout)} />;

  const width = barWidth(size.width);
  const x = Math.max(size.width / 2 - width / 2, 14) + DIA_OFFSET;
  // Dia's rule is from the page under the toolbar; without one (address bar in the sidebar) the bar keeps the same place in the card.
  const under = toolbar ? 0 : layout.toolbarHeight;
  const top = Math.max((size.height - under) / 2 - 158, 100) + 38 + DIA_OFFSET + under;

  const r = (panelHeight - 112) / 240;
  const lift = r < 1 ? 10 - 4 * Math.max(r, 0) : 6;
  const tilt = (r < 1 ? 5 - 4 * Math.max(r, 0) : 1) * (NEGATE_ANGLE ? -0.5 : 1);
  const source = { x: x + 8, y: top + 8, width: width - 16, height: panelHeight - 16 };
  const lightHeight = Math.max(0.85 * size.height, 720);
  const bar = { x, y: top, width, height: panelHeight };
  const lightPalette = REBRAND ? null : theme.lightPalette;
  const areaLight = lightPalette !== null;
  const edgeLight = !REBRAND;

  return (
    <View style={{ flex: 1 }} onLayout={(e) => setSize(e.nativeEvent.layout)}>
      {playIntro && theme.powerUpColor && (
        <PowerUp
          style={StyleSheet.absoluteFill}
          palette={[theme.powerUpColor]}
          speed={areaLight ? 1.25 : 1}
          origin={0.5}
          cornerRadius={20}
          halo={areaLight ? null : bar}
        />
      )}
      {lightPalette && (
        <AreaLight
          style={{ position: "absolute", left: 0, top: 0, width: size.width, height: lightHeight }}
          source={source}
          cornerRadius={22}
          palette={lightPalette}
          lift={lift}
          tilt={[tilt, 0]}
          falloff={1}
          intensity={theme.lightIntensity}
        />
      )}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: size.width / 2 + DIA_OFFSET - MARK_SIZE / 2,
          top: top - MARK_ABOVE_BAR,
          width: MARK_SIZE,
          height: MARK_ABOVE_BAR,
          overflow: "hidden",
        }}
      >
        {rise.layers.map((l) => (
          <Animated.Image
            key={l.name}
            source={(MARKS[theme.profileColor === "incognito" ? "neutral" : theme.profileColor] ?? MARKS.green)[l.name]}
            style={{
              position: "absolute",
              width: MARK_SIZE,
              height: MARK_SIZE,
              transform: [{ translateX: l.name === "sun" ? rise.drift : 0 }, { translateY: l.y }],
            }}
          />
        ))}
      </View>
      <View onLayout={(e) => setPanelHeight(e.nativeEvent.layout.height)} style={{ position: "absolute", left: x, top, width }}>
        {REBRAND && (
          <>
            <Surface style={StyleSheet.absoluteFill} fill="#00000000" cornerRadius={20} shadowColor="#000000" shadowOpacity={0.08} shadowRadius={2} shadowOffset={[0, 0.5]} />
            <Surface style={StyleSheet.absoluteFill} fill="#00000000" cornerRadius={20} shadowColor="#000000" shadowOpacity={0.04} shadowRadius={1} shadowOffset={[0, 2]} />
          </>
        )}
        {areaLight && <VisualEffect style={StyleSheet.absoluteFill} material="hudWindow" blendingMode="withinWindow" cornerRadius={20} />}
        <Surface
          fill={hex(areaLight ? theme.ntpBar : theme.ntpBarSolid)}
          cornerRadius={20}
          borderColor={hex(theme.ntpBarBorder)}
          borderWidth={0.5}
        >
          <Omnibox variant="hero" tabId={tabId} />
        </Surface>
      </View>
      {edgeLight && <EdgeLightLayer bar={bar} color={theme.edgeLight} />}
      <NewTabExtras size={size} bar={bar} />
    </View>
  );
}

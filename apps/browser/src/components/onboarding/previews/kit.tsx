import { Symbol } from "@ardia/shell";
import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Easing, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

export type Pal = {
  frame: string;
  border: string;
  card: string;
  cardBorder: string;
  bar: string;
  text: string;
  ink: string;
  inkDim: string;
  tab: string;
  tabBorder: string;
  scrim: string;
  panel: string;
  panelBorder: string;
  hi: string;
  link: string;
  lights: readonly [string, string, string];
};

export type Rect = { x: number; y: number; w: number; h: number };

export type Geo = { k: number; W: number; H: number; card: Rect; topCard: Rect };

export type Anim = Animated.Value | Animated.AnimatedInterpolation<number>;

export function geo(width: number, height: number): Geo {
  const k = Math.min(width / 164, height / 84);
  const W = width / k;
  const H = height / k;
  return { k, W, H, card: { x: 43, y: 5, w: W - 48, h: H - 10 }, topCard: { x: 5, y: 14, w: W - 10, h: H - 19 } };
}

export const ROW = { x: 6, w: 32, h: 6, pitch: 9, top: 17, topWithField: 26 } as const;
export const SIDE_FIELD: Rect = { x: 6, y: 14, w: 32, h: 6.5 };
export const TOOLBAR_H = 10;
export const PILL: Rect = { x: 14, y: 2.25, w: 46, h: 5.5 };
export const TOP_TAB = { x: 24, y: 4, w: 27, h: 7, gap: 3 } as const;
export const FAVS = ["#E8664A", "#4691C3", "#3EB489", "#E3AC38", "#7873AF", "#C07A98"] as const;
export const TITLES = [18, 22, 15, 20, 17, 13] as const;
export const SITE = "#E4572E";
export const AD = "#FDD023";
export const rowY = (i: number, top: number = ROW.top) => top + i * ROW.pitch;

export const hairline = (g: Geo) => Math.max(StyleSheet.hairlineWidth, 0.5 * g.k);

export const at = (g: Geo, x: number, y: number, w: number, h: number): ViewStyle => ({
  position: "absolute",
  left: x * g.k,
  top: y * g.k,
  width: w * g.k,
  height: h * g.k,
});

export const atRect = (g: Geo, r: Rect) => at(g, r.x, r.y, r.w, r.h);

export function previewPalette(colors: {
  preview: string;
  previewBorder: string;
  card: string;
  progressTrack: string;
  title: string;
  subtitle: string;
}, dark: boolean): Pal {
  return {
    frame: colors.preview,
    border: colors.previewBorder,
    card: colors.card,
    cardBorder: colors.previewBorder,
    bar: colors.progressTrack,
    text: dark ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.2)",
    ink: colors.title,
    inkDim: colors.subtitle,
    tab: dark ? "rgba(255,255,255,0.1)" : "#FFFFFF",
    tabBorder: dark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.08)",
    scrim: dark ? "rgba(0,0,0,0.45)" : "rgba(0,0,0,0.1)",
    panel: dark ? "#242424" : "#FFFFFF",
    panelBorder: dark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.12)",
    hi: dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.06)",
    link: dark ? "#5EA2E6" : "#2F7BD8",
    lights: [colors.progressTrack, colors.progressTrack, colors.progressTrack],
  };
}

export const LIGHT_WINDOW: Pal = {
  frame: "#E9E9EC",
  border: "rgba(0,0,0,0.1)",
  card: "#FFFFFF",
  cardBorder: "rgba(0,0,0,0.07)",
  bar: "rgba(0,0,0,0.08)",
  text: "rgba(0,0,0,0.2)",
  ink: "#111111",
  inkDim: "rgba(0,0,0,0.5)",
  tab: "#FFFFFF",
  tabBorder: "rgba(0,0,0,0.07)",
  scrim: "rgba(0,0,0,0.12)",
  panel: "#FFFFFF",
  panelBorder: "rgba(0,0,0,0.12)",
  hi: "rgba(0,0,0,0.06)",
  link: "#2F7BD8",
  lights: ["rgba(0,0,0,0.13)", "rgba(0,0,0,0.13)", "rgba(0,0,0,0.13)"],
};

export const DARK_WINDOW: Pal = {
  frame: "#242426",
  border: "rgba(255,255,255,0.12)",
  card: "#141414",
  cardBorder: "rgba(255,255,255,0.08)",
  bar: "rgba(255,255,255,0.1)",
  text: "rgba(255,255,255,0.3)",
  ink: "#FFFFFF",
  inkDim: "rgba(255,255,255,0.55)",
  tab: "rgba(255,255,255,0.1)",
  tabBorder: "rgba(255,255,255,0.14)",
  scrim: "rgba(0,0,0,0.42)",
  panel: "#2A2A2A",
  panelBorder: "rgba(255,255,255,0.13)",
  hi: "rgba(255,255,255,0.1)",
  link: "#5EA2E6",
  lights: ["rgba(255,255,255,0.18)", "rgba(255,255,255,0.18)", "rgba(255,255,255,0.18)"],
};

export const MAC_LIGHTS = ["#FF5F57", "#FEBC2E", "#28C840"] as const;

export type Stop = readonly [number, number];

const SAMPLES = 8;
export const easeOut = (x: number) => 1 - (1 - x) ** 3;
export const linear = (x: number) => x;

export function track(p: Animated.Value, duration: number, stops: readonly Stop[], ease: (x: number) => number = easeOut) {
  const input: number[] = [];
  const output: number[] = [];
  const push = (ms: number, value: number) => {
    const last = input.length ? input[input.length - 1]! * duration : -Infinity;
    input.push(Math.max(ms, last + 0.5) / duration);
    output.push(value);
  };
  stops.forEach(([ms, value], i) => {
    if (i === 0) return push(ms, value);
    const [from, start] = stops[i - 1]!;
    if (value === start) return push(ms, value);
    for (let s = 1; s <= SAMPLES; s++) push(from + ((ms - from) * s) / SAMPLES, start + (value - start) * ease(s / SAMPLES));
  });
  if (input.length === 1) push(input[0]! * duration + 1, output[0]!);
  return p.interpolate({ inputRange: input, outputRange: output, extrapolate: "clamp" });
}

export type Tracker = ReturnType<typeof tracker>;

export function tracker(p: Animated.Value, duration: number) {
  const t = (stops: readonly Stop[], ease?: (x: number) => number) => track(p, duration, stops, ease);
  t.in = (at: number, dur = 240) => track(p, duration, [[at, 0], [at + dur, 1]]);
  t.out = (at: number, dur = 240) => track(p, duration, [[at, 1], [at + dur, 0]]);
  t.step = (at: number, from = 0, to = 1) => track(p, duration, [[at, from], [at + 1, to]], linear);
  t.deg = (stops: readonly Stop[]) => track(p, duration, stops).interpolate({ inputRange: [0, 360], outputRange: ["0deg", "360deg"], extrapolate: "extend" });
  return t;
}

export function useDemo(active: boolean, duration: number) {
  const p = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!active) return;
    p.setValue(0);
    const run = Animated.timing(p, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: true, isInteraction: false });
    run.start();
    return () => {
      run.stop();
      p.setValue(1);
    };
  }, [active, duration]);
  return p;
}

export function Lights({ g, pal, x = 7, y = 6.5 }: { g: Geo; pal: Pal; x?: number; y?: number }) {
  return (
    <>
      {pal.lights.map((color, i) => (
        <View key={i} style={[at(g, x + i * 4.4, y, 2.8, 2.8), { borderRadius: 1.4 * g.k, backgroundColor: color }]} />
      ))}
    </>
  );
}

export function TabRow({ g, pal, i, x = ROW.x, y, w = ROW.w, selected, style }: { g: Geo; pal: Pal; i: number; x?: number; y: number; w?: number; selected?: boolean; style?: StyleProp<ViewStyle> | object }) {
  return (
    <Animated.View style={[at(g, x, y, w, ROW.h), { borderRadius: 2 * g.k }, selected && selectedTab(g, pal), style as StyleProp<ViewStyle>]}>
      <View style={[at(g, 1.8, 1.5, 3, 3), { borderRadius: 0.9 * g.k, backgroundColor: FAVS[i % FAVS.length] }]} />
      <View style={[at(g, 6.6, 2.2, Math.min(TITLES[i % TITLES.length]!, w - 9), 1.6), { borderRadius: 0.8 * g.k, backgroundColor: pal.text }]} />
    </Animated.View>
  );
}

export const selectedTab = (g: Geo, pal: Pal): ViewStyle => ({ backgroundColor: pal.tab, borderWidth: hairline(g), borderColor: pal.tabBorder });

export function Highlight({ g, pal, x = ROW.x, y, w = ROW.w, h = ROW.h, style }: { g: Geo; pal: Pal; x?: number; y: number; w?: number; h?: number; style?: object }) {
  return <Animated.View style={[at(g, x, y, w, h), { borderRadius: 2 * g.k }, selectedTab(g, pal), style as ViewStyle]} />;
}

export function SideRows({ g, pal, n, sel, top = ROW.top, from = 0 }: { g: Geo; pal: Pal; n: number; sel?: number; top?: number; from?: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <TabRow key={i} g={g} pal={pal} i={from + i} y={rowY(i, top)} selected={i === sel} />
      ))}
    </>
  );
}

export function Card({ g, pal, rect, children, style }: { g: Geo; pal: Pal; rect: Rect; children?: ReactNode; style?: object }) {
  return (
    <Animated.View
      style={[
        atRect(g, rect),
        { borderRadius: 4 * g.k, backgroundColor: pal.card, borderWidth: hairline(g), borderColor: pal.cardBorder, overflow: "hidden" },
        style as ViewStyle,
      ]}
    >
      {children}
    </Animated.View>
  );
}

export function Chevrons({ g, pal }: { g: Geo; pal: Pal }) {
  return (
    <>
      <View style={[at(g, 4, 3.75, 2.5, 2.5), { borderRadius: 1.25 * g.k, backgroundColor: pal.bar }]} />
      <View style={[at(g, 8.2, 3.75, 2.5, 2.5), { borderRadius: 1.25 * g.k, backgroundColor: pal.bar }]} />
    </>
  );
}

export function Pill({ g, pal, rect = PILL, style, fill }: { g: Geo; pal: Pal; rect?: Rect; style?: object; fill?: string }) {
  return (
    <Animated.View style={[atRect(g, rect), { borderRadius: (rect.h / 2) * g.k, backgroundColor: fill ?? pal.bar }, style as ViewStyle]}>
      <View style={[at(g, 3.5, rect.h / 2 - 0.8, Math.min(20, rect.w - 7), 1.6), { borderRadius: 0.8 * g.k, backgroundColor: pal.text }]} />
    </Animated.View>
  );
}

export function Toolbar({ g, pal }: { g: Geo; pal: Pal }) {
  return (
    <>
      <Chevrons g={g} pal={pal} />
      <Pill g={g} pal={pal} />
    </>
  );
}

const LINES = [
  [0.92, 0.84, 0.88, 0.56, 0.9, 0.74, 0.86, 0.62, 0.9, 0.8],
  [0.7, 0.9, 0.62, 0.86, 0.76, 0.92, 0.58, 0.84, 0.7, 0.9],
] as const;

export function PageLines({ g, pal, x = 8, y = 15, w, h, seed = 0, title = true }: { g: Geo; pal: Pal; x?: number; y?: number; w: number; h: number; seed?: 0 | 1; title?: boolean }) {
  const count = Math.max(0, Math.floor((h - (title ? 9 : 0)) / 5.2));
  const lineTop = y + (title ? 9 : 0);
  return (
    <>
      {title ? <View style={[at(g, x, y, w * (seed ? 0.38 : 0.52), 3.2), { borderRadius: 1 * g.k, backgroundColor: pal.text }]} /> : null}
      {seed === 1 ? <View style={[at(g, x + w * 0.62, lineTop, w * 0.38, 15), { borderRadius: 2 * g.k, backgroundColor: pal.bar }]} /> : null}
      {Array.from({ length: count }, (_, i) => {
        const narrow = seed === 1 && i < 3;
        return (
          <View
            key={i}
            style={[at(g, x, lineTop + i * 5.2, w * (narrow ? 0.56 : 1) * LINES[seed][i % LINES[seed].length]!, 1.8), { borderRadius: 0.9 * g.k, backgroundColor: pal.bar }]}
          />
        );
      })}
    </>
  );
}

export function SitePage({ g, pal, w, h, y = 0, color = SITE }: { g: Geo; pal: Pal; w: number; h: number; y?: number; color?: string }) {
  return (
    <>
      <View style={[at(g, 0, y, w, 17), { backgroundColor: color }]}>
        <View style={[at(g, 8, 6, w * 0.4, 2.6), { borderRadius: 1 * g.k, backgroundColor: "rgba(255,255,255,0.85)" }]} />
        <View style={[at(g, 8, 10.6, w * 0.26, 1.8), { borderRadius: 0.9 * g.k, backgroundColor: "rgba(255,255,255,0.5)" }]} />
      </View>
      <PageLines g={g} pal={pal} y={y + 23} w={w - 16} h={h - y - 27} title={false} />
    </>
  );
}

export function NewTabPage({ g, pal, w, h }: { g: Geo; pal: Pal; w: number; h: number }) {
  const pillW = Math.min(64, w * 0.56);
  const top = Math.max(12, h * 0.3);
  const tile = 7;
  const gap = 4;
  const tilesW = 4 * tile + 3 * gap;
  return (
    <>
      <View style={[at(g, (w - pillW) / 2, top, pillW, 7), { borderRadius: 3.5 * g.k, backgroundColor: pal.bar }]}>
        <View style={[at(g, 4, 2.7, 16, 1.6), { borderRadius: 0.8 * g.k, backgroundColor: pal.text }]} />
      </View>
      {FAVS.slice(0, 4).map((color, i) => (
        <View key={i} style={[at(g, (w - tilesW) / 2 + i * (tile + gap), top + 13, tile, tile), { borderRadius: 2 * g.k, backgroundColor: pal.bar, alignItems: "center", justifyContent: "center" }]}>
          <View style={{ width: 3 * g.k, height: 3 * g.k, borderRadius: 0.9 * g.k, backgroundColor: color }} />
        </View>
      ))}
    </>
  );
}

export function Keycap({ g, pal, x, y, label, style }: { g: Geo; pal: Pal; x: number; y: number; label: string; style?: object }) {
  const w = 4 + label.length * 4;
  return (
    <Animated.View
      style={[
        at(g, x - w, y, w, 7.5),
        { borderRadius: 2 * g.k, backgroundColor: pal.panel, borderWidth: hairline(g), borderColor: pal.panelBorder, alignItems: "center", justifyContent: "center" },
        style as ViewStyle,
      ]}
    >
      <Text style={{ fontSize: 4.8 * g.k, lineHeight: 6 * g.k, fontWeight: "600", color: pal.ink }}>{label}</Text>
    </Animated.View>
  );
}

export function Panel({ g, pal, rect, children, style }: { g: Geo; pal: Pal; rect: Rect; children?: ReactNode; style?: object }) {
  return (
    <Animated.View
      style={[atRect(g, rect), { borderRadius: 3.5 * g.k, backgroundColor: pal.panel, borderWidth: hairline(g), borderColor: pal.panelBorder, overflow: "hidden" }, style as ViewStyle]}
    >
      {children}
    </Animated.View>
  );
}

export function Glyph({ g, name, size, color, x, y, style }: { g: Geo; name: string; size: number; color: string; x: number; y: number; style?: object }) {
  return (
    <Animated.View style={[at(g, x, y, size, size), style as ViewStyle]}>
      <Symbol name={name} size={size * 0.8 * g.k} color={color} style={{ width: size * g.k, height: size * g.k }} />
    </Animated.View>
  );
}

export function Cursor({ g, pal, style }: { g: Geo; pal: Pal; style?: object }) {
  return <Glyph g={g} name="cursorarrow" size={8} color={pal.ink} x={0} y={0} style={style} />;
}

export function Words({ g, text, size, color, weight, x, y, w, style }: { g: Geo; text: string; size: number; color: string; weight?: "400" | "500" | "600"; x: number; y: number; w: number; style?: object }) {
  return (
    <Animated.View style={[at(g, x, y, w, size * 1.4), style as ViewStyle]}>
      <Text numberOfLines={1} style={{ fontSize: size * g.k, lineHeight: size * 1.4 * g.k, fontWeight: weight ?? "400", color }}>
        {text}
      </Text>
    </Animated.View>
  );
}

export function Clip({ g, x, width, height, children, inner }: { g: Geo; x: Anim; width: number; height: number; children: ReactNode; inner: Anim }) {
  return (
    <Animated.View style={{ position: "absolute", left: 0, top: 0, width: width * g.k, height: height * g.k, overflow: "hidden", transform: [{ translateX: x }] }}>
      <Animated.View style={{ position: "absolute", left: 0, top: 0, width: width * g.k, height: height * g.k, transform: [{ translateX: inner }] }}>{children}</Animated.View>
    </Animated.View>
  );
}

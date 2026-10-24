import type { ReactNode } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import type { PreviewId } from "./ids";
import {
  AD,
  at,
  atRect,
  Card,
  Clip,
  Cursor,
  DARK_WINDOW,
  FAVS,
  Glyph,
  hairline,
  Highlight,
  Keycap,
  LIGHT_WINDOW,
  Lights,
  linear,
  NewTabPage,
  PageLines,
  Panel,
  PILL,
  ROW,
  rowY,
  SIDE_FIELD,
  SideRows,
  SITE,
  SitePage,
  TabRow,
  Toolbar,
  TOOLBAR_H,
  TOP_TAB,
  tracker,
  type Geo,
  type Pal,
  type Rect,
  type Tracker,
} from "./kit";

export type SceneProps = { g: Geo; pal: Pal; p: Animated.Value };
type Scene = (props: SceneProps) => ReactNode;

const fill = StyleSheet.absoluteFill;

function Page({ g, pal, seed = 0 }: { g: Geo; pal: Pal; seed?: 0 | 1 }) {
  return <PageLines g={g} pal={pal} w={g.card.w - 16} h={g.card.h - 19} seed={seed} />;
}

function Browser({ g, pal, rows = 3, sel = 0, children }: { g: Geo; pal: Pal; rows?: number; sel?: number; children?: ReactNode }) {
  return (
    <>
      <Lights g={g} pal={pal} />
      <SideRows g={g} pal={pal} n={rows} sel={sel} />
      <Card g={g} pal={pal} rect={g.card}>
        <Toolbar g={g} pal={pal} />
        <Page g={g} pal={pal} />
        {children}
      </Card>
    </>
  );
}

function KeyPress({ g, pal, t, label, ms = 0 }: { g: Geo; pal: Pal; t: Tracker; label: string; ms?: number }) {
  const c = g.card;
  return (
    <Keycap
      g={g}
      pal={pal}
      x={c.x + c.w - 4}
      y={c.y + c.h - 11.5}
      label={label}
      style={{ opacity: t.in(ms, 160), transform: [{ scale: t([[ms, 0.8], [ms + 240, 1]]) }] }}
    />
  );
}

function SuggestionRows({ g, pal, t, w, top, from = 0, ms }: { g: Geo; pal: Pal; t: Tracker; w: number; top: number; from?: number; ms: number }) {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <Animated.View
          key={i}
          style={[at(g, 2, top + i * 8, w - 4, 7), { borderRadius: 2 * g.k, backgroundColor: i === 0 ? pal.hi : "transparent", opacity: t.in(ms + i * 60, 200) }]}
        >
          <View style={[at(g, 3, 2, 3, 3), { borderRadius: 0.9 * g.k, backgroundColor: FAVS[(from + i) % FAVS.length] }]} />
          <View style={[at(g, 8.5, 2.7, [30, 24, 34][i] ?? 30, 1.6), { borderRadius: 0.8 * g.k, backgroundColor: pal.text }]} />
        </Animated.View>
      ))}
    </>
  );
}

function BarField({ g, pal, w, children }: { g: Geo; pal: Pal; w: number; children?: ReactNode }) {
  return (
    <>
      <Glyph g={g} name="magnifyingglass" size={5} color={pal.inkDim} x={4} y={3} />
      {children}
      <View style={[at(g, 0, 11, w, hairline(g) / g.k), { backgroundColor: pal.panelBorder }]} />
    </>
  );
}

function CommandPanel({ g, pal, t, rect, ms, field }: { g: Geo; pal: Pal; t: Tracker; rect: Rect; ms: number; field: ReactNode }) {
  return (
    <>
      <BarField g={g} pal={pal} w={rect.w}>
        {field}
      </BarField>
      <SuggestionRows g={g} pal={pal} t={t} w={rect.w} top={13} from={1} ms={ms} />
    </>
  );
}

const centredPanel = (g: Geo, w = 84): Rect => {
  const c = g.card;
  const width = Math.min(w, c.w - 12);
  return { x: c.x + (c.w - width) / 2, y: c.y + 12, w: width, h: 38 };
};

function SelectedUrl({ g, pal }: { g: Geo; pal: Pal }) {
  return (
    <View style={[at(g, 11, 3.2, 34, 5), { borderRadius: 1 * g.k, backgroundColor: pal.link, opacity: 0.28 }]}>
      <View style={[at(g, 1.5, 1.7, 30, 1.6), { borderRadius: 0.8 * g.k, backgroundColor: pal.ink, opacity: 0.8 }]} />
    </View>
  );
}

const TabsSidebar: Scene = ({ g, pal, p }) => {
  const t = tracker(p, 1200);
  const u = g.k;
  return (
    <>
      <Lights g={g} pal={pal} />
      <Highlight g={g} pal={pal} y={rowY(0)} style={{ opacity: t.in(240, 200), transform: [{ translateY: t([[620, 0], [920, 2 * ROW.pitch * u]]) }] }} />
      {[0, 1, 2, 3].map((i) => (
        <TabRow key={i} g={g} pal={pal} i={i} y={rowY(i)} style={{ opacity: t.in(i * 80, 280), transform: [{ translateX: t([[i * 80, -8 * u], [i * 80 + 300, 0]]) }] }} />
      ))}
      <Card g={g} pal={pal} rect={g.card}>
        <Toolbar g={g} pal={pal} />
        <Animated.View style={[fill, { opacity: t.out(640, 200) }]}>
          <Page g={g} pal={pal} />
        </Animated.View>
        <Animated.View style={[fill, { opacity: t.in(700, 260) }]}>
          <Page g={g} pal={pal} seed={1} />
        </Animated.View>
      </Card>
    </>
  );
};

const TabsTop: Scene = ({ g, pal, p }) => {
  const t = tracker(p, 1200);
  const u = g.k;
  const step = TOP_TAB.w + TOP_TAB.gap;
  const c = g.topCard;
  return (
    <>
      <Lights g={g} pal={pal} y={5.6} />
      <Highlight g={g} pal={pal} x={TOP_TAB.x} y={TOP_TAB.y} w={TOP_TAB.w} style={{ opacity: t.in(240, 200), transform: [{ translateX: t([[620, 0], [920, 2 * step * u]]) }] }} />
      {[0, 1, 2, 3].map((i) => (
        <TabRow
          key={i}
          g={g}
          pal={pal}
          i={i}
          x={TOP_TAB.x + i * step}
          y={TOP_TAB.y}
          w={TOP_TAB.w}
          style={{ opacity: t.in(i * 80, 280), transform: [{ translateY: t([[i * 80, -5 * u], [i * 80 + 300, 0]]) }] }}
        />
      ))}
      <Card g={g} pal={pal} rect={c}>
        <Toolbar g={g} pal={pal} />
        <Animated.View style={[fill, { opacity: t.out(640, 200) }]}>
          <PageLines g={g} pal={pal} w={c.w - 16} h={c.h - 19} />
        </Animated.View>
        <Animated.View style={[fill, { opacity: t.in(700, 260) }]}>
          <PageLines g={g} pal={pal} w={c.w - 16} h={c.h - 19} seed={1} />
        </Animated.View>
      </Card>
    </>
  );
};

function addressMove(toSidebar: boolean): Scene {
  return ({ g, pal, p }) => {
    const t = tracker(p, 1100);
    const u = g.k;
    const c = g.card;
    const m = toSidebar ? t([[220, 0], [600, 1]]) : t([[220, 1], [600, 0]]);
    const from: Rect = { x: c.x + PILL.x, y: c.y + PILL.y, w: PILL.w, h: PILL.h };
    const dx = SIDE_FIELD.x + SIDE_FIELD.w / 2 - (from.x + from.w / 2);
    const dy = SIDE_FIELD.y + SIDE_FIELD.h / 2 - (from.y + from.h / 2);
    const lerp = (a: number, b: number) => m.interpolate({ inputRange: [0, 1], outputRange: [a, b] });
    return (
      <>
        <Lights g={g} pal={pal} />
        <Animated.View style={[fill, { transform: [{ translateY: lerp(0, (ROW.topWithField - ROW.top) * u) }] }]}>
          <SideRows g={g} pal={pal} n={4} sel={0} />
        </Animated.View>
        <Card g={g} pal={pal} rect={c}>
          <Animated.View style={[fill, { opacity: lerp(1, 0) }]}>
            <View style={[at(g, 0, 0, c.w, TOOLBAR_H)]}>
              <Toolbar g={g} pal={pal} />
            </View>
          </Animated.View>
          <Animated.View style={[fill, { transform: [{ translateY: lerp(0, -9 * u) }] }]}>
            <Page g={g} pal={pal} />
          </Animated.View>
        </Card>
        <Animated.View
          style={[
            atRect(g, from),
            {
              borderRadius: (from.h / 2) * u,
              backgroundColor: pal.bar,
              transform: [{ translateX: lerp(0, dx * u) }, { translateY: lerp(0, dy * u) }, { scaleX: lerp(1, SIDE_FIELD.w / from.w) }, { scaleY: lerp(1, SIDE_FIELD.h / from.h) }],
            },
          ]}
        >
          <View style={[at(g, 3.5, from.h / 2 - 0.8, 20, 1.6), { borderRadius: 0.8 * u, backgroundColor: pal.text }]} />
        </Animated.View>
      </>
    );
  };
}

const CmdlField: Scene = ({ g, pal, p }) => {
  const t = tracker(p, 1300);
  const u = g.k;
  const c = g.card;
  const rect: Rect = { x: c.x + PILL.x - 2, y: c.y + PILL.y - 1.5, w: Math.min(78, c.w - PILL.x - 2), h: 38 };
  return (
    <>
      <Browser g={g} pal={pal} />
      <Panel
        g={g}
        pal={pal}
        rect={rect}
        style={{ opacity: t.in(260, 180), transform: [{ translateY: t([[260, -0.15 * rect.h * u], [580, 0]]) }, { scaleY: t([[260, 0.7], [580, 1]]) }] }}
      >
        <CommandPanel g={g} pal={pal} t={t} rect={rect} ms={420} field={<SelectedUrl g={g} pal={pal} />} />
      </Panel>
      <KeyPress g={g} pal={pal} t={t} label="⌘L" />
    </>
  );
};

const CmdlCentred: Scene = ({ g, pal, p }) => {
  const t = tracker(p, 1300);
  const u = g.k;
  const rect = centredPanel(g);
  return (
    <>
      <Browser g={g} pal={pal}>
        <Animated.View style={[fill, { backgroundColor: pal.scrim, opacity: t.in(220, 260) }]} />
      </Browser>
      <Panel
        g={g}
        pal={pal}
        rect={rect}
        style={{ opacity: t.in(260, 220), transform: [{ translateY: t([[260, -6 * u], [600, 0]]) }, { scale: t([[260, 0.95], [600, 1]]) }] }}
      >
        <CommandPanel g={g} pal={pal} t={t} rect={rect} ms={440} field={<SelectedUrl g={g} pal={pal} />} />
      </Panel>
      <KeyPress g={g} pal={pal} t={t} label="⌘L" />
    </>
  );
};

const NewTabOpensPage: Scene = ({ g, pal, p }) => {
  const t = tracker(p, 1300);
  const u = g.k;
  const c = g.card;
  return (
    <>
      <Lights g={g} pal={pal} />
      <Highlight g={g} pal={pal} y={rowY(0)} style={{ opacity: t.out(380, 200) }} />
      <SideRows g={g} pal={pal} n={3} />
      <TabRow g={g} pal={pal} i={4} y={rowY(3)} selected style={{ opacity: t.in(300, 240), transform: [{ translateX: t([[300, -6 * u], [580, 0]]) }] }} />
      <Card g={g} pal={pal} rect={c}>
        <Toolbar g={g} pal={pal} />
        <Animated.View style={[fill, { opacity: t.out(400, 200) }]}>
          <Page g={g} pal={pal} />
        </Animated.View>
        <Animated.View style={[fill, { opacity: t.in(480, 280), transform: [{ translateY: t([[480, 3 * u], [800, 0]]) }] }]}>
          <NewTabPage g={g} pal={pal} w={c.w} h={c.h} />
        </Animated.View>
      </Card>
      <KeyPress g={g} pal={pal} t={t} label="⌘T" />
    </>
  );
};

const NewTabOpensBar: Scene = ({ g, pal, p }) => {
  const t = tracker(p, 1300);
  const u = g.k;
  const rect = centredPanel(g);
  return (
    <>
      <Browser g={g} pal={pal}>
        <Animated.View style={[fill, { backgroundColor: pal.scrim, opacity: t.in(220, 260) }]} />
      </Browser>
      <Panel
        g={g}
        pal={pal}
        rect={rect}
        style={{ opacity: t.in(260, 220), transform: [{ translateY: t([[260, -6 * u], [600, 0]]) }, { scale: t([[260, 0.95], [600, 1]]) }] }}
      >
        <CommandPanel
          g={g}
          pal={pal}
          t={t}
          rect={rect}
          ms={440}
          field={
            <>
              <View style={[at(g, 11, 2.9, 0.6, 5.4), { borderRadius: 0.3 * g.k, backgroundColor: pal.link }]} />
              <View style={[at(g, 13, 4.7, 26, 1.6), { borderRadius: 0.8 * u, backgroundColor: pal.bar }]} />
            </>
          }
        />
      </Panel>
      <KeyPress g={g} pal={pal} t={t} label="⌘T" />
    </>
  );
};

function newTabAt(top: boolean): Scene {
  return ({ g, pal, p }) => {
    const t = tracker(p, 1100);
    const u = g.k;
    const shift = top ? { transform: [{ translateY: t([[200, 0], [520, ROW.pitch * u]]) }] } : null;
    return (
      <>
        <Lights g={g} pal={pal} />
        <Animated.View style={[fill, shift]}>
          <Highlight g={g} pal={pal} y={rowY(0)} style={{ opacity: t.out(280, 220) }} />
          <SideRows g={g} pal={pal} n={3} />
        </Animated.View>
        <TabRow
          g={g}
          pal={pal}
          i={4}
          y={rowY(top ? 0 : 3)}
          selected
          style={{
            opacity: t.in(top ? 320 : 220, 240),
            transform: top ? [{ translateX: t([[320, -6 * u], [600, 0]]) }] : [{ translateY: t([[220, -4 * u], [500, 0]]) }, { scale: t([[220, 0.92], [500, 1]]) }],
          }}
        />
        <Card g={g} pal={pal} rect={g.card}>
          <Toolbar g={g} pal={pal} />
          <Page g={g} pal={pal} />
        </Card>
      </>
    );
  };
}

function Clock({ g, pal, t, x, y }: { g: Geo; pal: Pal; t: Tracker; x: number; y: number }) {
  const d = 18;
  return (
    <View style={[at(g, x, y, d, d), { borderRadius: (d / 2) * g.k, backgroundColor: pal.panel, borderWidth: hairline(g) * 2, borderColor: pal.panelBorder }]}>
      <Animated.View style={[at(g, -hairline(g) * 2 / g.k, -hairline(g) * 2 / g.k, d, d), { transform: [{ rotate: t.deg([[100, 0], [850, 720]]) }] }]}>
        <View style={[at(g, d / 2 - 0.6, 3, 1.2, d / 2 - 3), { borderRadius: 0.6 * g.k, backgroundColor: pal.ink }]} />
      </Animated.View>
      <Animated.View style={[at(g, -hairline(g) * 2 / g.k, -hairline(g) * 2 / g.k, d, d), { transform: [{ rotate: t.deg([[100, 90], [850, 150]]) }] }]}>
        <View style={[at(g, d / 2 - 0.7, 5, 1.4, d / 2 - 5), { borderRadius: 0.7 * g.k, backgroundColor: pal.inkDim }]} />
      </Animated.View>
    </View>
  );
}

function tidy(auto: boolean): Scene {
  return ({ g, pal, p }) => {
    const t = tracker(p, 1500);
    const u = g.k;
    const c = g.card;
    const old = (i: number) => (auto ? { opacity: t([[850, 1], [1020, 0.4], [1100, 0.4], [1350, 0]]), transform: [{ translateX: t([[1100, 0], [1350, -5 * u]]) }, { scaleY: t([[1100, 1], [1350, 0.4]]) }] } : null);
    const rise = (n: number) => (auto ? { transform: [{ translateY: t([[1180, 0], [1480, -n * ROW.pitch * u]]) }] } : null);
    return (
      <>
        <Lights g={g} pal={pal} />
        <TabRow g={g} pal={pal} i={0} y={rowY(0)} selected />
        <TabRow g={g} pal={pal} i={1} y={rowY(1)} style={old(1)} />
        <TabRow g={g} pal={pal} i={2} y={rowY(2)} style={rise(1)} />
        <TabRow g={g} pal={pal} i={3} y={rowY(3)} style={old(3)} />
        <TabRow g={g} pal={pal} i={4} y={rowY(4)} style={old(4)} />
        <Card g={g} pal={pal} rect={c}>
          <Toolbar g={g} pal={pal} />
          <Page g={g} pal={pal} />
        </Card>
        <Clock g={g} pal={pal} t={t} x={c.x + c.w / 2 - 9} y={c.y + Math.min(c.h / 2 - 6, 30)} />
      </>
    );
  };
}

function quit(fresh: boolean): Scene {
  return ({ g, pal, p }) => {
    const t = tracker(p, 1500);
    const c = g.card;
    const away = { opacity: t([[180, 1], [420, 0]]), transform: [{ scale: t([[180, 1], [420, 0.94]]) }] };
    const back = { opacity: t([[760, 0], [1080, 1]]), transform: [{ scale: t([[760, 0.94], [1080, 1]]) }] };
    const both = { opacity: t([[180, 1], [420, 0], [760, 0], [1080, 1]]), transform: [{ scale: t([[180, 1], [420, 0.94], [760, 0.94], [1080, 1]]) }] };
    return (
      <>
        <Animated.View style={[fill, fresh ? away : both]}>
          <Browser g={g} pal={pal} rows={4} sel={1} />
        </Animated.View>
        {fresh ? (
          <Animated.View style={[fill, back]}>
            <Lights g={g} pal={pal} />
            <Card g={g} pal={pal} rect={c}>
              <Toolbar g={g} pal={pal} />
              <NewTabPage g={g} pal={pal} w={c.w} h={c.h} />
            </Card>
          </Animated.View>
        ) : null}
        <Keycap
          g={g}
          pal={pal}
          x={c.x + c.w - 4}
          y={c.y + c.h - 11.5}
          label="⌘Q"
          style={{ opacity: t.in(0, 160), transform: [{ scale: t([[0, 0.8], [240, 1]]) }] }}
        />
      </>
    );
  };
}

function MiniWindow({ g, pal, rect, children }: { g: Geo; pal: Pal; rect: Rect; children?: ReactNode }) {
  return (
    <View style={[atRect(g, rect), { borderRadius: 4 * g.k, backgroundColor: pal.frame, borderWidth: hairline(g), borderColor: pal.border, overflow: "hidden" }]}>
      {children}
    </View>
  );
}

const MINI_ROW = { x: 3, w: 23, top: 11, pitch: 8.5 } as const;

function windows(shared: boolean): Scene {
  return ({ g, pal, p }) => {
    const t = tracker(p, 1400);
    const u = g.k;
    const h = g.H - 10;
    const w = (g.W - 14) / 2;
    const a: Rect = { x: 5, y: 5, w, h };
    const b: Rect = { x: 9 + w, y: 5, w, h };
    const listA = [0, 1, 2, 3];
    const listB = shared ? listA : [4, 5, 1];
    const card = { x: 29, y: 3, w: w - 32, h: h - 6 };
    const cursorFrom = { x: a.x + w * 0.7, y: a.y + h * 0.75 };
    const cursorTo = { x: a.x + MINI_ROW.x + 14, y: a.y + MINI_ROW.top + 2 * MINI_ROW.pitch + 2.5 };
    const greyB = (i: number) => {
      if (!shared) return null;
      if (i === 0) return { opacity: t([[560, 0.35], [820, 1]]) };
      if (i === 2) return { opacity: t([[560, 1], [820, 0.35]]) };
      return null;
    };
    return (
      <>
        <MiniWindow g={g} pal={pal} rect={a}>
          <Lights g={g} pal={pal} x={4} y={4} />
          <Highlight g={g} pal={pal} x={MINI_ROW.x} y={MINI_ROW.top} w={MINI_ROW.w} style={{ transform: [{ translateY: t([[520, 0], [820, 2 * MINI_ROW.pitch * u]]) }] }} />
          {listA.map((i, n) => (
            <TabRow key={n} g={g} pal={pal} i={i} x={MINI_ROW.x} w={MINI_ROW.w} y={MINI_ROW.top + n * MINI_ROW.pitch} style={shared && n === 1 ? { opacity: 0.35 } : null} />
          ))}
          <Card g={g} pal={pal} rect={card}>
            <Animated.View style={[fill, { opacity: t.out(560, 200) }]}>
              <PageLines g={g} pal={pal} x={5} y={5} w={card.w - 10} h={card.h - 8} />
            </Animated.View>
            <Animated.View style={[fill, { opacity: t.in(600, 240) }]}>
              <PageLines g={g} pal={pal} x={5} y={5} w={card.w - 10} h={card.h - 8} seed={1} />
            </Animated.View>
          </Card>
        </MiniWindow>
        <MiniWindow g={g} pal={pal} rect={b}>
          <Lights g={g} pal={pal} x={4} y={4} />
          <Highlight g={g} pal={pal} x={MINI_ROW.x} y={MINI_ROW.top + MINI_ROW.pitch} w={MINI_ROW.w} />
          {listB.map((i, n) => (
            <TabRow key={n} g={g} pal={pal} i={i} x={MINI_ROW.x} w={MINI_ROW.w} y={MINI_ROW.top + n * MINI_ROW.pitch} style={greyB(n)} />
          ))}
          <Card g={g} pal={pal} rect={card}>
            <PageLines g={g} pal={pal} x={5} y={5} w={card.w - 10} h={card.h - 8} seed={shared ? 1 : 0} />
          </Card>
        </MiniWindow>
        <Cursor
          g={g}
          pal={pal}
          style={{
            opacity: t([[100, 0], [260, 1], [1100, 1], [1350, 0]]),
            transform: [
              { translateX: t([[100, cursorFrom.x * u], [460, cursorTo.x * u]]) },
              { translateY: t([[100, cursorFrom.y * u], [460, cursorTo.y * u]]) },
              { scale: t([[480, 1], [520, 0.8], [640, 1]], linear) },
            ],
          }}
        />
      </>
    );
  };
}

function WindowLook({ g, pal }: { g: Geo; pal: Pal }) {
  return (
    <View style={[at(g, 0, 0, g.W, g.H), { backgroundColor: pal.frame }]}>
      <Browser g={g} pal={pal} rows={4} sel={1} />
    </View>
  );
}

function Badge({ g, name, color, bg, border, x, y, style }: { g: Geo; name: string; color: string; bg: string; border: string; x: number; y: number; style?: object }) {
  const d = 16;
  return (
    <Animated.View style={[at(g, x - d / 2, y - d / 2, d, d), { borderRadius: (d / 2) * g.k, backgroundColor: bg, borderWidth: hairline(g), borderColor: border }, style]}>
      <Glyph g={g} name={name} size={11} color={color} x={2.5 - hairline(g) / g.k} y={2.5 - hairline(g) / g.k} />
    </Animated.View>
  );
}

const SUN = "#E3A21A";
const MOON = "#8E9AC4";

function appearance(mode: "light" | "dark" | "auto"): Scene {
  return ({ g, p }) => {
    const t = tracker(p, 1100);
    const u = g.k;
    const W = g.W;
    const edge = mode === "light" ? t([[150, 0], [650, W * u]]) : mode === "dark" ? t([[150, W * u], [650, 0]]) : t([[150, W * u], [700, (W / 2) * u]]);
    const inner = Animated.multiply(edge, -1);
    const c = g.card;
    const midY = c.y + Math.min(c.h / 2, 34);
    const pop = (ms: number) => ({ opacity: t.in(ms, 260), transform: [{ scale: t([[ms, 0.7], [ms + 320, 1]]) }, { rotate: t.deg([[ms, -40], [ms + 400, 0]]) }] });
    return (
      <>
        <WindowLook g={g} pal={LIGHT_WINDOW} />
        <Clip g={g} x={edge} inner={inner} width={W} height={g.H}>
          <WindowLook g={g} pal={DARK_WINDOW} />
        </Clip>
        {mode !== "dark" ? (
          <Badge g={g} name="sun.max.fill" color={SUN} bg={LIGHT_WINDOW.panel} border={LIGHT_WINDOW.panelBorder} x={mode === "auto" ? W / 4 + 12 : c.x + c.w / 2} y={midY} style={pop(mode === "auto" ? 520 : 480)} />
        ) : null}
        {mode !== "light" ? (
          <Badge g={g} name="moon.fill" color={MOON} bg={DARK_WINDOW.panel} border={DARK_WINDOW.panelBorder} x={mode === "auto" ? (W * 3) / 4 - 4 : c.x + c.w / 2} y={midY} style={pop(mode === "auto" ? 620 : 480)} />
        ) : null}
      </>
    );
  };
}

function siteColor(on: boolean): Scene {
  return ({ g, pal, p }) => {
    const t = tracker(p, 1300);
    const u = g.k;
    const c = g.card;
    return (
      <>
        <Lights g={g} pal={pal} />
        <SideRows g={g} pal={pal} n={3} sel={0} />
        <Card g={g} pal={pal} rect={c}>
          <Toolbar g={g} pal={pal} />
          <Animated.View style={[fill, { opacity: t.in(80, 320), transform: [{ translateY: t([[80, 4 * u], [440, 0]]) }] }]}>
            <SitePage g={g} pal={pal} w={c.w} h={c.h} y={TOOLBAR_H} />
          </Animated.View>
          {on ? (
            <Animated.View style={[at(g, 0, 0, c.w, TOOLBAR_H), { backgroundColor: SITE, opacity: t.in(560, 340) }]}>
              <View style={[at(g, 4, 3.75, 2.5, 2.5), { borderRadius: 1.25 * u, backgroundColor: "rgba(255,255,255,0.45)" }]} />
              <View style={[at(g, 8.2, 3.75, 2.5, 2.5), { borderRadius: 1.25 * u, backgroundColor: "rgba(255,255,255,0.45)" }]} />
              <View style={[atRect(g, PILL), { borderRadius: (PILL.h / 2) * u, backgroundColor: "rgba(255,255,255,0.22)" }]}>
                <View style={[at(g, 3.5, PILL.h / 2 - 0.8, 20, 1.6), { borderRadius: 0.8 * u, backgroundColor: "rgba(255,255,255,0.7)" }]} />
              </View>
            </Animated.View>
          ) : null}
        </Card>
      </>
    );
  };
}

const TYPED = "github";
const TYPE_AT = 160;
const TYPE_STEP = 75;
const TYPED_DONE = TYPE_AT + TYPED.length * TYPE_STEP;

function typed(search: boolean): Scene {
  return ({ g, pal, p }) => {
    const t = tracker(p, 1300);
    const u = g.k;
    const rect = centredPanel(g, 100);
    const size = 6;
    const caret = (from: number, to: number) => t([[from, 0], [from + 1, 1], [to, 1], [to + 1, 0]], linear);
    const text = (s: string, color: string, weight?: "500") => <Text style={{ fontSize: size * u, lineHeight: size * 1.4 * u, color, fontWeight: weight }}>{s}</Text>;
    const rowText = (main: string, rest: string, dim: boolean) => (
      <Text numberOfLines={1} style={{ fontSize: 5 * u, lineHeight: 7 * u, color: dim ? pal.inkDim : pal.ink }}>
        {main}
        <Text style={{ color: pal.inkDim }}>{rest}</Text>
      </Text>
    );
    const site = (dim: boolean) => (
      <>
        <View style={[at(g, 3, 2, 3, 3), { borderRadius: 1.5 * u, backgroundColor: dim ? pal.inkDim : pal.ink }]} />
        <View style={[at(g, 8.5, 0, rect.w - 14, 7)]}>{rowText("github.com", "", dim)}</View>
      </>
    );
    const query = (dim: boolean) => (
      <>
        <Glyph g={g} name="magnifyingglass" size={4.4} color={dim ? pal.inkDim : pal.ink} x={2.3} y={1.3} />
        <View style={[at(g, 8.5, 0, rect.w - 14, 7)]}>{rowText("github", " — Search", dim)}</View>
      </>
    );
    const first = search ? query(false) : site(false);
    const second = search ? site(true) : query(true);
    return (
      <>
        <Browser g={g} pal={pal}>
          <Animated.View style={[fill, { backgroundColor: pal.scrim, opacity: t.in(0, 200) }]} />
        </Browser>
        <Panel g={g} pal={pal} rect={rect} style={{ opacity: t.in(0, 200), transform: [{ translateY: t([[0, -4 * u], [300, 0]]) }] }}>
          <BarField g={g} pal={pal} w={rect.w}>
            <View style={[at(g, 11, 2.3, rect.w - 14, size * 1.4), { flexDirection: "row", alignItems: "center" }]}>
              <Animated.View style={{ position: "absolute", left: 0, width: 0.6 * u, height: 5.4 * u, borderRadius: 0.3 * u, backgroundColor: pal.link, opacity: caret(-1, TYPE_AT) }} />
              {TYPED.split("").map((ch, i) => (
                <Animated.View key={i} style={{ flexDirection: "row", alignItems: "center", opacity: t.step(TYPE_AT + i * TYPE_STEP) }}>
                  {text(ch, pal.ink)}
                  <Animated.View style={{ position: "absolute", right: -1.1 * u, width: 0.6 * u, height: 5.4 * u, borderRadius: 0.3 * u, backgroundColor: pal.link, opacity: caret(TYPE_AT + i * TYPE_STEP, i === TYPED.length - 1 ? (search ? 1300 : TYPED_DONE + 120) : TYPE_AT + (i + 1) * TYPE_STEP) }} />
                </Animated.View>
              ))}
              {search ? null : (
                <Animated.View style={{ opacity: t.step(TYPED_DONE + 120), backgroundColor: pal.link, borderRadius: 0.8 * u }}>
                  <View style={{ opacity: 0.9 }}>{text(".com", "#FFFFFF")}</View>
                </Animated.View>
              )}
            </View>
          </BarField>
          <Animated.View style={[at(g, 2, 13, rect.w - 4, 7), { borderRadius: 2 * u, backgroundColor: pal.hi, opacity: t.in(TYPED_DONE + 280, 200) }]} />
          <Animated.View style={[at(g, 2, 13, rect.w - 4, 7), { opacity: t.in(TYPED_DONE + 160, 200) }]}>{first}</Animated.View>
          <Animated.View style={[at(g, 2, 21, rect.w - 4, 7), { opacity: t.in(TYPED_DONE + 220, 200) }]}>{second}</Animated.View>
        </Panel>
      </>
    );
  };
}

function block(on: boolean): Scene {
  return ({ g, pal, p }) => {
    const t = tracker(p, 1300);
    const u = g.k;
    const c = g.card;
    const ad = (ms: number, gone: number) => ({
      opacity: on ? t([[ms, 0], [ms + 220, 1], [gone, 1], [gone + 220, 0]]) : t.in(ms, 220),
      transform: [{ scale: on ? t([[ms, 0.85], [ms + 260, 1], [gone, 1], [gone + 260, 0.6]]) : t([[ms, 0.85], [ms + 260, 1]]) }],
    });
    const adStyle = { borderRadius: 2 * u, backgroundColor: pal.card, borderWidth: hairline(g), borderColor: "rgba(253,208,35,0.8)", alignItems: "center" as const, justifyContent: "center" as const, overflow: "hidden" as const };
    const label = (
      <>
        <View style={[fill, { backgroundColor: AD, opacity: 0.22 }]} />
        <Text style={{ fontSize: 4.4 * u, lineHeight: 5.5 * u, fontWeight: "600", color: "#C99700" }}>Ad</Text>
      </>
    );
    return (
      <>
        <Lights g={g} pal={pal} />
        <SideRows g={g} pal={pal} n={3} sel={0} />
        <Card g={g} pal={pal} rect={c}>
          <Toolbar g={g} pal={pal} />
          <PageLines g={g} pal={pal} w={c.w - 50} h={c.h - 19} />
          <Animated.View style={[at(g, c.w - 34, 14, 27, Math.min(24, c.h - 34)), adStyle, ad(120, 820)]}>{label}</Animated.View>
          <Animated.View style={[at(g, 8, 41, c.w - 50, 9), adStyle, ad(200, 900)]}>{label}</Animated.View>
          <Animated.View
            style={[
              at(g, 4, c.h - 14, c.w - 8, 10),
              { borderRadius: 2.5 * u, backgroundColor: pal.panel, borderWidth: hairline(g), borderColor: pal.panelBorder },
              {
                opacity: on ? t([[280, 0], [420, 1], [980, 1], [1240, 0]]) : t.in(280, 140),
                transform: [{ translateY: on ? t([[280, 12 * u], [560, 0], [980, 0], [1240, 12 * u]]) : t([[280, 12 * u], [560, 0]]) }],
              },
            ]}
          >
            <View style={[at(g, 4, 4, c.w * 0.4, 1.8), { borderRadius: 0.9 * u, backgroundColor: pal.text }]} />
            <View style={[at(g, c.w - 24, 2.75, 14, 4.5), { borderRadius: 2.25 * u, backgroundColor: pal.inkDim }]} />
          </Animated.View>
          {on ? <Glyph g={g} name="checkmark.shield.fill" size={7} color={pal.link} x={c.w - 10} y={1.5} style={{ opacity: t.in(700, 200), transform: [{ scale: t([[700, 0.6], [960, 1]]) }] }} /> : null}
        </Card>
      </>
    );
  };
}

function links(little: boolean): Scene {
  return ({ g, pal, p }) => {
    const t = tracker(p, 1500);
    const u = g.k;
    const h = g.H - 10;
    const app: Rect = { x: 5, y: 5, w: 56, h };
    const ardia: Rect = { x: 65, y: 5, w: g.W - 70, h };
    const card = { x: 28, y: 3, w: ardia.w - 31, h: h - 6 };
    const link = { x: app.x + 4, y: app.y + 36, w: 42, h: 10 };
    const cursorFrom = { x: app.x + 46, y: app.y + h - 12 };
    const cursorTo = { x: link.x + 22, y: link.y + 4 };
    const float: Rect = { x: 40, y: 13, w: 74, h: Math.min(58, h - 10) };
    return (
      <>
        <View style={[atRect(g, app), { borderRadius: 4 * u, backgroundColor: pal.card, borderWidth: hairline(g), borderColor: pal.border }]}>
          <Lights g={g} pal={pal} x={4} y={4} />
          <View style={[at(g, 4, 13, 34, 8), { borderRadius: 4 * u, backgroundColor: pal.bar }]} />
          <View style={[at(g, 18, 24, 34, 8), { borderRadius: 4 * u, backgroundColor: pal.link, opacity: 0.35 }]} />
        </View>
        <View style={[atRect(g, link), { borderRadius: 4 * u, backgroundColor: pal.bar }]}>
          <Animated.View style={[fill, { borderRadius: 4 * u, backgroundColor: pal.hi, opacity: t([[470, 0], [520, 1], [700, 0]], linear) }]} />
          <View style={[at(g, 5, 4, 28, 1.8), { borderRadius: 0.9 * u, backgroundColor: pal.link }]} />
          <View style={[at(g, 5, 6.6, 28, hairline(g) / u), { backgroundColor: pal.link }]} />
        </View>
        <MiniWindow g={g} pal={pal} rect={ardia}>
          <Lights g={g} pal={pal} x={4} y={4} />
          <Highlight g={g} pal={pal} x={MINI_ROW.x} y={MINI_ROW.top} w={MINI_ROW.w} style={little ? undefined : { opacity: t.out(560, 200) }} />
          {[0, 1, 2].map((i) => (
            <TabRow key={i} g={g} pal={pal} i={i} x={MINI_ROW.x} w={MINI_ROW.w} y={MINI_ROW.top + i * MINI_ROW.pitch} />
          ))}
          {little ? null : (
            <TabRow
              g={g}
              pal={pal}
              i={0}
              x={MINI_ROW.x}
              w={MINI_ROW.w}
              y={MINI_ROW.top + 3 * MINI_ROW.pitch}
              selected
              style={{ opacity: t.in(560, 240), transform: [{ translateX: t([[560, -5 * u], [840, 0]]) }] }}
            />
          )}
          <Card g={g} pal={pal} rect={card}>
            <PageLines g={g} pal={pal} x={5} y={5} w={card.w - 10} h={card.h - 8} />
            {little ? null : (
              <Animated.View style={[fill, { backgroundColor: pal.card, opacity: t.in(640, 280) }]}>
                <SitePage g={g} pal={pal} w={card.w} h={card.h} />
              </Animated.View>
            )}
          </Card>
        </MiniWindow>
        {little ? (
          <Animated.View style={[atRect(g, float), { opacity: t.in(560, 220), transform: [{ translateY: t([[560, 8 * u], [880, 0]]) }, { scale: t([[560, 0.86], [880, 1]]) }] }]}>
            <View style={[at(g, 0.8, 1.6, float.w, float.h), { borderRadius: 4.5 * u, backgroundColor: pal.scrim }]} />
            <View style={[at(g, 0, 0, float.w, float.h), { borderRadius: 4.5 * u, backgroundColor: pal.card, borderWidth: hairline(g), borderColor: pal.panelBorder, overflow: "hidden" }]}>
              <Lights g={g} pal={pal} x={4} y={3.4} />
              <View style={[at(g, 19, 2.3, 34, 4.8), { borderRadius: 2.4 * u, backgroundColor: pal.bar }]} />
              <SitePage g={g} pal={pal} w={float.w} h={float.h} y={9.5} />
            </View>
          </Animated.View>
        ) : null}
        <Cursor
          g={g}
          pal={pal}
          style={{
            opacity: t([[60, 0], [200, 1], [1150, 1], [1400, 0]]),
            transform: [
              { translateX: t([[60, cursorFrom.x * u], [440, cursorTo.x * u]]) },
              { translateY: t([[60, cursorFrom.y * u], [440, cursorTo.y * u]]) },
              { scale: t([[460, 1], [500, 0.8], [620, 1]], linear) },
            ],
          }}
        />
      </>
    );
  };
}

export const DEMOS: Record<PreviewId, { duration: number; Scene: Scene }> = {
  "tabs-sidebar": { duration: 1200, Scene: TabsSidebar },
  "tabs-top": { duration: 1200, Scene: TabsTop },
  "address-toolbar": { duration: 1100, Scene: addressMove(false) },
  "address-sidebar": { duration: 1100, Scene: addressMove(true) },
  "cmdl-field": { duration: 1300, Scene: CmdlField },
  "cmdl-centred": { duration: 1300, Scene: CmdlCentred },
  "newtab-page": { duration: 1300, Scene: NewTabOpensPage },
  "newtab-commandbar": { duration: 1300, Scene: NewTabOpensBar },
  "newtabpos-bottom": { duration: 1100, Scene: newTabAt(false) },
  "newtabpos-top": { duration: 1100, Scene: newTabAt(true) },
  "tidy-keep": { duration: 1500, Scene: tidy(false) },
  "tidy-auto": { duration: 1500, Scene: tidy(true) },
  "quit-restore": { duration: 1500, Scene: quit(false) },
  "quit-fresh": { duration: 1500, Scene: quit(true) },
  "windows-separate": { duration: 1400, Scene: windows(false) },
  "windows-shared": { duration: 1400, Scene: windows(true) },
  "appearance-auto": { duration: 1100, Scene: appearance("auto") },
  "appearance-light": { duration: 1100, Scene: appearance("light") },
  "appearance-dark": { duration: 1100, Scene: appearance("dark") },
  "sitecolor-on": { duration: 1300, Scene: siteColor(true) },
  "sitecolor-off": { duration: 1300, Scene: siteColor(false) },
  "typed-website": { duration: 1300, Scene: typed(false) },
  "typed-search": { duration: 1300, Scene: typed(true) },
  "block-on": { duration: 1300, Scene: block(true) },
  "block-off": { duration: 1300, Scene: block(false) },
  "links-little": { duration: 1500, Scene: links(true) },
  "links-tab": { duration: 1500, Scene: links(false) },
};

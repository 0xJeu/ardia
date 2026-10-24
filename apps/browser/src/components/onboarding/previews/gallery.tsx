import { devSnapshotWindow } from "@ardia/shell";
import { useMemo, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { create } from "zustand";
import type { Settings } from "../../../store/settings";
import { closeSettingsSheet, showSettingsSheet } from "../../settings/sheet";
import { openSettings, SETTINGS_WINDOW_ID } from "../../settings/windows";
import { useOnboardingColors } from "../ui";
import { ChoiceFrame, ChoicePreview, usePreviewPalette } from "./ChoicePreview";
import { DEMOS } from "./demos";
import { PREVIEW_IDS, type PreviewId } from "./ids";
import { MockWindow } from "./MockWindow";

type MockState = { label: string; settings: Partial<Settings>; accent: string; focus: PreviewId | null };

type GalleryPage = { kind: "frames"; index: number } | { kind: "live"; index: number } | { kind: "mock"; index: number } | { kind: "mockLive" };

type GalleryState = { page: GalleryPage; active: boolean; mock: MockState };

const FRAME_POINTS = [0.2, 0.4, 0.65, 1] as const;
const FRAMES_PER_PAGE = 5;
const LIVE_PER_PAGE = 12;

const DIA: Partial<Settings> = { tabLayout: "sidebar", addressBar: "toolbar", appearance: "light", extendWebsiteColor: true };
const ARC: Partial<Settings> = { tabLayout: "sidebar", addressBar: "sidebar", appearance: "dark", extendWebsiteColor: true };

const MOCK_PAGES: MockState[][] = [
  [
    { label: "Dia preset, light, plum", settings: DIA, accent: "#C07A98", focus: null },
    { label: "Arc preset, dark, blue", settings: ARC, accent: "#4691C3", focus: null },
    { label: "Top tabs, auto split, green", settings: { tabLayout: "top", appearance: "auto", extendWebsiteColor: true }, accent: "#3EB489", focus: null },
    { label: "Top tabs, site color off, orange", settings: { tabLayout: "top", appearance: "light", extendWebsiteColor: false }, accent: "#D87249", focus: null },
  ],
  [
    { label: "focus cmdl-centred", settings: DIA, accent: "#C07A98", focus: "cmdl-centred" },
    { label: "focus typed-website, dark", settings: ARC, accent: "#4691C3", focus: "typed-website" },
    { label: "focus windows-shared", settings: DIA, accent: "#7873AF", focus: "windows-shared" },
    { label: "focus links-little, dark", settings: { ...ARC }, accent: "#E3AC38", focus: "links-little" },
  ],
];

const useGallery = create<GalleryState>(() => ({
  page: { kind: "frames", index: 0 },
  active: false,
  mock: { label: "live", settings: DIA, accent: "#C07A98", focus: null },
}));

function Label({ text }: { text: string }) {
  const colors = useOnboardingColors();
  return (
    <Text numberOfLines={1} style={{ fontSize: 10.5, lineHeight: 14, fontWeight: "500", color: colors.subtitle }}>
      {text}
    </Text>
  );
}

function FixedFrame({ id, at }: { id: PreviewId; at: number }) {
  const pal = usePreviewPalette();
  const p = useRef(new Animated.Value(at)).current;
  return <ChoiceFrame id={id} p={p} pal={pal} />;
}

function FramesPage({ index }: { index: number }) {
  const ids = PREVIEW_IDS.slice(index * FRAMES_PER_PAGE, (index + 1) * FRAMES_PER_PAGE);
  return (
    <View style={{ gap: 6 }}>
      {ids.map((id) => (
        <View key={id} style={{ gap: 2 }}>
          <Label text={`${id} · ${DEMOS[id].duration} ms · frames at ${FRAME_POINTS.map((f) => Math.round(f * DEMOS[id].duration)).join(" / ")} ms`} />
          <View style={{ flexDirection: "row", gap: 8 }}>
            {FRAME_POINTS.map((f) => (
              <FixedFrame key={f} id={id} at={f} />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

function LivePage({ index }: { index: number }) {
  const active = useGallery((s) => s.active);
  const ids = PREVIEW_IDS.slice(index * LIVE_PER_PAGE, (index + 1) * LIVE_PER_PAGE);
  const rows = useMemo(() => Array.from({ length: Math.ceil(ids.length / 2) }, (_, i) => ids.slice(i * 2, i * 2 + 2)), [index]);
  return (
    <View style={{ gap: 6 }}>
      {rows.map((pair) => (
        <View key={pair[0]} style={{ flexDirection: "row", gap: 8 }}>
          {pair.map((id) => (
            <View key={id} style={{ gap: 2 }}>
              <Label text={`${id} · inactive / active`} />
              <View style={{ flexDirection: "row", gap: 8 }}>
                <ChoicePreview id={id} active={false} />
                <ChoicePreview id={id} active={active} />
              </View>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function MockCell({ state, width, height }: { state: MockState; width: number; height: number }) {
  return (
    <View style={{ gap: 4 }}>
      <Label text={state.label} />
      <View style={{ width, height }}>
        <MockWindow settings={state.settings} accent={state.accent} focus={state.focus} />
      </View>
    </View>
  );
}

function MockPage({ index }: { index: number }) {
  const states = MOCK_PAGES[index] ?? [];
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16, width: 2 * 380 + 16 }}>
      {states.map((state) => (
        <MockCell key={state.label} state={state} width={380} height={271} />
      ))}
    </View>
  );
}

function MockLivePage() {
  const mock = useGallery((s) => s.mock);
  return <MockCell state={mock} width={420} height={300} />;
}

function PreviewGallery() {
  const colors = useOnboardingColors();
  const page = useGallery((s) => s.page);
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.card, paddingTop: 30, paddingHorizontal: 18 }]}>
      {page.kind === "frames" && <FramesPage index={page.index} />}
      {page.kind === "live" && <LivePage index={page.index} />}
      {page.kind === "mock" && <MockPage index={page.index} />}
      {page.kind === "mockLive" && <MockLivePage />}
    </View>
  );
}

function show(page: GalleryPage) {
  useGallery.setState({ page, active: false });
  showSettingsSheet(<PreviewGallery />);
  openSettings();
}

function play() {
  useGallery.setState({ active: false });
  setTimeout(() => useGallery.setState({ active: true }), 0);
}

function setMock(patch: Partial<MockState> & { settingsPatch?: Partial<Settings> }) {
  const { settingsPatch, ...rest } = patch;
  useGallery.setState((s) => ({ mock: { ...s.mock, ...rest, settings: { ...s.mock.settings, ...rest.settings, ...settingsPatch } } }));
}

const snapshot = (path: string) => devSnapshotWindow(SETTINGS_WINDOW_ID, path);

const pages = {
  frames: Math.ceil(PREVIEW_IDS.length / FRAMES_PER_PAGE),
  live: Math.ceil(PREVIEW_IDS.length / LIVE_PER_PAGE),
  mock: MOCK_PAGES.length,
};

(globalThis as { acOnboardingPreviews?: unknown }).acOnboardingPreviews = {
  store: useGallery,
  pages,
  show,
  hide: closeSettingsSheet,
  play,
  setMock,
  snapshot,
};

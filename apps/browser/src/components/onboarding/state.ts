import { launchEnvironment, readDocument, stopIntroMusic, writeDocument } from "@ardia/shell";
import { create } from "zustand";
import { useBrowser } from "../../store/browser";
import { resolveWindowId, tabLayoutOf } from "../../store/model";
import type { Settings } from "../../store/settings";
import type { ProfileColor } from "../../store/types";
import { pinSites } from "./sites";
import { endToolTour, startToolTour } from "./tour/state";

export type OnboardingStep = "intro" | "source" | "layout" | "tabs" | "look" | "searchPrivacy" | "pins" | "home" | "outro";

export const STEPS: OnboardingStep[] = ["intro", "source", "layout", "tabs", "look", "searchPrivacy", "pins", "home", "outro"];

export type Preset = "arc" | "dia";

export type BrowserSourceId = "arc" | "dia" | "chrome" | "safari" | "firefox" | "brave" | "edge" | "fresh";

export const PRESETS: Record<Preset, Partial<Settings>> = {
  dia: {
    addressBar: "toolbar",
    commandBarPlacement: "field",
    newTabOpens: "page",
    newTabPosition: "bottom",
    balancedTopApps: false,
    shareTabsAcrossWindows: false,
    cleanUpInactiveTabsAfterHours: null,
    openLinksInLittleArdia: true,
  },
  arc: {
    addressBar: "sidebar",
    commandBarPlacement: "centred",
    newTabOpens: "commandBar",
    newTabPosition: "top",
    balancedTopApps: true,
    shareTabsAcrossWindows: true,
    cleanUpInactiveTabsAfterHours: 12,
    openLinksInLittleArdia: true,
  },
};

export const presetFor = (source: BrowserSourceId | null): Preset => (source === "arc" ? "arc" : "dia");

export type Extras = {
  color: ProfileColor;
  appIcon: string;
  block: boolean;
  share: boolean;
  pins: string[];
  setDefault: boolean;
  trial: boolean;
  dock: boolean;
  login: boolean;
};

type LiveBaseline = Partial<Settings> & { color?: ProfileColor };

type OnboardingState = {
  windowId: string | null;
  step: OnboardingStep;
  leaving: boolean;
  session: number;
  tourAfter: boolean;
  preset: Preset;
  source: BrowserSourceId | null;
  draft: Partial<Settings>;
  extras: Partial<Extras>;
  baseline: LiveBaseline;
  confirmed: OnboardingStep[];
  picked: Partial<Record<OnboardingStep, string[]>>;
  go(step: OnboardingStep): void;
  next(): void;
  back(): void;
  chooseSource(source: BrowserSourceId | null): void;
  setDraft(patch: Partial<Settings>): void;
  setExtras(patch: Partial<Extras>): void;
  previewLive(patch: Partial<Settings>): void;
  previewColor(color: ProfileColor): void;
  confirm(step: OnboardingStep, patch: Partial<Settings>, picked: string[]): void;
  skip(step: OnboardingStep, keys: readonly (keyof Settings)[]): void;
};

const stepAfter = (step: OnboardingStep, delta: number) => STEPS[STEPS.indexOf(step) + delta];

export const useOnboarding = create<OnboardingState>((set, get) => ({
  windowId: null,
  step: "intro",
  leaving: false,
  session: 0,
  tourAfter: false,
  preset: "dia",
  source: null,
  draft: {},
  extras: {},
  baseline: {},
  confirmed: [],
  picked: {},
  go(step) {
    set({ step });
    save({ step });
  },
  next() {
    const step = stepAfter(get().step, 1);
    if (step) get().go(step);
    else finishOnboarding();
  },
  back() {
    const step = stepAfter(get().step, -1);
    if (step && step !== "intro") get().go(step);
  },
  chooseSource(source) {
    const preset = presetFor(source);
    set({ source, preset });
    save({ source, preset });
  },
  setDraft(patch) {
    set((s) => ({ draft: { ...s.draft, ...patch } }));
  },
  setExtras(patch) {
    set((s) => ({ extras: { ...s.extras, ...patch } }));
  },
  previewLive(patch) {
    const { windowId, baseline } = get();
    const b = useBrowser.getState();
    const window = windowId ? b.windows[windowId] : undefined;
    const recorded: LiveBaseline = { ...baseline };
    for (const key of Object.keys(patch) as (keyof Settings)[]) {
      if (key in recorded) continue;
      Object.assign(recorded, { [key]: key === "tabLayout" ? tabLayoutOf(b, windowId) : b.settings[key] });
    }
    set({ baseline: recorded });
    const { tabLayout, ...rest } = patch;
    if (tabLayout && window && tabLayoutOf(b, windowId) !== tabLayout) {
      useBrowser.setState((s) => ({ windows: { ...s.windows, [window.id]: { ...s.windows[window.id]!, tabLayout } } }));
    }
    if (Object.keys(rest).length) b.updateSettings(rest, { fromSync: true });
  },
  previewColor(color) {
    const { windowId, baseline } = get();
    const b = useBrowser.getState();
    const profileId = windowId ? b.windows[windowId]?.profileId : undefined;
    if (!profileId) return;
    if (!("color" in baseline)) set({ baseline: { ...baseline, color: b.profiles[profileId]?.color } });
    b.updateProfile(profileId, { color });
  },
  confirm(step, patch, picked) {
    const { windowId, baseline } = get();
    const { tabLayout } = patch;
    if (tabLayout) {
      useBrowser.setState((s) => {
        const w = windowId ? s.windows[windowId] : undefined;
        return w ? { windows: { ...s.windows, [w.id]: { ...w, tabLayout } } } : {};
      });
    }
    if (Object.keys(patch).length) useBrowser.getState().updateSettings(patch);
    const kept: LiveBaseline = { ...baseline };
    for (const key of Object.keys(patch)) delete kept[key as keyof LiveBaseline];
    if (step === "look") delete kept.color;
    const confirmed = get().confirmed.includes(step) ? get().confirmed : [...get().confirmed, step];
    const all = { ...get().picked, [step]: picked };
    set({ baseline: kept, confirmed, picked: all });
    save({ picked: all });
    get().next();
  },
  skip(step, keys) {
    revertLive([...keys, ...(step === "look" ? (["color"] as const) : [])]);
    set((s) => {
      const draft = { ...s.draft };
      for (const key of keys) delete draft[key];
      return { draft };
    });
    get().next();
  },
}));

function revertLive(keys: readonly (keyof LiveBaseline)[]) {
  const { windowId, baseline } = useOnboarding.getState();
  const restore = Object.fromEntries(keys.filter((k) => k in baseline).map((k) => [k, baseline[k]])) as LiveBaseline;
  if (!Object.keys(restore).length) return;
  const { color, tabLayout, ...rest } = restore;
  const b = useBrowser.getState();
  const window = windowId ? b.windows[windowId] : undefined;
  if (tabLayout && window) useBrowser.setState((s) => ({ windows: { ...s.windows, [window.id]: { ...s.windows[window.id]!, tabLayout } } }));
  if (Object.keys(rest).length) b.updateSettings(rest, { fromSync: true });
  if (color && window) b.updateProfile(window.profileId, { color });
  const kept = { ...baseline };
  for (const key of keys) delete kept[key];
  useOnboarding.setState({ baseline: kept });
}

export function resolveDraft<K extends keyof Settings>(
  keys: readonly K[],
  draft: Partial<Settings>,
  preset: Preset,
  settings: Settings,
): Pick<Settings, K> {
  const presetValues = PRESETS[preset];
  const chosen = settings.chosen ?? [];
  return Object.fromEntries(
    keys.map((k) => [k, k in draft ? draft[k] : k in presetValues && !chosen.includes(k) ? presetValues[k] : settings[k]]),
  ) as Pick<Settings, K>;
}

const DOC = "onboarding.json";
type Saved = {
  version: 1;
  startedAt?: number;
  completedAt: number | null;
  step?: OnboardingStep;
  source?: BrowserSourceId | null;
  preset?: Preset;
  picked?: Partial<Record<OnboardingStep, string[]>>;
  defaultBrowserTrialStartedAt?: number;
  defaultBrowserCheckInDoneAt?: number;
  introMusicMuted?: boolean;
};

function readSaved(): Saved | null {
  try {
    const json = readDocument(DOC);
    return json ? (JSON.parse(json) as Saved) : null;
  } catch {
    return null;
  }
}

function save(patch: Partial<Saved>) {
  try {
    writeDocument(DOC, JSON.stringify({ version: 1, completedAt: null, ...readSaved(), ...patch } satisfies Saved));
  } catch (error) {
    console.warn("Couldn't save onboarding state", error);
  }
}

const markCompleted = () => save({ completedAt: Date.now() });

export const recordDefaultBrowserTrial = () => save({ defaultBrowserTrialStartedAt: Date.now() });

export const defaultBrowserTrialStartedAt = () => readSaved()?.defaultBrowserTrialStartedAt ?? null;

export const defaultBrowserCheckInDoneAt = () => readSaved()?.defaultBrowserCheckInDoneAt ?? null;
export const recordDefaultBrowserCheckInDone = () => save({ defaultBrowserCheckInDoneAt: Date.now() });

export const onboardingCompletedAt = () => readSaved()?.completedAt ?? null;

export const introMusicMuted = () => readSaved()?.introMusicMuted ?? false;
export const saveIntroMusicMuted = (muted: boolean) => save({ introMusicMuted: muted });

const FRESH = { preset: "dia", source: null, draft: {}, extras: {}, baseline: {}, confirmed: [], picked: {} } satisfies Partial<OnboardingState>;

export function startOnboarding(windowId?: string | null, step: OnboardingStep = "intro") {
  const id = resolveWindowId(useBrowser.getState(), windowId);
  if (!id) return;
  endToolTour();
  useOnboarding.setState((s) => ({ ...FRESH, windowId: id, step, leaving: false, tourAfter: false, session: s.session + 1 }));
  save({ step, source: null, preset: "dia", picked: {} });
}

function resumeOnboarding(saved: Saved) {
  const id = resolveWindowId(useBrowser.getState(), null);
  if (!id) return;
  const step = saved.step && STEPS.includes(saved.step) && saved.step !== "intro" ? saved.step : "source";
  const source = saved.source ?? null;
  useOnboarding.setState((s) => ({
    ...FRESH,
    windowId: id,
    step,
    source,
    preset: saved.preset ?? presetFor(source),
    picked: saved.picked ?? {},
    confirmed: Object.keys(saved.picked ?? {}) as OnboardingStep[],
    leaving: false,
    tourAfter: false,
    session: s.session + 1,
  }));
}

export function finishOnboarding(options: { tour?: boolean } = {}) {
  revertLive(Object.keys(useOnboarding.getState().baseline) as (keyof LiveBaseline)[]);
  markCompleted();
  stopIntroMusic(0.6);
  const { windowId } = useOnboarding.getState();
  if (windowId) useOnboarding.setState({ leaving: true, tourAfter: !!options.tour });
}

export function dismissOnboarding(session: number) {
  const { session: current, windowId, tourAfter } = useOnboarding.getState();
  if (current !== session) return;
  useOnboarding.setState({ windowId: null, step: "intro", leaving: false, tourAfter: false });
  if (tourAfter && windowId) startToolTour(windowId);
}

export function maybeStartOnboarding() {
  const saved = readSaved();
  if (saved?.completedAt) return;
  if (saved?.startedAt) return resumeOnboarding(saved);
  if (readDocument("session.json")) return markCompleted();
  if (__DEV__ && launchEnvironment("ARDIA_ONBOARDING") !== "1") return;
  save({ startedAt: Date.now() });
  startOnboarding();
}

if (__DEV__) (globalThis as { acOnboarding?: unknown }).acOnboarding = {
    store: useOnboarding,
    start: startOnboarding,
    finish: finishOnboarding,
    pinSites,
    resolveDraft,
    PRESETS,
  };

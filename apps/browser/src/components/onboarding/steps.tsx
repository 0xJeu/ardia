import {
  addToDock,
  backgroundInstance,
  isDefaultBrowser,
  isInDock,
  launchAtLoginStatus,
  setAsDefaultBrowser,
  setLaunchAtLogin,
  Symbol,
} from "@ardia/shell";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useBrowser } from "../../store/browser";
import { Favicon, useHover } from "../primitives";
import { CONTENT_WIDTH, ChoicePair, ScrollToEnd } from "./choices";
import type { PreviewId } from "./previews";
import { PINNABLE_SITES, pinSites, preselectedSites } from "./sites";
import { finishOnboarding, recordDefaultBrowserTrial, resolveDraft, STEPS, useOnboarding, type OnboardingStep } from "./state";
import { BackButton, CheckMark, CheckRow, PrimaryButton, Reveal, SecondaryButton, StepProgress, StepTitle, useOnboardingColors } from "./ui";

const ICON = require("../../../assets/app-icon.png");

const COLUMN = { width: CONTENT_WIDTH + 56, padding: 28 };

export function StepLayout({
  title,
  subtitle,
  tag,
  children,
  actions,
  preview,
}: {
  title: string;
  subtitle?: string;
  tag?: ReactNode;
  children?: ReactNode;
  actions: ReactNode;
  preview: ReactNode;
}) {
  const colors = useOnboardingColors();
  const scroll = useRef<ScrollView>(null);
  const [box, setBox] = useState({ height: 0, content: 0, offset: 0 });
  const [scrollToEnd] = useState(() => () => setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 30));
  return (
    <View style={{ flex: 1, flexDirection: "row" }}>
      <View style={{ width: COLUMN.width, paddingTop: 34, paddingBottom: 28 }}>
        <View style={{ gap: 20, paddingHorizontal: COLUMN.padding }}>
          <Reveal>
            <StepProgress />
          </Reveal>
          <Reveal delay={60} style={{ gap: 10 }}>
            <StepTitle title={title} subtitle={subtitle} />
            {tag ? <View style={{ flexDirection: "row" }}>{tag}</View> : null}
          </Reveal>
        </View>
        <View style={{ flex: 1, marginTop: 18 }}>
          <ScrollView
            ref={scroll}
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: COLUMN.padding, paddingBottom: 12 }}
            showsVerticalScrollIndicator={false}
            scrollEventThrottle={32}
            onLayout={(e) => {
              const height = e.nativeEvent.layout.height;
              setBox((b) => ({ ...b, height }));
            }}
            onContentSizeChange={(_, content) => setBox((b) => ({ ...b, content }))}
            onScroll={(e) => {
              const offset = e.nativeEvent.contentOffset.y;
              setBox((b) => ({ ...b, offset }));
            }}
          >
            <ScrollToEnd.Provider value={scrollToEnd}>
              <Reveal delay={140} style={{ gap: 16 }}>
                {children}
              </Reveal>
            </ScrollToEnd.Provider>
          </ScrollView>
          {box.content - box.offset - box.height > 4 ? <BottomFade color={colors.card} /> : null}
        </View>
        <Reveal delay={240} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: COLUMN.padding, paddingTop: 14 }}>
          {actions}
        </Reveal>
      </View>
      <View
        style={{
          flex: 1,
          margin: 12,
          marginLeft: 0,
          borderRadius: 14,
          backgroundColor: colors.preview,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: colors.previewBorder,
          overflow: "hidden",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Reveal delay={120} style={{ alignItems: "center", justifyContent: "center" }}>
          {preview}
        </Reveal>
      </View>
    </View>
  );
}

const FADE = [0.06, 0.16, 0.3, 0.48, 0.68, 0.86];

function BottomFade({ color }: { color: string }) {
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}>
      {FADE.map((opacity) => (
        <View key={opacity} style={{ height: 4, backgroundColor: color, opacity }} />
      ))}
    </View>
  );
}

export function StepActions({
  onContinue,
  continueTitle = "Continue",
  disabled,
  onSkip,
  icon,
}: {
  onContinue: () => void;
  continueTitle?: string;
  disabled?: boolean;
  onSkip?: () => void;
  icon?: string;
}) {
  const step = useOnboarding((s) => s.step);
  const back = useOnboarding((s) => s.back);
  const first = STEPS[STEPS.indexOf(step) - 1] === "intro";
  return (
    <>
      {first ? null : <BackButton onPress={back} />}
      <PrimaryButton title={continueTitle} icon={icon} onPress={onContinue} disabled={disabled} />
      {onSkip ? <SecondaryButton title="Skip" onPress={onSkip} /> : null}
    </>
  );
}

type SystemState = { isDefault: boolean; inDock: boolean; loginEnabled: boolean };

const LINK_CHOICES = [
  { value: true, preview: "links-little" as PreviewId, title: "Little Ardia", subtitle: "A small, passing window" },
  { value: false, preview: "links-tab" as PreviewId, title: "A new tab", subtitle: "In your main window" },
];

export function HomeStep() {
  const draft = useOnboarding((s) => s.draft);
  const preset = useOnboarding((s) => s.preset);
  const extras = useOnboarding((s) => s.extras);
  const settings = useBrowser((s) => s.settings);
  const { openLinksInLittleArdia: little } = resolveDraft(["openLinksInLittleArdia"], draft, preset, settings);
  const [system, setSystem] = useState<SystemState | null>(null);
  const [busy, setBusy] = useState(false);
  const setDefault = extras.setDefault ?? !backgroundInstance;
  const trial = extras.trial ?? false;
  const dock = extras.dock ?? true;
  const login = extras.login ?? system?.loginEnabled ?? false;
  const { setDraft, setExtras } = useOnboarding.getState();

  useEffect(() => {
    void Promise.all([isDefaultBrowser(), isInDock(), launchAtLoginStatus()]).then(([isDefault, inDock, login]) =>
      setSystem({ isDefault, inDock, loginEnabled: login === "enabled" }),
    );
  }, []);

  const apply = async () => {
    if (!system) return;
    setBusy(true);
    const picked: string[] = [];
    try {
      if (!system.isDefault && (setDefault || trial) && (await setAsDefaultBrowser())) {
        if (!setDefault) recordDefaultBrowserTrial();
        picked.push(setDefault ? "Ardia is your default browser" : "A week as your default browser");
      }
      if (login !== system.loginEnabled) await setLaunchAtLogin(login).catch(() => {});
      if (dock && !system.inDock) await addToDock();
    } finally {
      setBusy(false);
      if (!picked.length) picked.push(little ? "Links from other apps open in Little Ardia" : "Links from other apps open in a tab");
      useOnboarding.getState().confirm("home", { openLinksInLittleArdia: little }, picked);
    }
  };

  const defaultOn = system?.isDefault || setDefault;
  const trying = !defaultOn && trial;
  return (
    <StepLayout
      title="Make it home"
      subtitle="Ardia works best as your default browser."
      actions={
        <StepActions
          continueTitle={busy ? "Setting Up…" : "Continue"}
          disabled={!system || busy}
          onContinue={() => void apply()}
          onSkip={() => useOnboarding.getState().skip("home", ["openLinksInLittleArdia"])}
        />
      }
      preview={<SystemPreview isDefault={!!(defaultOn || trying)} dock={!!(system?.inDock || dock)} login={login} little={little} />}
    >
      <View style={{ gap: 6 }}>
        <CheckRow
          icon="globe"
          title="Set Ardia as default browser"
          subtitle={system?.isDefault ? "Ardia is already your default browser" : "Open links and web pages in Ardia by default"}
          value={!!defaultOn}
          disabled={!system || system.isDefault}
          onChange={(v) => setExtras({ setDefault: v })}
        />
        {system && !defaultOn ? (
          <CheckRow
            icon="calendar"
            title="Try Ardia as your default for seven days"
            subtitle="We'll check in to make sure you love it."
            value={trial}
            onChange={(v) => setExtras({ trial: v })}
          />
        ) : null}
        {system && !system.inDock ? (
          <CheckRow icon="dock.rectangle" title="Add Ardia to Dock" subtitle="Quick access whenever you need it" value={dock} onChange={(v) => setExtras({ dock: v })} />
        ) : null}
        <CheckRow icon="power" title="Open Ardia at login" subtitle="Ready when you sign in" value={login} onChange={(v) => setExtras({ login: v })} />
      </View>
      <ChoicePair label="Links from other apps open in" options={LINK_CHOICES} value={little} onChange={(v) => setDraft({ openLinksInLittleArdia: v })} />
    </StepLayout>
  );
}

function SystemPreview({ isDefault, dock, login, little }: { isDefault: boolean; dock: boolean; login: boolean; little: boolean }) {
  const colors = useOnboardingColors();
  const chip = (on: boolean, icon: string, label: string) => (
    <View
      key={label}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        height: 34,
        paddingLeft: 12,
        paddingRight: 10,
        borderRadius: 17,
        backgroundColor: colors.row,
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: colors.rowBorder,
        opacity: on ? 1 : 0.45,
      }}
    >
      <Symbol name={icon} size={13} color={colors.title} style={{ width: 16, height: 16 }} />
      <Text style={{ fontSize: 12, fontWeight: "500", color: colors.title }}>{label}</Text>
      <CheckMark on={on} size={16} />
    </View>
  );
  return (
    <View style={{ alignItems: "center", gap: 28 }}>
      <Image source={ICON} style={{ width: 132, height: 132 }} />
      <View style={{ gap: 8, alignItems: "center" }}>
        {chip(isDefault, "globe", "Default browser")}
        {chip(dock, "dock.rectangle", "In your Dock")}
        {chip(login, "power", "Opens at login")}
        {chip(true, little ? "macwindow.on.rectangle" : "plus.square.on.square", little ? "Links in Little Ardia" : "Links in a new tab")}
      </View>
    </View>
  );
}

export function PinnedTabsStep() {
  const windowId = useOnboarding((s) => s.windowId);
  const chosen = useOnboarding((s) => s.extras.pins);
  const history = useBrowser((s) => s.history[s.windows[windowId ?? ""]?.profileId ?? ""]);
  const suggested = useRef<string[] | null>(null);
  if (!chosen) suggested.current = preselectedSites(history ?? []);
  const selected = chosen ?? suggested.current ?? [];

  const toggle = (id: string) =>
    useOnboarding.getState().setExtras({ pins: selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id] });

  const pinSelected = () => {
    if (windowId && selected.length) pinSites(windowId, selected);
    useOnboarding.getState().confirm("pins", {}, selected.length ? [`${selected.length} ${selected.length === 1 ? "app" : "apps"} pinned`] : []);
  };

  return (
    <StepLayout
      title="Keep your favorite apps handy"
      subtitle="Pin the apps you use most. They stay put when you open Ardia."
      actions={
        <StepActions
          continueTitle={selected.length ? `Pin ${selected.length} ${selected.length === 1 ? "Tab" : "Tabs"}` : "Continue"}
          onContinue={pinSelected}
          onSkip={() => useOnboarding.getState().skip("pins", [])}
        />
      }
      preview={<PinnedPreview selected={selected} />}
    >
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {PINNABLE_SITES.map((site) => (
          <SiteTile key={site.id} title={site.title} url={site.url} selected={selected.includes(site.id)} onPress={() => toggle(site.id)} />
        ))}
      </View>
    </StepLayout>
  );
}

function SiteTile({ title, url, selected, onPress }: { title: string; url: string; selected: boolean; onPress: () => void }) {
  const colors = useOnboardingColors();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps}>
      <Pressable onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} accessibilityLabel={title}>
        {({ pressed }) => (
          <View
            mouseDownCanMoveWindow={false}
            style={{
              width: 80,
              height: 70,
              borderRadius: 12,
              alignItems: "center",
              justifyContent: "center",
              gap: 7,
              backgroundColor: selected || hovered ? colors.button : colors.row,
              borderWidth: selected ? 1.5 : StyleSheet.hairlineWidth * 2,
              borderColor: selected ? colors.title : colors.rowBorder,
              transform: [{ scale: pressed ? 0.96 : 1 }],
            }}
          >
            <View style={{ opacity: selected || hovered ? 1 : 0.7 }}>
              <Favicon url={url} size={22} />
            </View>
            <Text style={{ fontSize: 11, fontWeight: "500", color: selected ? colors.title : colors.subtitle }}>{title}</Text>
            {selected ? (
              <View style={{ position: "absolute", top: 5, right: 5 }}>
                <CheckMark on size={14} />
              </View>
            ) : null}
          </View>
        )}
      </Pressable>
    </View>
  );
}

function PinnedPreview({ selected }: { selected: string[] }) {
  const colors = useOnboardingColors();
  const sites = PINNABLE_SITES.filter((s) => selected.includes(s.id));
  const slots = Math.max(6, Math.ceil(sites.length / 3) * 3);
  return (
    <View style={{ width: 236, padding: 14, borderRadius: 14, backgroundColor: colors.row, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.rowBorder, gap: 12 }}>
      <View style={{ flexDirection: "row", gap: 6 }}>
        {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
          <View key={c} style={{ width: 9, height: 9, borderRadius: 4.5, backgroundColor: c }} />
        ))}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {Array.from({ length: slots }, (_, i) => {
          const site = sites[i];
          return (
            <View
              key={site?.id ?? `empty-${i}`}
              style={{
                width: 64,
                height: 40,
                borderRadius: 9,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: site ? colors.button : "transparent",
                borderWidth: site ? 0 : 1,
                borderStyle: "dashed",
                borderColor: colors.rowBorder,
              }}
            >
              {site ? <Favicon url={site.url} size={18} /> : null}
            </View>
          );
        })}
      </View>
      <View style={{ height: StyleSheet.hairlineWidth * 2, backgroundColor: colors.separator }} />
      {[0.7, 0.5, 0.6].map((w, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 8, height: 22 }}>
          <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: colors.progressTrack }} />
          <View style={{ height: 6, borderRadius: 3, width: `${w * 100}%`, backgroundColor: colors.progressTrack }} />
        </View>
      ))}
    </View>
  );
}

export function OutroStep() {
  const colors = useOnboardingColors();
  const picked = useOnboarding((s) => s.picked);
  const lines = STEPS.flatMap((step: OnboardingStep) => picked[step] ?? []);
  return (
    <StepLayout
      title={"Welcome to your new\nhome on the internet"}
      subtitle="Everything you set up is saved. Change any of it later in Settings."
      actions={
        <>
          <StepActions icon="arrow.right" continueTitle="Get Started" onContinue={() => finishOnboarding()} />
          <SecondaryButton title="Take the Tour" onPress={() => finishOnboarding({ tour: true })} />
        </>
      }
      preview={<Postcard lines={lines} />}
    >
      <View style={{ gap: 10 }}>
        {[
          ["⌘T", "Open a new tab"],
          ["⌘L", "Go anywhere from the command bar"],
          ["⌘S", "Hide the sidebar for more room"],
        ].map(([keys, label]) => (
          <View key={keys} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={{ minWidth: 38, height: 24, paddingHorizontal: 7, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: colors.button }}>
              <Text style={{ fontSize: 12, fontWeight: "500", color: colors.title }}>{keys}</Text>
            </View>
            <Text style={{ fontSize: 13, color: colors.subtitle }}>{label}</Text>
          </View>
        ))}
      </View>
    </StepLayout>
  );
}

function Postcard({ lines }: { lines: string[] }) {
  const colors = useOnboardingColors();
  const shown = lines.slice(0, 8);
  return (
    <View
      style={{
        width: 340,
        minHeight: 210,
        borderRadius: 6,
        padding: 18,
        flexDirection: "row",
        backgroundColor: colors.card,
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: colors.rowBorder,
        transform: [{ rotate: "-3deg" }],
      }}
    >
      <View style={{ flex: 1, gap: 10, paddingRight: 14 }}>
        <Text style={{ fontSize: 20, fontWeight: "300", fontStyle: "italic", color: colors.title }}>Hello!</Text>
        {shown.length ? (
          <View style={{ gap: 4 }}>
            <Text style={{ fontSize: 11, lineHeight: 15, color: colors.subtitle }}>{"You picked:"}</Text>
            {shown.map((line) => (
              <View key={line} style={{ flexDirection: "row", gap: 6, alignItems: "flex-start" }}>
                <Symbol name="checkmark" size={8} weight="bold" color={colors.title} style={{ width: 10, height: 15 }} />
                <Text style={{ flex: 1, fontSize: 11, lineHeight: 15, color: colors.title }}>{line}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={{ fontSize: 12, lineHeight: 17, color: colors.subtitle }}>
            {"Glad you're here. Make yourself at home. Your tabs, bookmarks and pins are ready."}
          </Text>
        )}
      </View>
      <View style={{ width: StyleSheet.hairlineWidth * 2, backgroundColor: colors.separator }} />
      <View style={{ width: 96, paddingLeft: 14, justifyContent: "space-between", alignItems: "flex-end" }}>
        <View style={{ padding: 4, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.rowBorder, borderRadius: 3 }}>
          <Image source={ICON} style={{ width: 46, height: 46 }} />
        </View>
        <View style={{ alignSelf: "stretch", gap: 12 }}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={{ height: 1, backgroundColor: colors.separator }} />
          ))}
        </View>
      </View>
      <View
        style={{
          position: "absolute",
          right: 50,
          top: 52,
          width: 44,
          height: 44,
          borderRadius: 22,
          borderWidth: 1,
          borderColor: colors.steps,
          alignItems: "center",
          justifyContent: "center",
          transform: [{ rotate: "-12deg" }],
        }}
      >
        <Text numberOfLines={1} style={{ fontSize: 6, fontWeight: "700", letterSpacing: 0.4, color: colors.steps }}>
          WELCOME
        </Text>
      </View>
    </View>
  );
}

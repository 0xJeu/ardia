import { Symbol, VisualEffect, WindowDragRegion } from "@ardia/shell";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { trackSettingsSection } from "../../telemetry/track";
import { IconButton, useHover } from "../primitives";
import { useFormColors } from "./controls";
import { preparePane, usePaneLoaded } from "./paneData";
import { AdvancedPane } from "./panes/Advanced";
import { AppearancePane } from "./panes/Appearance";
import { CalendarPane } from "./panes/Calendar";
import { GeneralPane } from "./panes/General";
import { LiveFoldersPane } from "./panes/LiveFolders";
import { ExtensionsPane } from "./panes/Extensions";
import { PasswordsPane } from "./panes/Passwords";
import { AutofillPane } from "./panes/Autofill";
import { PrivacyPane } from "./panes/Privacy";
import { ProfileDetailsPane, ProfilesPane } from "./panes/Profiles";
import { SearchPane } from "./panes/Search";
import { ShortcutsPane } from "./panes/Shortcuts";
import { SyncPane } from "./panes/Sync";
import { TabsPane } from "./panes/Tabs";
import { useSettingsSheet } from "./sheet";
import { useSettingsNav, type SettingsPane } from "./windows";

const PANES: { id: SettingsPane; title: string; icon: string }[] = [
  { id: "general", title: "General", icon: "gearshape" },
  { id: "profiles", title: "Profiles", icon: "person.2" },
  { id: "sync", title: "Sync", icon: "arrow.triangle.2.circlepath" },
  { id: "tabs", title: "Tabs", icon: "square.on.square" },
  { id: "appearance", title: "Appearance", icon: "circle.lefthalf.filled" },
  { id: "privacy", title: "Privacy & Security", icon: "hand.raised" },
  { id: "passwords", title: "Passwords", icon: "key" },
  { id: "autofill", title: "Autofill", icon: "creditcard" },
  { id: "extensions", title: "Extensions", icon: "puzzlepiece.extension" },
  { id: "search", title: "Search Engine", icon: "magnifyingglass" },
  { id: "shortcuts", title: "Keyboard Shortcuts", icon: "keyboard" },
  { id: "liveFolders", title: "Live Folders", icon: "dot.radiowaves.left.and.right" },
  { id: "calendar", title: "Calendar", icon: "calendar" },
  { id: "advanced", title: "Advanced", icon: "slider.horizontal.3" },
];

const SIDEBAR = 214;
const TOOLBAR = 52;
const HOLD_CAP_MS = 250;

type Shown = { pane: SettingsPane; profileId: string | null };
const shownKey = (s: Shown) => `${s.pane}:${s.profileId ?? ""}`;

function useShownPane(): Shown | null {
  const nav = useSettingsNav();
  const target = { pane: nav.pane, profileId: nav.profileId };
  const key = shownKey(target);
  const loaded = usePaneLoaded(nav.pane, nav.profileId);
  const [expired, setExpired] = useState<string | null>(null);
  const [last, setLast] = useState<Shown | null>(null);
  const ready = loaded || expired === key;
  useEffect(() => {
    if (ready) return setLast(target);
    void preparePane(target.pane, target.profileId);
    const timer = setTimeout(() => setExpired(key), HOLD_CAP_MS);
    return () => clearTimeout(timer);
  }, [key, ready]);
  return ready ? target : last;
}

function usePrefetchAllPanes(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => {
      for (const p of PANES) void preparePane(p.id, null);
    }, 0);
    return () => clearTimeout(timer);
  }, [enabled]);
}

export function SettingsWindow() {
  const theme = useTheme();
  const nav = useSettingsNav();
  const shown = useShownPane();
  usePrefetchAllPanes(!!shown);
  const profileName = useBrowser((s) => (shown?.profileId ? s.profiles[shown.profileId]?.name : undefined));
  const title = shown ? (shown.pane === "profiles" && profileName ? profileName : PANES.find((p) => p.id === shown.pane)!.title) : "";
  const sheet = useSettingsSheet((s) => s.sheet);
  useEffect(() => trackSettingsSection(nav.pane), [nav.pane]);
  const scroller = useRef<ScrollView>(null);
  const key = shown ? shownKey(shown) : "";
  useLayoutEffect(() => scroller.current?.scrollTo({ y: 0, animated: false }), [key]);

  return (
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: theme.dark ? "#1E1E1E" : "#F2F2F2" }}>
      <View style={{ width: SIDEBAR }}>
        <VisualEffect material="sidebar" blendingMode="behindWindow" style={StyleSheet.absoluteFill} />
        <WindowDragRegion style={{ height: TOOLBAR }} />
        <ScrollView contentContainerStyle={{ paddingHorizontal: 10, paddingBottom: 12, gap: 1 }}>
          {PANES.map((p) => (
            <SidebarItem key={p.id} title={p.title} icon={p.icon} selected={nav.pane === p.id} onPress={() => nav.go(p.id)} />
          ))}
        </ScrollView>
      </View>
      <View style={{ width: StyleSheet.hairlineWidth * 2, backgroundColor: theme.dark ? "rgba(0,0,0,0.6)" : "rgba(0,0,0,0.1)" }} />
      <View style={{ flex: 1 }}>
        <View style={{ height: TOOLBAR, flexDirection: "row", alignItems: "center", paddingHorizontal: 12, gap: 2 }}>
          <WindowDragRegion style={StyleSheet.absoluteFill} />
          <IconButton icon="chevron.left" size={13} box={28} radius={6} disabled={!nav.back.length} onPress={nav.goBack} tooltip="Back" />
          <IconButton icon="chevron.right" size={13} box={28} radius={6} disabled={!nav.forward.length} onPress={nav.goForward} tooltip="Forward" />
          <Text style={{ marginLeft: 8, fontSize: 15, fontWeight: "600", color: theme.textPrimary }}>{title}</Text>
        </View>
        <ScrollView ref={scroller} contentContainerStyle={{ alignItems: "center", paddingBottom: 40 }}>
          <View key={key} style={{ width: "100%", maxWidth: 600, paddingHorizontal: 24 }}>
            {shown ? <Pane pane={shown.pane} profileId={shown.profileId} /> : null}
          </View>
        </ScrollView>
      </View>
      {sheet}
    </View>
  );
}

function Pane({ pane, profileId }: { pane: SettingsPane; profileId: string | null }): ReactNode {
  switch (pane) {
    case "general":
      return <GeneralPane />;
    case "profiles":
      return profileId ? <ProfileDetailsPane profileId={profileId} /> : <ProfilesPane />;
    case "sync":
      return <SyncPane />;
    case "tabs":
      return <TabsPane />;
    case "appearance":
      return <AppearancePane />;
    case "privacy":
      return <PrivacyPane />;
    case "passwords":
      return <PasswordsPane profileId={profileId} />;
    case "autofill":
      return <AutofillPane profileId={profileId} />;
    case "extensions":
      return <ExtensionsPane />;
    case "search":
      return <SearchPane />;
    case "shortcuts":
      return <ShortcutsPane />;
    case "liveFolders":
      return <LiveFoldersPane />;
    case "calendar":
      return <CalendarPane />;
    case "advanced":
      return <AdvancedPane />;
  }
}

function SidebarItem({ title, icon, selected, onPress }: { title: string; icon: string; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  const colors = useFormColors();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps}>
      <Pressable onPress={onPress}>
        <View
          style={{
            height: 30,
            borderRadius: 7,
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 8,
            gap: 9,
            backgroundColor: selected ? colors.accent : hovered ? colors.selected : undefined,
          }}
        >
          <Symbol name={icon} size={13} color={selected ? "#FFFFFF" : theme.icon} style={{ width: 20, height: 20 }} />
          <Text style={{ fontSize: 13, color: selected ? "#FFFFFF" : theme.textPrimary }}>{title}</Text>
        </View>
      </Pressable>
    </View>
  );
}

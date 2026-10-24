import { appIcons, currentAppIcon, setAppIcon, type AppIcon } from "@ardia/shell";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { PROFILE_COLORS } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import type { PeekModifier, Settings } from "../../store/settings";
import { ChoiceGroup, ChoicePair, MoreOptions, type ChoiceOption } from "./choices";
import { ThemeColorPicker } from "./personalize";
import { MockPanel, pickTier, useScreen } from "./screen";
import { PRESETS, useOnboarding } from "./state";
import { StepActions, StepLayout } from "./steps";
import { CheckRow, OptionRow, SectionLabel, Tag } from "./ui";

const LAYOUT_KEYS = ["tabLayout", "addressBar", "commandBarPlacement"] as const;

const TAB_CHOICES: ChoiceOption<Settings["tabLayout"]>[] = [
  { value: "sidebar", preview: "tabs-sidebar", title: "Sidebar", subtitle: "Tabs down the side" },
  { value: "top", preview: "tabs-top", title: "Top", subtitle: "Tabs along the top" },
];
const ADDRESS_CHOICES: ChoiceOption<Settings["addressBar"]>[] = [
  { value: "toolbar", preview: "address-toolbar", title: "Toolbar", subtitle: "Above the page" },
  { value: "sidebar", preview: "address-sidebar", title: "Sidebar", subtitle: "Above your tabs" },
];
const CMDL_CHOICES: ChoiceOption<Settings["commandBarPlacement"]>[] = [
  { value: "field", preview: "cmdl-field", title: "Under the address", subtitle: "Drops from the field" },
  { value: "centred", preview: "cmdl-centred", title: "Centred", subtitle: "In the window's centre" },
];

function styleOf(values: Pick<Settings, (typeof LAYOUT_KEYS)[number]>) {
  const matches = (preset: "arc" | "dia") =>
    (["addressBar", "commandBarPlacement"] as const).every((k) => values[k] === PRESETS[preset][k]) && values.tabLayout === "sidebar";
  if (matches("arc")) return "Arc-style";
  if (matches("dia") || (values.tabLayout === "top" && values.commandBarPlacement === PRESETS.dia.commandBarPlacement)) return "Dia-style";
  return "Your mix";
}

export function LayoutStep() {
  const { values, mock, focus, setFocus } = useScreen(LAYOUT_KEYS);
  const top = values.tabLayout === "top";
  const { setDraft, previewLive } = useOnboarding.getState();
  const change = (patch: Partial<Settings>) => {
    setDraft(patch);
    previewLive(patch);
  };
  useEffect(() => previewLive(values), []);

  const done = () => {
    const { addressBar, ...rest } = values;
    const where = top ? "Tabs along the top" : addressBar === "sidebar" ? "Tabs and address in the sidebar" : "Tabs in the sidebar";
    const picked = [values.commandBarPlacement === "centred" ? `${where}, ⌘L centred` : where];
    useOnboarding.getState().confirm("layout", top ? rest : values, picked);
  };

  return (
    <StepLayout
      title="Where things go"
      subtitle="Your window changes as you pick."
      tag={<Tag title={styleOf(values)} />}
      actions={<StepActions onContinue={done} onSkip={() => useOnboarding.getState().skip("layout", LAYOUT_KEYS)} />}
      preview={<MockPanel settings={mock} focus={focus} />}
    >
      <ChoicePair label="Tabs" options={TAB_CHOICES} value={values.tabLayout} onChange={(tabLayout) => change({ tabLayout })} onFocus={setFocus} order={0} />
      {top ? null : (
        <ChoicePair label="Address bar" options={ADDRESS_CHOICES} value={values.addressBar} onChange={(addressBar) => change({ addressBar })} onFocus={setFocus} order={2} />
      )}
      <ChoicePair
        label="⌘L opens"
        options={CMDL_CHOICES}
        value={values.commandBarPlacement}
        onChange={(commandBarPlacement) => change({ commandBarPlacement })}
        onFocus={setFocus}
        order={4}
      />
    </StepLayout>
  );
}

const TABS_KEYS = ["newTabOpens", "newTabPosition", "cleanUpInactiveTabsAfterHours", "restoreSession", "shareTabsAcrossWindows"] as const;
const TABS_MORE = ["balancedTopApps", "peekModifier", "undoReopensClosedTab", "cmdClickCreatesTabGroup"] as const;

const NEW_TAB_CHOICES: ChoiceOption<Settings["newTabOpens"]>[] = [
  { value: "page", preview: "newtab-page", title: "New Tab page", subtitle: "Your apps and search" },
  { value: "commandBar", preview: "newtab-commandbar", title: "Command bar", subtitle: "Start typing right away" },
];
const TIDY_CHOICES: ChoiceOption<"keep" | "tidy">[] = [
  { value: "keep", preview: "tidy-keep", title: "Keep", subtitle: "Until you close them" },
  { value: "tidy", preview: "tidy-auto", title: "Tidy", subtitle: "Close tabs you don't use" },
];
const QUIT_CHOICES: ChoiceOption<boolean>[] = [
  { value: true, preview: "quit-restore", title: "Restore", subtitle: "Reopen your tabs" },
  { value: false, preview: "quit-fresh", title: "Start fresh", subtitle: "Open to a clean window" },
];
const WINDOW_CHOICES: ChoiceOption<boolean>[] = [
  { value: false, preview: "windows-separate", title: "Separate", subtitle: "Each its own tabs" },
  { value: true, preview: "windows-shared", title: "Shared", subtitle: "Every window, same tabs" },
];
const TIDY_AFTER = [
  { value: 12, title: "12 h" },
  { value: 24, title: "1 day" },
  { value: 168, title: "1 week" },
];
const PEEK_WITH: { value: PeekModifier; title: string }[] = [
  { value: "shift", title: "⇧-click" },
  { value: "alt", title: "⌥-click" },
  { value: "off", title: "Off" },
];

const hoursLabel = (h: number) => TIDY_AFTER.find((o) => o.value === h)?.title.replace("12 h", "12 hours") ?? `${h} hours`;

export function TabsStep() {
  const { values, base, mock, focus, setFocus } = useScreen([...TABS_KEYS, ...TABS_MORE]);
  const [more, setMore] = useState(false);
  const setDraft = useOnboarding((s) => s.setDraft);
  const top = base.tabLayout === "top";
  const tidy = values.cleanUpInactiveTabsAfterHours;
  const newTabPositions: ChoiceOption<Settings["newTabPosition"]>[] = [
    { value: "bottom", preview: "newtabpos-bottom", title: top ? "Right" : "Bottom", subtitle: top ? "After your other tabs" : "Under your other tabs" },
    { value: "top", preview: "newtabpos-top", title: top ? "Left" : "Top", subtitle: top ? "Before your other tabs" : "Above your other tabs" },
  ];

  const done = () => {
    const main = Object.fromEntries(TABS_KEYS.map((k) => [k, values[k]])) as Partial<Settings>;
    const picked = [
      values.newTabOpens === "commandBar" ? "⌘T opens the command bar" : "⌘T opens the New Tab page",
      tidy === null ? "Old tabs stay until you close them" : `Old tabs tidy up after ${hoursLabel(tidy)}`,
    ];
    useOnboarding.getState().confirm("tabs", { ...main, ...pickTier(values, base, TABS_MORE, more) }, picked);
  };

  return (
    <StepLayout
      title="How tabs behave"
      subtitle="New tabs, old tabs and what happens when you quit."
      actions={<StepActions onContinue={done} onSkip={() => useOnboarding.getState().skip("tabs", [...TABS_KEYS, ...TABS_MORE])} />}
      preview={<MockPanel settings={mock} focus={focus} />}
    >
      <ChoicePair label="⌘T opens" options={NEW_TAB_CHOICES} value={values.newTabOpens} onChange={(newTabOpens) => setDraft({ newTabOpens })} onFocus={setFocus} order={0} />
      <ChoicePair
        label="New tabs go"
        options={newTabPositions}
        value={values.newTabPosition}
        onChange={(newTabPosition) => setDraft({ newTabPosition })}
        onFocus={setFocus}
        order={2}
      />
      <ChoicePair
        label="Old tabs"
        options={TIDY_CHOICES}
        value={tidy === null ? "keep" : "tidy"}
        onChange={(v) => setDraft({ cleanUpInactiveTabsAfterHours: v === "keep" ? null : (tidy ?? 12) })}
        onFocus={setFocus}
        order={4}
      >
        {tidy === null ? null : (
          <OptionRow
            title="Tidy after"
            value={tidy}
            options={TIDY_AFTER.some((o) => o.value === tidy) ? TIDY_AFTER : [...TIDY_AFTER, { value: tidy, title: hoursLabel(tidy) }]}
            onChange={(cleanUpInactiveTabsAfterHours) => setDraft({ cleanUpInactiveTabsAfterHours })}
          />
        )}
      </ChoicePair>
      <ChoicePair label="When you quit" options={QUIT_CHOICES} value={values.restoreSession} onChange={(restoreSession) => setDraft({ restoreSession })} onFocus={setFocus} order={6} />
      <ChoicePair
        label="Windows"
        options={WINDOW_CHOICES}
        value={values.shareTabsAcrossWindows}
        onChange={(shareTabsAcrossWindows) => setDraft({ shareTabsAcrossWindows })}
        onFocus={setFocus}
        order={8}
      />
      <MoreOptions
        open={more}
        onToggle={() => setMore(!more)}
      >
        <CheckRow compact title="Top Apps grow with the sidebar" subtitle="Up to four across, as in Arc" value={values.balancedTopApps} onChange={(balancedTopApps) => setDraft({ balancedTopApps })} />
        <OptionRow title="Peek a link with" value={values.peekModifier} options={PEEK_WITH} onChange={(peekModifier) => setDraft({ peekModifier })} />
        <CheckRow compact title="⌘Z reopens closed tabs" subtitle="Outside text fields" value={values.undoReopensClosedTab} onChange={(undoReopensClosedTab) => setDraft({ undoReopensClosedTab })} />
        <CheckRow
          compact
          title="⌘-clicking links makes tab groups"
          value={values.cmdClickCreatesTabGroup}
          onChange={(cmdClickCreatesTabGroup) => setDraft({ cmdClickCreatesTabGroup })}
        />
      </MoreOptions>
    </StepLayout>
  );
}

const LOOK_KEYS = ["appearance", "extendWebsiteColor"] as const;
const LOOK_MORE = ["hideToolbarWhileScrolling", "bookmarksBar"] as const;

const APPEARANCE_CHOICES: ChoiceOption<Settings["appearance"]>[] = [
  { value: "auto", preview: "appearance-auto", title: "Auto", subtitle: "Like your Mac" },
  { value: "light", preview: "appearance-light", title: "Light", subtitle: "Always light" },
  { value: "dark", preview: "appearance-dark", title: "Dark", subtitle: "Always dark" },
];
const SITE_COLOR_CHOICES: ChoiceOption<boolean>[] = [
  { value: true, preview: "sitecolor-on", title: "On", subtitle: "Takes the site's color" },
  { value: false, preview: "sitecolor-off", title: "Off", subtitle: "Keeps your theme color" },
];
const BOOKMARKS_BAR: { value: Settings["bookmarksBar"]; title: string }[] = [
  { value: "always", title: "Always" },
  { value: "newTab", title: "New Tab" },
  { value: "never", title: "Never" },
];
const APPEARANCE_LABEL = { auto: "follows macOS", light: "always light", dark: "always dark" } as const;

export function LookStep() {
  const { values, base, mock, focus, setFocus } = useScreen([...LOOK_KEYS, ...LOOK_MORE]);
  const windowId = useOnboarding((s) => s.windowId) ?? "";
  const appIcon = useOnboarding((s) => s.extras.appIcon);
  const color = useBrowser((s) => s.profiles[s.windows[windowId]?.profileId ?? ""]?.color);
  const [more, setMore] = useState(false);
  const [icons, setIcons] = useState<{ list: AppIcon[]; current: string | null }>({ list: [], current: null });
  const { setDraft, previewLive, previewColor, setExtras } = useOnboarding.getState();
  const change = (patch: Partial<Settings>) => {
    setDraft(patch);
    previewLive(patch);
  };
  useEffect(() => {
    previewLive(Object.fromEntries(LOOK_KEYS.map((k) => [k, values[k]])));
    void Promise.all([appIcons(56), currentAppIcon()]).then(
      ([list, current]) => setIcons({ list, current }),
      () => {},
    );
  }, []);

  const done = () => {
    const icon = appIcon && appIcon !== icons.current ? appIcon : null;
    if (icon) void setAppIcon(icon);
    const main = Object.fromEntries(LOOK_KEYS.map((k) => [k, values[k]])) as Partial<Settings>;
    const name = color ? PROFILE_COLORS[color]?.name : null;
    const picked = [`${name ? `${name}, ` : ""}${APPEARANCE_LABEL[values.appearance]}`];
    useOnboarding.getState().confirm("look", { ...main, ...pickTier(values, base, LOOK_MORE, more) }, picked);
  };

  return (
    <StepLayout
      title="Make it yours"
      subtitle="A color, a look, and how much of the site shows through."
      actions={<StepActions onContinue={done} onSkip={() => useOnboarding.getState().skip("look", [...LOOK_KEYS, ...LOOK_MORE])} />}
      preview={<MockPanel settings={mock} focus={focus} />}
    >
      <View style={{ gap: 8 }}>
        <SectionLabel title="Theme color" />
        <ThemeColorPicker windowId={windowId} size={30} onPick={previewColor} />
      </View>
      <ChoiceGroup
        label="Appearance"
        options={APPEARANCE_CHOICES}
        value={values.appearance}
        onChange={(appearance) => change({ appearance })}
        onFocus={setFocus}
        order={0}
      />
      <ChoicePair
        label="Website color in the tab bar"
        options={SITE_COLOR_CHOICES}
        value={values.extendWebsiteColor}
        onChange={(extendWebsiteColor) => change({ extendWebsiteColor })}
        onFocus={setFocus}
        order={3}
      />
      <MoreOptions
        open={more}
        onToggle={() => setMore(!more)}
      >
        {icons.list.length > 1 ? (
          <OptionRow
            title="App icon"
            value={appIcon ?? icons.current ?? icons.list[0]!.id}
            options={icons.list.map((i) => ({ value: i.id, title: i.name, image: i.preview }))}
            onChange={(id) => setExtras({ appIcon: id })}
          />
        ) : null}
        <CheckRow
          compact
          title="Hide toolbar while scrolling"
          subtitle="Scroll up to bring it back"
          value={values.hideToolbarWhileScrolling}
          onChange={(hideToolbarWhileScrolling) => setDraft({ hideToolbarWhileScrolling })}
        />
        <OptionRow title="Bookmarks bar" value={values.bookmarksBar} options={BOOKMARKS_BAR} onChange={(bookmarksBar) => setDraft({ bookmarksBar })} />
      </MoreOptions>
    </StepLayout>
  );
}

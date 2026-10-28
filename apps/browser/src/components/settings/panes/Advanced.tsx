import { useState } from "react";
import { Text, View } from "react-native";
import { systemInfo } from "../../../state/app/system";
import { describeCliInstall, installCliInBackground, useCli } from "../../../state/app/cliControl";
import { openUrls } from "../../../state/browser/actions";
import { useTheme } from "../../ui/theme";
import { useSettings } from "../../../state/browser/hooks";
import { updateSettings } from "../../../state/settings/actions";
import { openInternalPage } from "../../../state/pages/urls";
import type { BatterySaverWhen } from "../../../state/settings/settings";
import { keepSiteActive, stopKeepingSiteActive, type MemorySaverMode } from "../../../state/tabs/memorySaver";
import { closeSettingsSheet, showSettingsSheet } from "../../../state/settings/sheet";
import { Button, font, PopUp, Sheet, TextField, Toggle, weight } from "../../ui";
import { Favicon } from "../../favicon/Favicon";
import { Group, Row, SectionHeader } from "../Form";
import { engineVersion, widevine as widevineComponent } from "../../../state/settings/paneData";
import { useResource } from "../../../state/settings/resources";

const REPOSITORY = "https://github.com/mantrakp04/ardia";
const SOURCE_NOTICE = "Ardia is free software under the GNU General Public License v3, with no warranty.";

const BATTERY_SAVER_DESCRIPTIONS: Record<BatterySaverWhen, string> = {
  lowBattery: "At 20% battery or less, or in Low Power Mode, busy background tabs pause and animations slow down.",
  unplugged: "On battery or in Low Power Mode, busy background tabs pause and animations slow down.",
  never: "Background tabs and animations run at full speed on battery.",
};

const MEMORY_SAVER_MODES: { value: MemorySaverMode; title: string; description: string }[] = [
  { value: "moderate", title: "Moderate", description: "Get moderate memory savings. Your tabs become inactive after a longer period of time." },
  { value: "balanced", title: "Balanced (recommended)", description: "Get balanced memory savings. Your tabs become inactive after an optimal period of time." },
  { value: "maximum", title: "Maximum", description: "Get maximum memory savings. Your tabs become inactive after a shorter period of time." },
];

export function AdvancedPane() {
  const theme = useTheme();
  const settings = useSettings((s) => s);
  const update = updateSettings;
  const [info] = useResource(engineVersion);
  const [widevine] = useResource(widevineComponent);
  const widevineVersion = widevine && widevine.version !== "0.0.0.0" ? widevine.version : null;

  return (
    <View>
      <SectionHeader title="Browsing" />
      <Group>
        <Row anchor="advanced.showFullUrl">
          <Toggle value={settings.showFullUrl} onChange={(v) => update({ showFullUrl: v })} />
        </Row>
        <Row anchor="advanced.warnMovingTabs">
          <Toggle value={settings.warnBeforeMovingTabsToProfile} onChange={(v) => update({ warnBeforeMovingTabsToProfile: v })} />
        </Row>
        <Row anchor="advanced.bookmarksImport">
          <Toggle value={!settings.hideBookmarksBarImport} onChange={(v) => update({ hideBookmarksBarImport: !v })} />
        </Row>
      </Group>

      <SectionHeader title="Performance" />
      <Group>
        <Row anchor="advanced.memorySaver">
          <Toggle value={settings.memorySaver} onChange={(v) => update({ memorySaver: v })} />
        </Row>
        {settings.memorySaver && (
          <Row anchor="advanced.memorySaverMode" description={(MEMORY_SAVER_MODES.find((m) => m.value === settings.memorySaverMode) ?? MEMORY_SAVER_MODES[1]!).description}>
            <PopUp
              value={settings.memorySaverMode}
              options={MEMORY_SAVER_MODES.map(({ value, title }) => ({ value, title }))}
              onChange={(v) => update({ memorySaverMode: v })}
              minWidth={190}
            />
          </Row>
        )}
        <Row anchor="advanced.batterySaver" description={BATTERY_SAVER_DESCRIPTIONS[settings.batterySaverWhen]}>
          <PopUp
            value={settings.batterySaverWhen}
            options={[
              { value: "lowBattery", title: "When battery is low" },
              { value: "unplugged", title: "When unplugged" },
              { value: "never", title: "Never" },
            ]}
            onChange={(v) => update({ batterySaverWhen: v })}
            minWidth={190}
          />
        </Row>
      </Group>

      <KeepActiveSites sites={settings.keepActiveSites ?? []} />

      <SectionHeader title="Data" />
      <Group>
        <Row anchor="advanced.history">
          <Button title="Show History" onPress={() => openInternalPage("history")} />
        </Row>
        <Row anchor="advanced.downloads">
          <Button title="Show Downloads" onPress={() => openInternalPage("downloads")} />
        </Row>
      </Group>

      <CommandLineSection />

      <SectionHeader title="Web engine" />
      <Group>
        <Row anchor="advanced.chromium" description={info ? "ArdiaCore" : undefined}>
          <Text selectable style={{ ...font.body, color: theme.textSecondary }}>
            {info?.chromiumVersion ?? "…"}
          </Text>
        </Row>
        <Row
          anchor="advanced.widevine"
          description={
            widevine === undefined
              ? "Checking…"
              : widevineVersion
                ? `Version ${widevineVersion}`
                : "Not available in this build: video that needs it, like Netflix or Disney+, won't play."
          }
        />
      </Group>

      <SectionHeader title="Source and licenses" />
      <Group>
        <Row anchor="advanced.source" description={SOURCE_NOTICE}>
          <Button title="Show on GitHub" onPress={() => openUrls([`${REPOSITORY}/tree/v${systemInfo().appVersion}`])} />
        </Row>
        <Row anchor="advanced.licenses">
          <Button title="Show Licenses" onPress={() => openUrls(["chrome://credits"])} />
        </Row>
      </Group>
    </View>
  );
}

function CommandLineSection() {
  const theme = useTheme();
  const on = useSettings((s) => s.cliControl ?? false);
  const update = updateSettings;
  const cli = useCli();
  const server = cli.server;
  const serverNote =
    server?.state === "external"
      ? "This instance already has a DevTools port from the command line, so the setting leaves it alone."
      : server?.reason
        ? server.reason
        : on && server?.state === "on"
          ? server.connections
            ? `Connected now: ${server.connections === 1 ? "1 session" : `${server.connections} sessions`}.`
            : "On. Nothing is connected."
          : "While it's on, the command can open, read and act in every page you're signed in to, and it stays on after you quit.";
  return (
    <>
      <SectionHeader title="Command line" />
      <Group>
        <Row anchor="advanced.cliControl" description={serverNote}>
          <Toggle value={on} onChange={(v) => update({ cliControl: v })} />
        </Row>
        <Row
          anchor="advanced.cliInstall"
          description={
            <Text selectable style={{ ...font.footnote, marginTop: 2, lineHeight: 15, color: cli.error && !cli.installing ? theme.destructive : theme.textSecondary }}>
              {describeCliInstall(cli)}
            </Text>
          }
        >
          <Button
            title={cli.installing ? "Installing…" : cli.installedVersion ? "Reinstall" : "Install"}
            disabled={!!cli.installing}
            onPress={() => void installCliInBackground("settings")}
          />
        </Row>
      </Group>
    </>
  );
}

const siteUrl = (site: string) => (/^[a-z][\w+.-]*:\/\//i.test(site) ? site : `https://${site.replace(/^\[\*\.\]|^\*\.|^\./, "")}`);

function KeepActiveSites({ sites }: { sites: string[] }) {
  return (
    <>
      <SectionHeader anchor="advanced.keepActiveSites" action={<Button title="Add Site…" icon="plus" onPress={() => showSettingsSheet(<KeepActiveSiteSheet />)} />} />
      <Group of="advanced.keepActiveSites">
        {sites.length === 0 ? (
          <Row title="No sites added" />
        ) : (
          [...sites]
            .sort((a, b) => a.localeCompare(b))
            .map((site) => (
              <Row key={site} icon={<Favicon url={siteUrl(site)} />} title={site}>
                <Button variant="icon" icon="trash" size={11} box={24} radius={6} onPress={() => stopKeepingSiteActive(site)} tooltip="Remove" />
              </Row>
            ))
        )}
      </Group>
    </>
  );
}

function KeepActiveSiteSheet() {
  const theme = useTheme();
  const [site, setSite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const add = async () => {
    setSaving(true);
    const problem = await keepSiteActive(site);
    setSaving(false);
    if (problem) return setError(problem);
    closeSettingsSheet();
  };
  return (
    <Sheet width={440} onClose={closeSettingsSheet}>
      <Text style={{ ...font.heading, fontWeight: weight.semibold, color: theme.textPrimary }}>Add Site</Text>
      <Text style={{ ...font.small, marginTop: 6, color: theme.textSecondary }}>Sites you add will always stay active and memory won't be freed up from them.</Text>
      <View style={{ marginTop: 12 }}>
        <Text style={{ ...font.footnote, marginBottom: 5, color: theme.textSecondary }}>Site</Text>
        <TextField value={site} onChangeText={setSite} placeholder="youtube.com" onSubmit={() => void add()} onEscape={closeSettingsSheet} autoFocus />
      </View>
      {error && <Text style={{ ...font.small, marginTop: 10, color: theme.destructive }}>{error}</Text>}
      <View style={{ flexDirection: "row", gap: 8, marginTop: 18 }}>
        <View style={{ flex: 1 }} />
        <Button title="Cancel" onPress={closeSettingsSheet} />
        <Button title="Add" kind="primary" disabled={saving || !site.trim()} onPress={() => void add()} />
      </View>
    </Sheet>
  );
}

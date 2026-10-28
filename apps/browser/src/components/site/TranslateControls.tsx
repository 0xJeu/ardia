import { showMenu } from "../../state/app/system";
import {
  translation,
  defaultTarget,
  isNeverTranslated,
  languageName,
  otherLanguages,
  revertPage,
  setNeverTranslate,
  toggleTranslation,
  translatePage,
  translateStateOf,
  useTranslateState,
} from "../../state/site/translate";
import { translateMenuItems } from "../../state/site/translateMenu";
import { memo } from "react";
import { useTheme } from "../ui/theme";
import { useSettings, useTab } from "../../state/browser/hooks";
import { currentTab } from "../../state/browser/current";
import { isIncognitoProfile } from "../../state/browser/model";
import { Button, MenuRow, MenuSeparator, Toggle } from "../ui";
import type { ToolbarPalette } from "../ui/toolbarColors";

export const TranslateButton = memo(function TranslateButton({ tabId, palette, box, radius, onFocus }: { tabId: string; palette: ToolbarPalette; box: number; radius: number; onFocus: () => void }) {
  const theme = useTheme();
  const state = useTranslateState(tabId);
  if (!translation || (!state.source && state.status === "idle")) return null;
  const translated = state.status !== "idle";
  return (
    <Button variant="icon" toolbar
      palette={palette}
      icon="translate"
      size={13}
      box={box}
      radius={radius}
      color={translated ? theme.accent : undefined}
      onPress={() => {
        onFocus();
        toggleTranslation(tabId);
      }}
      onContextMenu={() => void showTranslateMenu(tabId)}
      tooltip={translated ? `Show Original (${languageName(state.source ?? "")})` : "Translate this page"}
    />
  );
});

async function chooseLanguage(tabId: string) {
  const languages = await otherLanguages();
  const current = translateStateOf(tabId).target;
  const choice = await showMenu(languages.map((l) => ({ id: l.id, title: l.name, checked: l.id === current })));
  if (choice) void translatePage(tabId, choice);
}

async function showTranslateMenu(tabId: string) {
  const tab = currentTab(tabId);
  if (!tab) return;
  const state = translateStateOf(tabId);
  const languages = await otherLanguages();
  const choice = await showMenu(
    translateMenuItems({
      translated: state.status !== "idle",
      target: languageName(defaultTarget()),
      languages: languages.map((l) => ({ id: l.id, name: l.name, current: l.id === state.target })),
      neverTranslate: isIncognitoProfile(tab.profileId) ? null : isNeverTranslated(tab.profileId, tab.url),
    }),
  );
  if (choice === "original") void revertPage(tabId);
  else if (choice === "translate") void translatePage(tabId);
  else if (choice?.startsWith("language:")) void translatePage(tabId, choice.slice("language:".length));
  else if (choice === "never") setNeverTranslate(tabId, !isNeverTranslated(tab.profileId, tab.url));
}

export function TranslateRows({ tabId, onClose }: { tabId: string; onClose: () => void }) {
  const state = useTranslateState(tabId);
  const tab = useTab(tabId);
  useSettings((st) => st.neverTranslateSites);
  const never = tab ? isNeverTranslated(tab.profileId, tab.url) : false;
  if (!translation || !tab || (!state.source && state.status === "idle" && !never)) return null;
  const translated = state.status !== "idle";
  return (
    <>
      {!never && (
        <MenuRow
          icon={translated ? "arrow.uturn.backward" : "translate"}
          title={translated ? `Show Original (${languageName(state.source ?? "")})` : `Translate to ${languageName(defaultTarget())}`}
          onPress={() => {
            onClose();
            toggleTranslation(tabId);
          }}
        />
      )}
      {!never && (
        <MenuRow
          icon="globe"
          title="Choose Another Language…"
          onPress={() => {
            onClose();
            void chooseLanguage(tabId);
          }}
        />
      )}
      {!isIncognitoProfile(tab.profileId) && (
        <MenuRow icon="nosign" title="Never Translate This Site" accessory={<Toggle look="panel" value={never} onChange={(v) => setNeverTranslate(tabId, v)} />} />
      )}
      <MenuSeparator />
    </>
  );
}

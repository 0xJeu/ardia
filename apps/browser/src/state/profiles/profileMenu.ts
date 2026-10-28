import { prompt } from "../../platform/dialogs";
import { showMenu, type MenuItem } from "../../platform/menus";
import { menuSections } from "../app/menuSections";
import { deleteProfile } from "../browser/actions";
import { currentProfile, currentProfileOrder, currentSettings } from "../browser/current";
import type { ProfileColor } from "../browser/types";
import { goToSettingsPane, openSettings } from "../settings/settingsWindows";
import { setDefaultProfile, setSwitcherIcon, updateProfile } from "./actions";
import { choosePresetColor } from "./themeActions";

export type ProfileMenuPlace = "sidebar" | "settings";
export type ProfileColorChoice = { id: ProfileColor; title: string; swatch: string };

export type ProfileMenuState = {
  place: ProfileMenuPlace;
  hasIcon: boolean;
  iconItems: MenuItem[];
  colors: ProfileColorChoice[];
  color: ProfileColor | null;
  isDefault: boolean;
  only: boolean;
};

export function profileMenuItems({ place, hasIcon, iconItems, colors, color, isDefault, only }: ProfileMenuState): MenuItem[] {
  return menuSections(
    [
      { id: "rename", title: "Rename…", symbol: "pencil" },
      { id: "icon", title: hasIcon ? "Change Icon" : "Add Icon", symbol: "photo", children: iconItems },
      { id: "color", title: "Color", symbol: "paintpalette", children: colors.map((c) => ({ id: `color:${c.id}`, title: c.title, swatch: c.swatch, checked: c.id === color })) },
    ],
    place === "sidebar"
      ? [{ id: "settings", title: "Profile Settings…", symbol: "gearshape" }]
      : [
          { id: "details", title: "Show Profile Details", symbol: "info.circle" },
          { id: "default", title: "Make Default Profile", symbol: "star", enabled: !isDefault },
        ],
    [{ id: "delete", title: "Delete Profile…", symbol: "trash", enabled: !only }],
  );
}

export async function renameProfile(profileId: string, windowId?: string) {
  const profile = currentProfile(profileId);
  if (!profile) return;
  const name = await prompt({ title: "Rename Profile", value: profile.name, placeholder: "Profile name", confirmTitle: "Rename", windowId });
  if (name?.trim() && currentProfile(profileId)) updateProfile(profileId, { name: name.trim() });
}

export async function showProfileMenu(
  profileId: string,
  { place, windowId, iconItems, colors }: { place: ProfileMenuPlace; windowId?: string; iconItems: (current: string | null) => MenuItem[]; colors: ProfileColorChoice[] },
) {
  const profile = currentProfile(profileId);
  if (!profile) return;
  const choice = await showMenu(
    profileMenuItems({
      place,
      hasIcon: !!profile.icon,
      iconItems: iconItems(profile.icon),
      colors,
      color: profile.theme ? null : profile.color,
      isDefault: currentSettings().defaultProfileId === profileId,
      only: currentProfileOrder().length <= 1,
    }),
  );
  if (!choice) return;
  if (choice.startsWith("icon:")) {
    const icon = choice.slice("icon:".length) || null;
    return place === "sidebar" ? setSwitcherIcon(profileId, icon) : updateProfile(profileId, { icon });
  }
  if (choice.startsWith("color:")) return choosePresetColor(profileId, choice.slice("color:".length) as ProfileColor);
  if (choice === "rename") return void renameProfile(profileId, windowId);
  if (choice === "settings") return openSettings("profiles", profileId);
  if (choice === "details") return goToSettingsPane("profiles", profileId);
  if (choice === "default") return setDefaultProfile(profileId);
  if (choice === "delete") return void deleteProfile(profileId, windowId);
}

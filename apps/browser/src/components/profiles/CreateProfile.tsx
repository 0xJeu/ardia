import { Symbol } from "@ardia/shell";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { PROFILE_COLORS, useTheme } from "../ui/theme";
import { useWindowId } from "../../state/browser/hooks";
import { currentProfiles } from "../../state/browser/current";
import { useProfileOrder, useProfileRecords, useCreateProfileShareDefault } from "../../state/profiles/hooks";
import { addProfile } from "../../state/profiles/actions";
import { endCreateProfileRequest, profileNames, takeCreateProfileSheet, useCreateProfileRequest, type CreateProfilePreset } from "../../state/profiles/createProfileRequest";
import { dataGroups, unusedProfileColor } from "../../state/profiles/profiles";
import type { ProfileColor } from "../../state/browser/types";
import { Button, Sheet, TextField, Toggle, useFormColors } from "../ui";
import { closeSettingsSheet, showSettingsSheet } from "../../state/settings/sheet";

useCreateProfileRequest.subscribe((s, prev) => {
  if (!s.sheet || s.sheet === prev.sheet) return;
  const request = takeCreateProfileSheet();
  if (!request) return;
  const done = (id: string | null) => {
    closeSettingsSheet();
    request.resolve(id);
  };
  showSettingsSheet(<CreateProfileSheet windowId={null} preset={request.preset} onDone={done} />);
});

export function CreateProfileHost() {
  const windowId = useWindowId();
  const request = useCreateProfileRequest((r) => (r.request?.windowId === windowId ? r.request : null));
  if (!request) return null;
  const done = (id: string | null) => endCreateProfileRequest(request, id);
  return <CreateProfileSheet windowId={windowId} preset={request.preset} onDone={done} />;
}

function CreateProfileSheet({ windowId, preset, onDone }: { windowId: string | null; preset: CreateProfilePreset; onDone: (id: string | null) => void }) {
  const theme = useTheme();
  const colors = useFormColors();
  const profiles = useProfileRecords();
  const profileOrder = useProfileOrder();
  const groups = useMemo(() => dataGroups({ profiles, profileOrder }), [profiles, profileOrder]);
  const current = useCreateProfileShareDefault(windowId);
  const [name, setName] = useState(preset.name ?? "");
  const [color, setColor] = useState<ProfileColor>(() => unusedProfileColor(currentProfiles()));
  const [share, setShare] = useState(!!preset.shareWith);
  const [shareWith, setShareWith] = useState(preset.shareWith ?? current);
  const selectedGroup = groups.find((g) => g.profileIds.includes(shareWith)) ?? groups[0];

  const submit = () => {
    const id = addProfile({ name, color, shareWith: share ? (selectedGroup?.profileIds[0] ?? null) : null });
    onDone(id);
  };
  const single = groups.length === 1;

  return (
    <Sheet width={420} onClose={() => onDone(null)}>
      <Text style={{ fontSize: 15, fontWeight: "600", color: theme.textPrimary }}>Create a Profile</Text>
      <Text style={{ fontSize: 12.5, lineHeight: 17, marginTop: 6, color: theme.textSecondary }}>
        Profiles separate your logins, cookies, passwords, extensions, history and bookmarks.
      </Text>

      <TextField value={name} onChangeText={setName} placeholder="Profile name" autoFocus onSubmit={submit} onEscape={() => onDone(null)} style={{ marginTop: 16 }} />

      <View style={{ flexDirection: "row", gap: 7, marginTop: 12 }}>
        {(Object.keys(PROFILE_COLORS) as ProfileColor[]).map((c) => (
          <Pressable key={c} onPress={() => setColor(c)} tooltip={PROFILE_COLORS[c].name}>
            <View style={{ width: 22, height: 22, borderRadius: 11, padding: 2, borderWidth: 2, borderColor: color === c ? PROFILE_COLORS[c].swatch : "transparent" }}>
              <View style={{ flex: 1, borderRadius: 9, backgroundColor: PROFILE_COLORS[c].swatch }} />
            </View>
          </Pressable>
        ))}
      </View>

      <View style={{ marginTop: 16, borderRadius: 10, backgroundColor: colors.group, borderWidth: 1, borderColor: colors.groupBorder, padding: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Text style={{ flex: 1, fontSize: 13, color: theme.textPrimary }}>{single ? "Share data with current profile" : "Share data with another profile"}</Text>
          <Toggle value={share} onChange={setShare} />
        </View>
        {share && (
          <Text style={{ fontSize: 11.5, lineHeight: 15, marginTop: 6, color: theme.textSecondary }}>
            {single
              ? "This profile will share your cookies, logins, passwords, extensions, bookmarks and history with your current profile. Tabs stay separate."
              : "This profile will share your cookies, logins, passwords, extensions, bookmarks and history with another profile you choose. Tabs stay separate."}
          </Text>
        )}
        {share && !single && (
          <View style={{ marginTop: 10, borderRadius: 8, backgroundColor: colors.field, borderWidth: 1, borderColor: colors.fieldBorder, overflow: "hidden" }}>
            {groups.map((g, i) => (
              <Pressable key={g.dataId} onPress={() => setShareWith(g.profileIds[0]!)}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, height: 32, paddingHorizontal: 10, borderTopWidth: i ? 1 : 0, borderColor: colors.separator }}>
                  <RadioDot on={g === selectedGroup} />
                  <ColorStack colors={g.profileIds.map((id) => PROFILE_COLORS[profiles[id]!.color]?.swatch ?? "#888888")} />
                  <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: theme.textPrimary }}>
                    {profileNames(g.profileIds.map((id) => profiles[id]!.name))}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
        <Button title="Cancel" onPress={() => onDone(null)} />
        <Button title="Create Profile" kind="primary" onPress={submit} />
      </View>
    </Sheet>
  );
}

function RadioDot({ on }: { on: boolean }) {
  const colors = useFormColors();
  return (
    <View
      style={{
        width: 14,
        height: 14,
        borderRadius: 7,
        borderWidth: on ? 0 : 1,
        borderColor: colors.fieldBorder,
        backgroundColor: on ? colors.accent : colors.control,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {on && <Symbol name="circle.fill" size={6} color="#FFFFFF" style={{ width: 8, height: 8 }} />}
    </View>
  );
}

export function ColorStack({ colors: swatches, size = 12 }: { colors: string[]; size?: number }) {
  const theme = useTheme();
  const shown = swatches.slice(0, 4);
  return (
    <View style={{ flexDirection: "row", width: size + (shown.length - 1) * (size * 0.6) }}>
      {shown.map((c, i) => (
        <View
          key={i}
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            marginLeft: i ? -size * 0.4 : 0,
            backgroundColor: c,
            borderWidth: 1,
            borderColor: theme.dark ? "rgba(0,0,0,0.35)" : "#FFFFFF",
          }}
        />
      ))}
    </View>
  );
}

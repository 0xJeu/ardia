import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useDefaultBrowserCheckIn } from "../../state/onboarding/defaultBrowserCheckIn";
import { useWindow } from "../../state/browser/hooks";
import { dismissAsk, setSharing, useTelemetry } from "../../state/telemetry/client";
import { SHARING_COPY } from "../../state/telemetry/copy";
import { onboardingCompletedAt, useOnboarding } from "../../state/onboarding/onboarding";
import { Symbol, useHover } from "../ui";
import { NtpCard, NtpCardSurface, useNtpCardColors } from "./NtpCard";
import { openSettings } from "../../state/settings/settingsWindows";
import { usePendingReleaseNotes } from "../../state/releaseNotes/releaseNotes";

const FRAME = { width: 300 };

export function TelemetryAsk({ windowId }: { windowId: string }) {
  const due = useTelemetry((s) => !s.decided && !s.askDone);
  const incognito = useWindow(windowId, (w) => !!w?.incognito);
  const onboarding = useOnboarding((s) => s.windowId !== null);
  const checkIn = useDefaultBrowserCheckIn(windowId).visible;
  const releaseNotes = usePendingReleaseNotes() !== null;
  const [existing] = useState(() => onboardingCompletedAt() !== null);
  const [leaving, setLeaving] = useState<null | (() => void)>(null);
  if (!leaving && !(due && existing && !incognito && !onboarding && !checkIn && !releaseNotes)) return null;
  const retire = (action: () => void) =>
    setLeaving(() => () => {
      action();
      setLeaving(null);
    });
  return (
    <View style={{ position: "absolute", left: 0, top: 0, width: FRAME.width, padding: 8 }} pointerEvents="box-none">
      <Card
        leaving={leaving}
        onShare={() => retire(() => setSharing(true, "ask"))}
        onNotNow={() => retire(() => setSharing(false, "ask"))}
        onClose={() => retire(dismissAsk)}
      />
    </View>
  );
}

function Card({ leaving, onShare, onNotNow, onClose }: { leaving: null | (() => void); onShare: () => void; onNotNow: () => void; onClose: () => void }) {
  const colors = useNtpCardColors();
  return (
    <NtpCard appearDelay={600} leaving={leaving} onClose={onClose}>
      <NtpCardSurface />
      <View style={{ padding: 12, gap: 12 }}>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View
            style={{
              width: 30,
              height: 30,
              borderRadius: 7,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: colors.badge,
            }}
          >
            <Symbol name="stethoscope" size={14} weight="medium" color={colors.badgeGlyph} style={{ width: 30, height: 30 }} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "500", color: colors.title }}>
              {SHARING_COPY.ask.title}
            </Text>
            <Text style={{ fontSize: 11.5, lineHeight: 15, color: colors.body }}>
              {SHARING_COPY.ask.body}{" "}
              <Text onPress={() => openSettings("privacy")} style={{ textDecorationLine: "underline" }} accessibilityRole="link">
                {SHARING_COPY.whatsSent}
              </Text>
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <AskButton title={SHARING_COPY.ask.notNow} onPress={onNotNow} />
          <AskButton title={SHARING_COPY.ask.share} onPress={onShare} />
        </View>
      </View>
    </NtpCard>
  );
}

function AskButton({ title, onPress }: { title: string; onPress: () => void }) {
  const colors = useNtpCardColors();
  const { hovered, hoverProps } = useHover();
  const [pressed, setPressed] = useState(false);
  const fill = pressed ? colors.askFillPressed : hovered ? colors.askFillHover : colors.askFill;
  return (
    <View {...hoverProps} style={{ flex: 1 }}>
      <Pressable onPress={onPress} onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)} accessibilityRole="button" accessibilityLabel={title}>
        <View style={{ height: 26, borderRadius: 7, alignItems: "center", justifyContent: "center", backgroundColor: fill }}>
          <Text style={{ fontSize: 12, fontWeight: "500", color: colors.askText }}>{title}</Text>
        </View>
      </Pressable>
    </View>
  );
}


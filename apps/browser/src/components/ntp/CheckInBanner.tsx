import { useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { CHECK_IN_COPY, useDefaultBrowserCheckIn } from "../../state/onboarding/defaultBrowserCheckIn";
import { Symbol } from "../ui";
import { NtpCard, NtpCardSurface, useNtpCardColors } from "./NtpCard";

const ICON = require("../../../assets/app-icon.png");

const FRAME = { width: 282, height: 69 };

export function CheckInBanner({ windowId }: { windowId: string }) {
  const checkIn = useDefaultBrowserCheckIn(windowId);
  const [leaving, setLeaving] = useState<null | (() => void)>(null);
  if (!checkIn.visible && !leaving) return null;
  const retire = (action: () => void) =>
    setLeaving(() => () => {
      action();
      setLeaving(null);
    });
  return (
    <View style={{ position: "absolute", left: 0, top: 0, width: FRAME.width, height: FRAME.height, padding: 8 }} pointerEvents="box-none">
      <Card leaving={leaving} onFeedback={() => retire(checkIn.leaveFeedback)} onClose={() => retire(checkIn.dismiss)} />
    </View>
  );
}

function Card({ leaving, onFeedback, onClose }: { leaving: null | (() => void); onFeedback: () => void; onClose: () => void }) {
  const colors = useNtpCardColors();
  const [pressed, setPressed] = useState(false);
  return (
    <NtpCard appearDelay={300} leaving={leaving} onClose={onClose} lift pressed={pressed} style={FILL}>
      <Pressable
        onPress={onFeedback}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        accessibilityRole="button"
        accessibilityLabel={`${CHECK_IN_COPY.title} ${CHECK_IN_COPY.action}`}
        style={{ flex: 1 }}
      >
        <NtpCardSurface />
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", paddingHorizontal: 10, gap: 10 }}>
          <View style={{ width: 37, height: 37, borderRadius: 6, overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
            <Image source={ICON} style={{ width: 37, height: 37 }} />
          </View>
          <View style={{ flex: 1, gap: 2, paddingLeft: 4 }}>
            <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "500", color: colors.title }}>
              {CHECK_IN_COPY.title}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
              <Text style={{ fontSize: 12, color: colors.body }}>{CHECK_IN_COPY.action}</Text>
              <Symbol name="arrow.up.right" size={9} weight="medium" color={colors.arrow} style={{ width: 11, height: 11 }} />
            </View>
          </View>
        </View>
      </Pressable>
    </NtpCard>
  );
}

const FILL = { flex: 1 } as const;

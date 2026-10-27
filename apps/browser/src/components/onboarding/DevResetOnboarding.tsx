import { Pressable, Text, View } from "react-native";
import { useHover } from "../ui";
import { font, weight } from "../ui/tokens";
import { useWindowId } from "../../state/browser/hooks";
import { resetOnboarding } from "../../state/onboarding/onboarding";
import { devTestValue } from "../../platform/launchConfig";

export function DevResetOnboarding() {
  const windowId = useWindowId();
  const { hovered, hoverProps } = useHover();
  if (devTestValue("onboarding") !== "1") return null;
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", right: 14, top: 12 }}>
      <View {...hoverProps}>
        <Pressable onPress={() => resetOnboarding(windowId)} accessibilityRole="button" accessibilityLabel="Reset onboarding">
          <View
            mouseDownCanMoveWindow={false}
            style={{
              height: 26,
              paddingHorizontal: 12,
              borderRadius: 13,
              justifyContent: "center",
              backgroundColor: hovered ? "rgba(255,59,48,0.95)" : "rgba(255,59,48,0.8)",
            }}
          >
            <Text style={{ ...font.body, fontWeight: weight.semibold, color: "#fff" }}>Reset onboarding</Text>
          </View>
        </Pressable>
      </View>
    </View>
  );
}

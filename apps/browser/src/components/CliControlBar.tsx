import { Symbol } from "@ardia/shell";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Text, View } from "react-native";
import { stopCliControl, useCli } from "../lib/cliControl";
import { useTheme } from "../lib/theme";
import { PromptButton } from "./layout/controls";

const BAR_HEIGHT = 38;

export function CliControlBar() {
  const theme = useTheme();
  const visible = useCli((s) => s.server?.state === "on" && (s.server.connections ?? 0) > 0);
  const height = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(visible);
  useEffect(() => {
    if (visible) setMounted(true);
    Animated.timing(height, { toValue: visible ? BAR_HEIGHT : 0, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start(
      ({ finished }) => finished && !visible && setMounted(false),
    );
  }, [visible]);
  if (!mounted && !visible) return null;
  return (
    <Animated.View style={{ height, overflow: "hidden" }}>
      <View
        accessibilityRole="alert"
        accessibilityLabel="The ardia command is controlling Ardia"
        style={{
          height: BAR_HEIGHT,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingLeft: 12,
          paddingRight: 8,
          borderBottomWidth: 0.5,
          borderBottomColor: theme.dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)",
        }}
      >
        <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: theme.textPrimary, alignItems: "center", justifyContent: "center" }}>
          <Symbol name="terminal.fill" size={9} weight="bold" color={theme.dark ? "#000000" : "#FFFFFF"} style={{ width: 14, height: 14 }} />
        </View>
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: theme.textSecondary }}>
          <Text style={{ fontWeight: "600", color: theme.textPrimary }}>The ardia command</Text>
          {" is controlling Ardia"}
        </Text>
        <PromptButton title="Stop" onPress={stopCliControl} />
      </View>
    </Animated.View>
  );
}

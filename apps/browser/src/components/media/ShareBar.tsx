import { Symbol } from "@ardia/shell";
import { useEffect, useRef } from "react";
import { Animated, Text, View } from "react-native";
import { useTheme } from "../ui/theme";
import { currentTab } from "../../state/browser/current";
import { Button } from "../ui";
import { pageOf } from "../../state/tabs/pageState";
import { dismissShareBar, shareInstead, stopSharing, useShareFor } from "../../state/media/screenShare";
import { CAPTURE_RED } from "./tokens";
import { hostOrOrigin } from "../../lib/url";
import { curve } from "../ui/motion";

const SHARE_BAR_HEIGHT = 38;

export function ShareBar({ tabId }: { tabId: string }) {
  const theme = useTheme();
  const found = useShareFor(tabId);
  const height = useRef(new Animated.Value(0)).current;
  const visible = !!found;
  useEffect(() => {
    Animated.timing(height, { toValue: visible ? SHARE_BAR_HEIGHT : 0, duration: 180, easing: curve.outCubic, useNativeDriver: false }).start();
  }, [visible]);
  const last = useRef(found);
  if (found) last.current = found;
  const shown = found ?? last.current;
  if (!shown) return null;
  const [capturer, share] = shown;
  const isShared = share.capturedTabId === tabId;
  const host = hostOrOrigin(share.origin || pageOf(capturer).security?.origin || currentTab(capturer)?.url || "");
  return (
    <Animated.View style={{ height, overflow: "hidden" }}>
      <View
        style={{
          height: SHARE_BAR_HEIGHT,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingLeft: 12,
          paddingRight: 8,
          borderBottomWidth: 0.5,
          borderBottomColor: theme.dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)",
        }}
      >
        <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: CAPTURE_RED, alignItems: "center", justifyContent: "center" }}>
          <Symbol name="rectangle.inset.filled" size={9} weight="bold" color="#FFFFFF" style={{ width: 14, height: 14 }} />
        </View>
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: theme.textSecondary }}>
          {"Sharing "}
          <Text style={{ fontWeight: "600", color: theme.textPrimary }}>{isShared ? "this tab" : "another tab"}</Text>
          {` with ${host}`}
        </Text>
        {isShared ? (
          <Button variant="pill" title="Stop Sharing" onPress={() => stopSharing(capturer)} />
        ) : (
          <Button variant="pill" title="Share This Tab Instead" primary onPress={() => void shareInstead(capturer, tabId)} />
        )}
        <Button variant="pill" title="Dismiss" onPress={() => dismissShareBar(capturer, tabId)} />
      </View>
    </Animated.View>
  );
}

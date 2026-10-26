import { useEffect, useRef, type ReactNode } from "react";
import { Animated, StyleSheet, View, type ViewStyle } from "react-native";
import { Button, curve, duration, spring, Surface, useHover, useTheme } from "../ui";
import { NTP_CARD_SHADOW, ntpCardColors } from "./tokens";

const LEAVE_SCALE = 0.98;
const LIFT = spring({ response: 0.2, damping: 0.5 });
const CLOSE_PLACE = { position: "absolute", right: -8, top: -8 } as const;

export function useNtpCardColors() {
  return useTheme().dark ? ntpCardColors.dark : ntpCardColors.light;
}

export function NtpCard({
  appearDelay,
  leaving,
  onClose,
  lift,
  pressed = false,
  style,
  children,
}: {
  appearDelay: number;
  leaving: null | (() => void);
  onClose: () => void;
  lift?: boolean;
  pressed?: boolean;
  style?: ViewStyle;
  children: ReactNode;
}) {
  const { hovered, hoverProps } = useHover();
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: duration.slow, delay: appearDelay, easing: curve.outQuad, useNativeDriver: true }).start();
  }, []);
  useEffect(() => {
    if (!lift || leaving) return;
    Animated.spring(scale, { toValue: pressed ? LEAVE_SCALE : hovered ? 1.02 : 1, ...LIFT, useNativeDriver: true }).start();
  }, [hovered, pressed, !!leaving]);
  useEffect(() => {
    if (!leaving) return;
    Animated.parallel([
      Animated.timing(scale, { toValue: LEAVE_SCALE, duration: duration.slide, easing: curve.outQuad, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: duration.slide, easing: curve.outQuad, useNativeDriver: true }),
    ]).start(() => leaving());
  }, [leaving]);

  return (
    <Animated.View {...hoverProps} style={{ ...style, opacity, transform: [{ scale }] }} pointerEvents={leaving ? "none" : "auto"}>
      {children}
      <View style={[CLOSE_PLACE, { opacity: hovered ? 1 : 0 }]} pointerEvents={hovered ? "auto" : "none"}>
        <Button variant="close" look="hud" onPress={onClose} />
      </View>
    </Animated.View>
  );
}

export function NtpCardSurface() {
  const theme = useTheme();
  const colors = useNtpCardColors();
  return (
    <Surface
      style={StyleSheet.absoluteFill}
      fill={colors.cardFill}
      cornerRadius={10}
      borderColor={colors.cardBorder}
      borderWidth={1}
      shadowColor={NTP_CARD_SHADOW.color}
      shadowOpacity={theme.dark ? ntpCardColors.dark.cardShadowOpacity : ntpCardColors.light.cardShadowOpacity}
      shadowRadius={NTP_CARD_SHADOW.radius}
      shadowOffset={NTP_CARD_SHADOW.offset}
    />
  );
}

import { Symbol } from "@ardia/shell";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { useHover } from "../primitives";
import { CHOICE_PREVIEW_SIZE, ChoicePreview, type PreviewId } from "./previews";
import { Radio, Reveal, SectionLabel, useOnboardingColors } from "./ui";

export const CONTENT_WIDTH = 368;

export const ScrollToEnd = createContext<() => void>(() => {});
const GAP = 8;
const PAD = 8;
const DEMO_STAGGER = 140;
const DEMO_LENGTH = 1600;

export type ChoiceOption<T> = { value: T; preview: PreviewId; title: string; subtitle: string };

export function ChoiceGroup<T extends string | number | boolean | null>({
  label,
  accessory,
  options,
  value,
  onChange,
  onFocus,
  order = 0,
  children,
}: {
  label: string;
  accessory?: ReactNode;
  options: ChoiceOption<T>[];
  value: T;
  onChange: (value: T) => void;
  onFocus?: (id: PreviewId | null) => void;
  order?: number;
  children?: ReactNode;
}) {
  const width = (CONTENT_WIDTH - GAP * (options.length - 1)) / options.length;
  return (
    <View style={{ gap: 8 }}>
      <SectionLabel title={label} accessory={accessory} />
      <View style={{ flexDirection: "row", gap: GAP }} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((o, i) => (
          <ChoiceCard
            key={String(o.value)}
            option={o}
            width={width}
            selected={o.value === value}
            demoDelay={(order + i) * DEMO_STAGGER}
            onPress={() => onChange(o.value)}
            onFocus={onFocus}
          />
        ))}
      </View>
      {children}
    </View>
  );
}

export const ChoicePair = ChoiceGroup;

function useDemoPulse(delay: number) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const start = setTimeout(() => setOn(true), 260 + delay);
    const stop = setTimeout(() => setOn(false), 260 + delay + DEMO_LENGTH);
    return () => {
      clearTimeout(start);
      clearTimeout(stop);
    };
  }, []);
  return on;
}

function ChoiceCard<T>({
  option,
  width,
  selected,
  demoDelay,
  onPress,
  onFocus,
}: {
  option: ChoiceOption<T>;
  width: number;
  selected: boolean;
  demoDelay: number;
  onPress: () => void;
  onFocus?: (id: PreviewId | null) => void;
}) {
  const colors = useOnboardingColors();
  const { hovered, hoverProps } = useHover();
  const demo = useDemoPulse(demoDelay);
  const focused = useRef(false);
  useEffect(() => {
    if (hovered) onFocus?.(option.preview);
    else if (focused.current) onFocus?.(null);
    focused.current = hovered;
  }, [hovered]);
  const border = selected ? 1.5 : StyleSheet.hairlineWidth * 2;
  const inner = width - PAD * 2;
  const scale = Math.min(1, inner / CHOICE_PREVIEW_SIZE.width);
  const preview = { width: CHOICE_PREVIEW_SIZE.width * scale, height: CHOICE_PREVIEW_SIZE.height * scale };
  return (
    <View {...hoverProps} style={{ width }}>
      <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={option.title}>
        {({ pressed }) => (
          <View
            mouseDownCanMoveWindow={false}
            style={{
              padding: PAD - border,
              gap: 8,
              borderRadius: 12,
              backgroundColor: hovered || selected ? colors.button : colors.row,
              borderWidth: border,
              borderColor: selected ? colors.title : colors.rowBorder,
              transform: [{ scale: pressed ? 0.98 : 1 }],
            }}
          >
            <View style={{ ...preview, alignSelf: "center", borderRadius: 7, overflow: "hidden" }}>
              <View
                style={{
                  position: "absolute",
                  left: (preview.width - CHOICE_PREVIEW_SIZE.width) / 2,
                  top: (preview.height - CHOICE_PREVIEW_SIZE.height) / 2,
                  ...CHOICE_PREVIEW_SIZE,
                  transform: scale < 1 ? [{ scale }] : [],
                }}
              >
                <ChoicePreview id={option.preview} active={hovered || selected || demo} />
              </View>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Radio on={selected} />
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ fontSize: 12.5, fontWeight: "500", color: colors.title }}>
                  {option.title}
                </Text>
                <Text numberOfLines={1} style={{ fontSize: 11, color: colors.rowSubtitle }}>
                  {option.subtitle}
                </Text>
              </View>
            </View>
          </View>
        )}
      </Pressable>
    </View>
  );
}

export function MoreOptions({ open, onToggle, children }: { open: boolean; onToggle: () => void; children: ReactNode }) {
  const colors = useOnboardingColors();
  const { hovered, hoverProps } = useHover();
  const turn = useRef(new Animated.Value(open ? 1 : 0)).current;
  const scrollToEnd = useContext(ScrollToEnd);
  const shown = useRef(false);
  if (!open) shown.current = false;
  useEffect(() => {
    Animated.timing(turn, { toValue: open ? 1 : 0, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [open]);
  return (
    <View style={{ gap: 8 }}>
      <View {...hoverProps} style={{ alignSelf: "flex-start" }}>
        <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel="More options">
          <View mouseDownCanMoveWindow={false} style={{ flexDirection: "row", alignItems: "center", gap: 6, height: 22 }}>
            <Animated.View style={{ transform: [{ rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "90deg"] }) }] }}>
              <Symbol name="chevron.right" size={9} weight="semibold" color={hovered ? colors.title : colors.subtitle} style={{ width: 12, height: 12 }} />
            </Animated.View>
            <Text style={{ fontSize: 12, fontWeight: "500", color: hovered ? colors.title : colors.subtitle }}>More options</Text>
          </View>
        </Pressable>
      </View>
      {open ? (
        <View
          onLayout={() => {
            if (shown.current) return;
            shown.current = true;
            scrollToEnd();
          }}
        >
          <Reveal style={{ gap: 6 }}>{children}</Reveal>
        </View>
      ) : null}
    </View>
  );
}

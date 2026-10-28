import { memo } from "react";
import { StyleSheet, View } from "react-native";
import { Button, hex, Surface, type IconPalette } from "../ui";
import { SIDEBAR_FIELD } from "./geometry";
import { useSidebarTokens } from "./tokens";

const SHADE_WIDTH = 2;
export const FIELD_BUTTON = { box: 24, inset: (SIDEBAR_FIELD.height - 24) / 2, radius: SIDEBAR_FIELD.radius - (SIDEBAR_FIELD.height - 24) / 2 } as const;

export const SunkenFieldFill = memo(function SunkenFieldFill({ hovered }: { hovered: boolean }) {
  const tokens = useSidebarTokens();
  return (
    <>
      <Surface
        pointerEvents="none"
        fill={hex(hovered ? tokens.fieldSunkHover : tokens.fieldSunk)}
        cornerRadius={SIDEBAR_FIELD.radius}
        borderWidth={1}
        borderColors={tokens.fieldSunkRim.map(hex)}
        style={StyleSheet.absoluteFill}
      />
      <Surface
        pointerEvents="none"
        cornerRadius={SIDEBAR_FIELD.radius - 1}
        borderWidth={SHADE_WIDTH}
        borderColors={tokens.fieldSunkShade.map(hex)}
        style={{ position: "absolute", top: 1, left: 1, right: 1, bottom: 1 }}
      />
    </>
  );
});

export function FieldSiteButton({
  icon,
  color,
  tooltip,
  active,
  palette,
  onPress,
}: {
  icon: string;
  color?: string;
  tooltip: string;
  active: boolean;
  palette: IconPalette;
  onPress: () => void;
}) {
  const tokens = useSidebarTokens();
  return (
    <View style={{ marginLeft: FIELD_BUTTON.inset, width: FIELD_BUTTON.box, height: FIELD_BUTTON.box, borderRadius: FIELD_BUTTON.radius, backgroundColor: tokens.fieldButtonPlate }}>
      <Button variant="icon" toolbar palette={palette} icon={icon} color={color} size={12} box={FIELD_BUTTON.box} radius={FIELD_BUTTON.radius} active={active} onPress={onPress} tooltip={tooltip} />
    </View>
  );
}

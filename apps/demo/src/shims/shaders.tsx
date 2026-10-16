import { View } from "react-native";
import type { PowerUpProps, WindowBackdropProps } from "@ardia-real/shaders";

export * from "@ardia-real/shaders";

export function WindowBackdrop({ colors, angle = 180, style }: WindowBackdropProps) {
  return (
    <View pointerEvents="none" style={style}>
      <div style={{ position: "absolute", inset: 0, background: `linear-gradient(${angle}deg, ${colors[0]}, ${colors[1]})` }} />
    </View>
  );
}

export function PowerUp(_props: PowerUpProps) {
  return null;
}

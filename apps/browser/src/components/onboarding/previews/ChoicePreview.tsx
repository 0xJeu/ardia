import { memo, useMemo } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { useTheme } from "../../../lib/theme";
import { useOnboardingColors } from "../ui";
import { DEMOS } from "./demos";
import { CHOICE_PREVIEW_SIZE, type PreviewId } from "./ids";
import { geo, previewPalette, useDemo, type Pal } from "./kit";

const PREVIEW_GEO = geo(CHOICE_PREVIEW_SIZE.width, CHOICE_PREVIEW_SIZE.height);

export function usePreviewPalette(): Pal {
  const colors = useOnboardingColors();
  const dark = useTheme().dark;
  return useMemo(() => previewPalette(colors, dark), [dark]);
}

export const ChoiceFrame = memo(function ChoiceFrame({ id, p, pal }: { id: PreviewId; p: Animated.Value; pal: Pal }) {
  const { Scene } = DEMOS[id];
  return (
    <View
      pointerEvents="none"
      style={{
        ...CHOICE_PREVIEW_SIZE,
        borderRadius: 7,
        overflow: "hidden",
        backgroundColor: pal.frame,
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: pal.border,
      }}
    >
      <Scene key={id} g={PREVIEW_GEO} pal={pal} p={p} />
    </View>
  );
});

export function ChoicePreview({ id, active }: { id: PreviewId; active: boolean }) {
  const pal = usePreviewPalette();
  const p = useDemo(active, DEMOS[id].duration);
  return <ChoiceFrame id={id} p={p} pal={pal} />;
}

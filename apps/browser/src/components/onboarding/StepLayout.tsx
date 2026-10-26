import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { previousStep, STEPS, useOnboarding } from "../../state/onboarding/onboarding";
import { BackButton, PrimaryButton, SecondaryButton } from "./Buttons";
import { CONTENT_WIDTH } from "./ChoiceList";
import { Reveal, StepProgress, StepTitle, useOnboardingColors } from "./Parts";

const COLUMN = { width: CONTENT_WIDTH + 56, padding: 28 };

export function StepLayout({
  title,
  subtitle,
  tag,
  pageKey,
  children,
  actions,
  preview,
}: {
  title: string;
  subtitle?: string;
  tag?: ReactNode;
  pageKey?: string | number;
  children?: ReactNode;
  actions: ReactNode;
  preview: ReactNode;
}) {
  const colors = useOnboardingColors();
  return (
    <View style={{ flex: 1, flexDirection: "row" }}>
      <View style={{ width: COLUMN.width, paddingTop: 34, paddingBottom: 28, paddingHorizontal: COLUMN.padding }}>
        <Reveal>
          <StepProgress />
        </Reveal>
        <View key={pageKey} style={{ flex: 1, marginTop: 20, overflow: "hidden" }}>
          <Reveal delay={60} style={{ gap: 10 }}>
            <StepTitle title={title} subtitle={subtitle} />
            {tag ? <View style={{ flexDirection: "row" }}>{tag}</View> : null}
          </Reveal>
          <Reveal delay={140} style={{ gap: 16, marginTop: 22 }}>
            {children}
          </Reveal>
        </View>
        <Reveal delay={240} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 14 }}>
          {actions}
        </Reveal>
      </View>
      <View
        style={{
          flex: 1,
          margin: 12,
          marginLeft: 0,
          borderRadius: 14,
          backgroundColor: colors.preview,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: colors.previewBorder,
          overflow: "hidden",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Reveal delay={120} style={{ alignItems: "center", justifyContent: "center" }}>
          {preview}
        </Reveal>
      </View>
    </View>
  );
}

export function StepActions({
  onContinue,
  continueTitle = "Continue",
  disabled,
  onSkip,
  icon,
}: {
  onContinue: () => void;
  continueTitle?: string;
  disabled?: boolean;
  onSkip?: () => void;
  icon?: string;
}) {
  const step = useOnboarding((s) => s.step);
  const sub = useOnboarding((s) => s.sub);
  const back = previousStep;
  const first = STEPS[STEPS.indexOf(step) - 1] === "intro" && sub === 0;
  return (
    <>
      {first ? null : <BackButton onPress={back} />}
      <PrimaryButton title={continueTitle} icon={icon} onPress={onContinue} disabled={disabled} />
      {onSkip ? <SecondaryButton title="Skip" onPress={onSkip} /> : null}
    </>
  );
}

import { AppRegistry, Text, View } from "react-native";
import { answerWithSkew, openSkewWindow } from "../../platform/nativeApi";

export function startSkewed(message: string) {
  console.error(`[ardia] ${message}`);
  AppRegistry.registerComponent("main", () => () => (
    <View style={{ flex: 1, backgroundColor: "#1b1416", padding: 24, paddingTop: 48 }}>
      <Text selectable style={{ color: "#ff8a8a", fontSize: 14, fontFamily: "Menlo" }}>
        {message}
      </Text>
    </View>
  ));
  openSkewWindow();
  if (__DEV__) answerWithSkew(message, "dev-eval.js", "dev-eval-result.json");
}

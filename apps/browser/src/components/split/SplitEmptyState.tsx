import { Surface, Symbol } from "@ardia/shell";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { hex, useTheme } from "../ui/theme";
import { useTab } from "../../state/browser/hooks";
import { navigate } from "../../state/tabs/actions";
import { replaceSplitPane } from "../../state/splits/actions";
import { useSplitSuggestions } from "../../state/splits/hooks";
import { tabLabel } from "../../state/browser/model";
import { useHover } from "../ui";
import { Favicon } from "../favicon/Favicon";

export function SplitEmptyState({ tabId, focused }: { tabId: string; focused: boolean }) {
  const theme = useTheme();
  const [typing, setTyping] = useState(focused);
  const [text, setText] = useState("");
  const suggestions = useSplitSuggestions(tabId);
  const go = () => {
    if (text.trim()) navigate(tabId, text.trim());
  };

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 16 }}>
      <Surface
        fill={hex(theme.dark ? "rgba(34,32,33,0.92)" : "rgba(255,255,255,0.92)")}
        cornerRadius={16}
        borderColor={hex(theme.ntpBarBorder)}
        borderWidth={0.5}
        shadowColor="#000000"
        shadowOpacity={theme.dark ? 0.3 : 0.08}
        shadowRadius={16}
        shadowOffset={[0, 6]}
        style={{ width: "100%", maxWidth: 420, paddingVertical: 10 }}
      >
        <Text style={{ fontSize: 13, fontWeight: "600", color: theme.textPrimary, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 10 }}>
          Add a tab to this Split View
        </Text>
        {typing ? (
          <View style={{ height: 36, marginHorizontal: 6, paddingHorizontal: 10, borderRadius: 9, flexDirection: "row", alignItems: "center", gap: 9, backgroundColor: theme.rowHover }}>
            <Symbol name="magnifyingglass" size={13} color={theme.textSecondary} style={{ width: 16, height: 16 }} />
            <TextInput
              autoFocus
              value={text}
              onChangeText={setText}
              placeholder="Search or Ask a Question"
              placeholderTextColor={theme.placeholder}
              selectionColor={theme.selection}
              enableFocusRing={false}
              onSubmitEditing={go}
              keyDownEvents={[{ key: "Escape" }]}
              onKeyDown={(e) => {
                if (e.nativeEvent.key === "Escape") {
                  setText("");
                  setTyping(false);
                }
              }}
              style={{ flex: 1, fontSize: 14, color: theme.textPrimary, paddingVertical: 0 }}
            />
          </View>
        ) : (
          <Row icon={<Symbol name="magnifyingglass" size={13} color={theme.textSecondary} style={{ width: 16, height: 16 }} />} label="Search or Ask a Question" secondary onPress={() => setTyping(true)} />
        )}
        {suggestions.length > 0 && <View style={{ height: 6 }} />}
        {suggestions.map((id) => (
          <Suggestion key={id} tabId={id} onPress={() => replaceSplitPane(tabId, id)} />
        ))}
      </Surface>
    </View>
  );
}

function Suggestion({ tabId, onPress }: { tabId: string; onPress: () => void }) {
  const tab = useTab(tabId);
  if (!tab) return null;
  return <Row icon={<Favicon url={tab.url} favicon={tab.favicon} profileId={tab.profileId} />} label={tabLabel(tab)} detail={tab.title} onPress={onPress} />;
}

function Row({ icon, label, detail, secondary, onPress }: { icon: React.ReactNode; label: string; detail?: string; secondary?: boolean; onPress: () => void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps}>
      <Pressable onPress={onPress}>
        {({ pressed }) => (
          <View
            style={{
              height: 36,
              marginHorizontal: 6,
              paddingHorizontal: 10,
              borderRadius: 9,
              flexDirection: "row",
              alignItems: "center",
              gap: 9,
              backgroundColor: pressed ? theme.rowSelected : hovered ? theme.rowHover : undefined,
            }}
          >
            {icon}
            <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 13, color: secondary ? theme.textSecondary : theme.textPrimary }}>
              {label}
              {detail ? <Text style={{ color: theme.textTertiary }}>{`  ${detail}`}</Text> : null}
            </Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

import { Symbol } from "@ardia/shell";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useTheme } from "../ui/theme";
import { cancelChooser, chooseDevice, openChooserBluetoothSettings, rescanDevices, useDeviceChooser } from "../../state/site/deviceChoosers";
import { PANEL, Popover, PromptButton } from "../ui/Controls";
import { useHover } from "../ui/Primitives";

function Signal({ level, color }: { level: number; color: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 1.5, height: 11 }}>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={{ width: 2.5, height: 3 + i * 2.5, borderRadius: 1, backgroundColor: color, opacity: i < level ? 1 : 0.25 }} />
      ))}
    </View>
  );
}

function OptionRow({ name, detail, signal, selected, onSelect, onChoose }: { name: string; detail: string | null; signal: number; selected: boolean; onSelect(): void; onChoose(): void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps} onDoubleClick={onChoose}>
      <Pressable onPress={onSelect}>
        <View
          style={{
            height: PANEL.rowHeight,
            borderRadius: PANEL.rowRadius,
            paddingHorizontal: PANEL.rowPadding,
            flexDirection: "row",
            alignItems: "center",
            gap: PANEL.iconGap,
            backgroundColor: selected ? (theme.dark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.08)") : hovered ? theme.rowHover : undefined,
          }}
        >
          {signal >= 0 ? <Signal level={signal} color={theme.icon} /> : null}
          <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 13, color: theme.textPrimary }}>
            {name}
          </Text>
          {detail ? <Text style={{ fontSize: 11.5, color: theme.textSecondary }}>{detail}</Text> : null}
          <View style={{ flex: 1 }} />
          {selected ? <Symbol name="checkmark" size={11} weight="semibold" color={theme.accent} style={{ width: 16, height: 16 }} /> : null}
        </View>
      </Pressable>
    </View>
  );
}

export function DeviceChooser({ tabId, left, top }: { tabId: string; left: number; top: number }) {
  const theme = useTheme();
  const chooser = useDeviceChooser(tabId);
  const [selected, setSelected] = useState<number | null>(null);
  useEffect(() => setSelected(null), [chooser?.id]);
  if (!chooser) return null;
  const scanning = chooser.bothButtonsEnabled;
  const blocked = chooser.adapterOff || chooser.unauthorized;
  const valid = scanning || (selected !== null && selected < chooser.options.length);
  const choose = (index = selected) => {
    if (scanning) return chooseDevice(chooser.id, -1);
    if (index !== null) chooseDevice(chooser.id, index);
  };
  const cancel = () => cancelChooser(chooser.id);

  let body;
  if (chooser.unauthorized) {
    body = (
      <Notice
        icon="lock"
        text="Ardia needs access to Bluetooth to find devices."
        link="Open Bluetooth Settings"
        onLink={() => openChooserBluetoothSettings(chooser.id)}
      />
    );
  } else if (chooser.adapterOff) {
    body = <Notice icon="antenna.radiowaves.left.and.right.slash" text="Bluetooth is turned off. Turn it on to find devices." />;
  } else if (scanning) {
    body = null;
  } else {
    body = (
      <>
        <ScrollView style={{ maxHeight: 200, marginHorizontal: PANEL.rowInset - PANEL.inset }} contentContainerStyle={{ gap: 2 }}>
          {chooser.options.map((o, i) => (
            <OptionRow
              key={`${i}:${o.name}`}
              name={o.name}
              detail={o.connected ? "Connected" : o.paired ? "Paired" : null}
              signal={chooser.showSignal ? o.signal : -1}
              selected={selected === i}
              onSelect={() => setSelected(i)}
              onChoose={() => choose(i)}
            />
          ))}
        </ScrollView>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7, minHeight: 22 }}>
          {chooser.refreshing ? (
            <>
              <ActivityIndicator size="small" style={{ transform: [{ scale: 0.6 }], width: 14, height: 14 }} />
              <Text style={{ fontSize: 12, color: theme.textSecondary }}>{chooser.scanningText}</Text>
            </>
          ) : (
            <>
              {!chooser.options.length ? <Text style={{ fontSize: 12, color: theme.textSecondary }}>{chooser.noOptionsText}</Text> : null}
              {chooser.canRefresh ? <TextLink title="Scan Again" onPress={() => rescanDevices(chooser.id)} /> : null}
            </>
          )}
        </View>
      </>
    );
  }

  return (
    <Popover key={chooser.id} width={340} top={top} left={left} modal={false}>
      <View
        focusable
        enableFocusRing={false}
        keyDownEvents={[{ key: "Escape" }, { key: "Enter" }]}
        onKeyDown={(e) => (e.nativeEvent.key === "Escape" ? cancel() : valid && !blocked && choose())}
        style={{ padding: PANEL.inset, gap: 10 }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
          <View style={{ width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: theme.dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.06)" }}>
            <Symbol name={chooser.showSignal || scanning ? "dot.radiowaves.left.and.right" : "cable.connector"} size={14} color={theme.icon} style={{ width: 20, height: 20 }} />
          </View>
          <Text style={{ flex: 1, fontSize: 13, fontWeight: "600", color: theme.textPrimary }}>{chooser.title}</Text>
        </View>
        {body}
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
          <PromptButton title={chooser.cancelLabel || "Cancel"} onPress={cancel} />
          <View pointerEvents={valid && !blocked ? "auto" : "none"} style={{ opacity: valid && !blocked ? 1 : 0.4 }}>
            <PromptButton title={chooser.okLabel || "Connect"} primary onPress={() => choose()} />
          </View>
        </View>
      </View>
    </Popover>
  );
}

function Notice({ icon, text, link, onLink }: { icon: string; text: string; link?: string; onLink?: () => void }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: 9, paddingVertical: 6 }}>
      <Symbol name={icon} size={13} color={theme.textSecondary} style={{ width: 18, height: 18 }} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={{ fontSize: 12.5, color: theme.textSecondary }}>{text}</Text>
        {link && onLink ? <TextLink title={link} onPress={onLink} /> : null}
      </View>
    </View>
  );
}

function TextLink({ title, onPress }: { title: string; onPress: () => void }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View {...hoverProps}>
      <Pressable onPress={onPress}>
        <Text style={{ fontSize: 12, fontWeight: "500", color: theme.accent, textDecorationLine: hovered ? "underline" : "none" }}>{title}</Text>
      </Pressable>
    </View>
  );
}

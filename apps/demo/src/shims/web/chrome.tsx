import { useEffect, useRef, type ReactNode } from "react";
import { ActivityIndicator, View, type ViewProps, type ViewStyle } from "react-native";

type Style = ViewStyle & Record<string, unknown>;

const WEIGHTS = { light: "300", regular: "400", medium: "500", semibold: "600", bold: "700" } as const;

const alphaHex = (opacity: number) => Math.round(Math.min(1, Math.max(0, opacity)) * 255).toString(16).padStart(2, "0");

const shadowColor = (color: string, opacity: number) =>
  /^#[0-9a-f]{6}$/i.test(color) ? `${color}${alphaHex(opacity)}` : `rgba(0,0,0,${opacity})`;

export type SurfaceProps = ViewProps & {
  fill?: string;
  cornerRadius?: number;
  borderColor?: string;
  borderWidth?: number;
  borderColors?: string[];
  shadowColor?: string;
  shadowOpacity?: number;
  shadowRadius?: number;
  shadowOffset?: [number, number];
};

export function Surface({ fill, cornerRadius, borderColor, borderWidth, borderColors, shadowColor: color, shadowOpacity, shadowRadius, shadowOffset, style, ...props }: SurfaceProps) {
  const surface: Style = {
    backgroundColor: fill,
    borderRadius: cornerRadius,
    borderColor: borderColor ?? borderColors?.[0],
    borderWidth: borderWidth ?? (borderColors?.length ? 0.5 : undefined),
    borderStyle: "solid",
  };
  if (shadowOpacity && shadowRadius !== undefined) {
    const [x, y] = shadowOffset ?? [0, 0];
    surface.boxShadow = `${x}px ${y}px ${shadowRadius}px ${shadowColor(color ?? "#000000", shadowOpacity)}`;
  }
  return <View {...props} style={[surface, style]} />;
}

const MATERIAL_FILL: Record<string, string> = {
  popover: "rgba(246,246,246,0.72)",
  menu: "rgba(246,246,246,0.72)",
  hudWindow: "rgba(30,30,30,0.6)",
  sidebar: "rgba(240,240,240,0.5)",
  underWindowBackground: "rgba(240,240,240,0.4)",
};

export type VisualEffectProps = ViewProps & { material?: string; blendingMode?: "withinWindow" | "behindWindow"; cornerRadius?: number };

export function VisualEffect({ material = "popover", cornerRadius, style, ...props }: VisualEffectProps) {
  const glass: Style = {
    backgroundColor: MATERIAL_FILL[material] ?? "rgba(246,246,246,0.6)",
    backdropFilter: "blur(24px) saturate(180%)",
    WebkitBackdropFilter: "blur(24px) saturate(180%)",
    borderRadius: cornerRadius,
    overflow: cornerRadius ? "hidden" : undefined,
  };
  return <View {...props} style={[glass, style]} />;
}

export type GlassEffectProps = ViewProps & { cornerRadius?: number; tint?: string; glassStyle?: "regular" | "clear"; dark?: boolean };

export function GlassEffect({ cornerRadius, tint, glassStyle = "regular", dark, style, ...props }: GlassEffectProps) {
  const glass: Style = {
    backgroundColor: tint ?? (dark ? "rgba(40,40,40,0.45)" : glassStyle === "clear" ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.5)"),
    backdropFilter: "blur(18px) saturate(170%)",
    WebkitBackdropFilter: "blur(18px) saturate(170%)",
    borderRadius: cornerRadius,
    borderWidth: 0.5,
    borderColor: dark ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.6)",
  };
  return <View {...props} style={[glass, style]} />;
}

export type FadeLabelProps = ViewProps & { text: string; fontSize?: number; weight?: keyof typeof WEIGHTS; color?: string; fadeWidth?: number };

export function FadeLabel({ text, fontSize = 13, weight = "regular", color, fadeWidth = 16, style, ...props }: FadeLabelProps) {
  const fade = `linear-gradient(to right, #000 calc(100% - ${fadeWidth}px), transparent)`;
  return (
    <View {...props} style={[{ justifyContent: "center", overflow: "hidden" }, style]}>
      <div
        style={{
          whiteSpace: "nowrap",
          overflow: "hidden",
          fontSize,
          fontWeight: WEIGHTS[weight],
          color,
          lineHeight: `${Math.round(fontSize * 1.25)}px`,
          maskImage: fade,
          WebkitMaskImage: fade,
          userSelect: "none",
        }}
      >
        {text}
      </div>
    </View>
  );
}

export function ActivitySpinner(props: ViewProps) {
  return (
    <View {...props} style={[{ alignItems: "center", justifyContent: "center" }, props.style]}>
      <ActivityIndicator size="small" color="#8E8E93" />
    </View>
  );
}

export type ContextMenuAreaProps = ViewProps & { onContextMenu?: () => void; captureDescendants?: boolean };

export function ContextMenuArea({ onContextMenu, captureDescendants: _capture, ...props }: ContextMenuAreaProps) {
  const WebView = View as unknown as React.ComponentType<ViewProps & { onContextMenu?: (e: MouseEvent) => void }>;
  return (
    <WebView
      {...props}
      onContextMenu={(e) => {
        if (!onContextMenu) return;
        e.preventDefault();
        e.stopPropagation();
        onContextMenu();
      }}
    />
  );
}

export function OutsidePressArea({ onOutsidePress, ...props }: ViewProps & { onOutsidePress?: () => void; children?: ReactNode }) {
  const node = useRef<HTMLElement | null>(null);
  const latest = useRef(onOutsidePress);
  latest.current = onOutsidePress;
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (node.current && e.target instanceof Node && !node.current.contains(e.target)) latest.current?.();
    };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, []);
  return <View {...props} ref={(view) => void (node.current = view as unknown as HTMLElement | null)} />;
}

export function WindowDragRegion({ titleBarDoubleClick: _double, onRegionDoubleClick: _onDouble, ...props }: ViewProps & { titleBarDoubleClick?: boolean; onRegionDoubleClick?: () => void }) {
  return <View {...props} />;
}

export type DockSelectionProps = ViewProps & { fill?: string; stroke?: string; cornerRadius?: number; strokeWidth?: number; dark: boolean };

export function DockSelection({ fill, stroke, cornerRadius, strokeWidth, dark: _dark, style, ...props }: DockSelectionProps & Record<string, unknown>) {
  return <View {...props} style={[{ backgroundColor: fill, borderColor: stroke, borderWidth: stroke ? (strokeWidth ?? 1) : 0, borderRadius: cornerRadius }, style]} />;
}

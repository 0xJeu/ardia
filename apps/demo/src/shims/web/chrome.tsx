import { useEffect, useRef, useState, type ReactNode } from "react";
import { View, type ViewProps, type ViewStyle } from "react-native";
import { useBrowser } from "../../../../browser/src/store/browser";

type Style = ViewStyle & Record<string, unknown>;


export function parseColor(color: string): [number, number, number, number] | null {
  const hex = color.trim().match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
  if (hex) {
    const v = parseInt(hex[1]!, 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255, hex[2] ? parseInt(hex[2], 16) / 255 : 1];
  }
  const fn = color.match(/rgba?\(([^)]+)\)/);
  if (!fn) return null;
  const [r = 0, g = 0, b = 0, a = 1] = fn[1]!.split(",").map((v) => Number(v.trim()));
  return [r, g, b, a];
}

export const rgbaString = ([r, g, b, a]: [number, number, number, number]) => `rgba(${r},${g},${b},${+a.toFixed(4)})`;

function withOpacity(color: string, opacity: number) {
  const c = parseColor(color);
  return c ? rgbaString([c[0], c[1], c[2], c[3] * opacity]) : color;
}

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

export const CA_SHADOW_BLUR = 2;

export function Surface({ fill, cornerRadius = 0, borderColor, borderWidth = 0, borderColors, shadowColor: color, shadowOpacity = 0, shadowRadius = 0, shadowOffset, style, children, ...props }: SurfaceProps) {
  const gradientBorder = !!borderColors && borderColors.length >= 2 && borderWidth > 0;
  const surface: Style = {
    backgroundColor: fill,
    borderRadius: cornerRadius,
    ...(borderColor && borderWidth > 0 && !gradientBorder ? { borderColor, borderWidth, borderStyle: "solid" } : {}),
  };
  if (color && shadowOpacity > 0) {
    const [x, y] = shadowOffset ?? [0, 0];
    surface.boxShadow = `${x}px ${y}px ${shadowRadius * CA_SHADOW_BLUR}px ${withOpacity(color, shadowOpacity)}`;
  }
  return (
    <View {...props} style={[surface, style]}>
      {gradientBorder ? (
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            borderRadius: cornerRadius,
            border: `${borderWidth}px solid transparent`,
            background: `linear-gradient(to bottom, ${borderColors!.join(", ")}) border-box`,
            mask: "linear-gradient(#000 0 0) padding-box exclude, linear-gradient(#000 0 0) border-box",
            WebkitMask: "linear-gradient(#000 0 0) padding-box, linear-gradient(#000 0 0) border-box",
            WebkitMaskComposite: "xor",
          }}
        />
      ) : null}
      {children}
    </View>
  );
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

export const GLASS_OUTSET = 0.5;

export const GLASS = {
  light: { saturate: 3.6, slope: 0.42, offset: 143.2, ring: [0.14, 0.33], highlight: 1.65, highlightInner: 0.585, glow: 1.05 },
  dark: { saturate: 1.25, slope: 1, offset: 27.5, ring: [0, 0.355], highlight: 1.65, highlightInner: 0.585, glow: 1.12 },
} as const;

function glassFilter(saturate: number, slope: number, offset: number) {
  const brightness = slope + (2 * offset) / 255;
  return `saturate(${saturate}) contrast(${(slope / brightness).toFixed(5)}) brightness(${brightness.toFixed(5)})`;
}

const RIM = "linear-gradient(#000 0 0) padding-box exclude, linear-gradient(#000 0 0) border-box";
const RIM_WEBKIT = "linear-gradient(#000 0 0) padding-box, linear-gradient(#000 0 0) border-box";

function rim(width: number, radius: number, background: string): React.CSSProperties {
  return {
    position: "absolute",
    inset: 0,
    borderRadius: radius,
    border: `${width}px solid transparent`,
    background: `${background} border-box`,
    mask: RIM,
    WebkitMask: RIM_WEBKIT,
    WebkitMaskComposite: "xor",
    pointerEvents: "none",
  };
}

const edgeBands = (stops: [number, number][]) => {
  const top = stops.map(([alpha, at]) => `rgba(0,0,0,${alpha}) ${at}px`).join(", ");
  const bottom = [...stops].reverse().map(([alpha, at]) => `rgba(0,0,0,${alpha}) calc(100% - ${at}px)`).join(", ");
  return `linear-gradient(to bottom, ${top}, ${bottom})`;
};

function backdropLayer(radius: number, filter: string, mask?: string): React.CSSProperties {
  return {
    position: "absolute",
    inset: 0,
    borderRadius: radius,
    backdropFilter: filter,
    WebkitBackdropFilter: filter,
    ...(mask ? { mask, WebkitMask: mask } : {}),
    pointerEvents: "none",
  };
}

const HIGHLIGHT_MASK = (inner: number) => edgeBands([[0, 0], [0, 0.5], [1, 0.5], [1, 1], [inner, 1], [inner, 1.5], [0, 1.5], [0, 8]]);
const GLOW_MASK = edgeBands([[0, 1.5], [1, 1.5], [0.67, 2], [0.54, 2.5], [0.38, 3], [0.25, 3.5], [0.1, 4.5], [0, 5.5], [0, 8]]);

let rimIds = 0;

function RimStroke({ radius, ends, sides, width = 0.5 }: { radius: number; ends: number; sides: number; width?: number }) {
  const [id] = useState(() => `ardia-rim-${++rimIds}`);
  const half = width / 2;
  return (
    <svg aria-hidden style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none" }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "#000", stopOpacity: ends }} />
          <stop offset="0.3" style={{ stopColor: "#000", stopOpacity: sides }} />
          <stop offset="0.7" style={{ stopColor: "#000", stopOpacity: sides }} />
          <stop offset="1" style={{ stopColor: "#000", stopOpacity: ends }} />
        </linearGradient>
      </defs>
      <rect
        style={{ x: half, y: half, width: `calc(100% - ${width}px)`, height: `calc(100% - ${width}px)`, rx: radius - half, ry: radius - half } as React.CSSProperties}
        fill="none"
        stroke={`url(#${id})`}
        strokeWidth={width}
      />
    </svg>
  );
}

export function GlassEffect({ cornerRadius = 0, tint, glassStyle = "regular", dark, style, ...props }: GlassEffectProps) {
  const appDark = useBrowser((s) => s.ui.appDark);
  const g = GLASS[(dark ?? appDark) ? "dark" : "light"];
  const clear = glassStyle === "clear";
  const filter = clear ? glassFilter(1, (1 + g.slope) / 2, g.offset / 2) : glassFilter(g.saturate, g.slope, g.offset);
  const [ringEnd, ringSide] = g.ring;
  const radius = cornerRadius + GLASS_OUTSET;
  return (
    <View pointerEvents="none" {...props} style={style}>
      <div style={{ position: "absolute", inset: -GLASS_OUTSET, borderRadius: radius, overflow: "hidden" }}>
        <div style={backdropLayer(radius, filter)} />
        {tint ? <div style={{ position: "absolute", inset: 0, borderRadius: radius, background: tint }} /> : null}
        <div style={backdropLayer(radius, `brightness(${g.glow})`, GLOW_MASK)} />
        <div style={backdropLayer(radius, `brightness(${g.highlight})`, HIGHLIGHT_MASK(g.highlightInner))} />
        <RimStroke radius={radius} ends={ringEnd} sides={ringSide} />
      </div>
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

export function WindowDragRegion({ titleBarDoubleClick: _double, onRegionDoubleClick, ...props }: ViewProps & { titleBarDoubleClick?: boolean; onRegionDoubleClick?: () => void }) {
  const Region = View as unknown as React.ComponentType<ViewProps & { onDoubleClick?: () => void }>;
  return <Region {...props} onDoubleClick={onRegionDoubleClick} />;
}

export type DockSelectionProps = ViewProps & { fill?: string; stroke?: string; cornerRadius?: number; strokeWidth?: number; dark: boolean };

export function DockSelection({ fill, stroke, cornerRadius, strokeWidth, dark: _dark, style, ...props }: DockSelectionProps & Record<string, unknown>) {
  return <View {...props} style={[{ backgroundColor: fill, borderColor: stroke, borderWidth: stroke ? (strokeWidth ?? 1) : 0, borderRadius: cornerRadius }, style]} />;
}

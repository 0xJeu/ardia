import { useSyncExternalStore } from "react";

const DEFAULT_CENTER: [number, number] = [25, 27];
const SPACING = 20;
const DIAMETER = 14;
const COLORS = [
  ["#FF5F57", "#E2463F"],
  ["#FEBC2E", "#E1A116"],
  ["#28C840", "#14AE2C"],
] as const;

let center: [number, number] | null = DEFAULT_CENTER;
const watchers = new Set<() => void>();

export function setTrafficLightsCenter(_windowId: string, next: [number, number] | null) {
  center = next ?? DEFAULT_CENTER;
  for (const watcher of watchers) watcher();
  return Promise.resolve();
}

export function TrafficLights() {
  const at = useSyncExternalStore(
    (watch) => (watchers.add(watch), () => void watchers.delete(watch)),
    () => center,
  );
  if (!at) return null;
  return (
    <div aria-hidden style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none", zIndex: 1000 }}>
      {COLORS.map(([fill, edge], i) => (
        <span
          key={fill}
          style={{
            position: "absolute",
            left: at[0] + i * SPACING - DIAMETER / 2,
            top: at[1] - DIAMETER / 2,
            width: DIAMETER,
            height: DIAMETER,
            borderRadius: DIAMETER / 2,
            background: fill,
            boxShadow: `inset 0 0 0 0.5px ${edge}`,
          }}
        />
      ))}
    </div>
  );
}

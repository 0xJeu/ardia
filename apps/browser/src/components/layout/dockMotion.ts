import { create } from "zustand";

export const DOCK_SPRING = { response: 0.215, damping: 0.79 } as const;

export const ARC_PEEK_SPRING = { response: 0.185, damping: 0.77 } as const;
export const ARC_PEEK_OUT_MS = 150;
export const ARC_HIDE_MS = 100;

export const easeOutCubic = (u: number) => 1 - (1 - u) ** 3;
export const easeInOutCubic = (u: number) => (u < 0.5 ? 4 * u ** 3 : 1 - (-2 * u + 2) ** 3 / 2);

export function springConfig({ response, damping }: { response: number; damping: number }) {
  const omega = (2 * Math.PI) / response;
  return { stiffness: omega * omega, damping: 2 * damping * omega, mass: 1 };
}

export function springAt(
  t: number,
  { response, damping }: { response: number; damping: number } = DOCK_SPRING,
): number {
  if (t <= 0) return 0;
  const omega = (2 * Math.PI) / response;
  const wd = omega * Math.sqrt(1 - damping * damping);
  return 1 - Math.exp(-damping * omega * t) * (Math.cos(wd * t) + ((damping * omega) / wd) * Math.sin(wd * t));
}

export const LIGHTS_CENTER: readonly [number, number] = [25, 27];

export const PEEK_ORIGIN: readonly [number, number] = [6, 6];

export function lightsCenter(offset: number, down = 0): [number, number] | null {
  const dx = Math.round(offset * 2) / 2;
  return dx === 0 && down === 0 ? null : [LIGHTS_CENTER[0] - dx, LIGHTS_CENTER[1] + down];
}

export const cardLeft = (dock: number, width: number, inset: number) => inset + (width - inset) * dock;

type DockMotion = { moving: Record<string, true> };
export const useDockMotion = create<DockMotion>()(() => ({ moving: {} }));

export const dockMoving = (windowId: string) => !!useDockMotion.getState().moving[windowId];

export function setDockMoving(windowId: string, moving: boolean) {
  const current = useDockMotion.getState().moving;
  if (!!current[windowId] === moving) return;
  const { [windowId]: _, ...rest } = current;
  useDockMotion.setState({
    moving: moving ? { ...current, [windowId]: true } : rest,
  });
}

const peeking = new Set<string>();
export const setPeekShown = (windowId: string, shown: boolean) => void (shown ? peeking.add(windowId) : peeking.delete(windowId));
export const peekShown = (windowId: string) => peeking.has(windowId);
export const devPeeks: Record<string, { show(): void; hide(): void }> = {};

export const HEADER_TOOLS = { toggleX: 70.75 + 27, pitch: 35, edge: 7, lightsRight: 70.75 + 7 } as const;

export const HEADER_MIN_GAP = 2;

export type HeaderButton = "back" | "forward" | "reload";

export function navButtonsFitting(width: number, button = 30): { buttons: HeaderButton[]; step: number } {
  const { toggleX, pitch, edge } = HEADER_TOOLS;
  const span = width - edge - button / 2 - toggleX;
  const count = Math.max(0, Math.min(3, Math.floor(span / (button + HEADER_MIN_GAP))));
  const buttons: HeaderButton[] = count === 3 ? ["back", "forward", "reload"] : count === 2 ? ["back", "reload"] : count === 1 ? ["back"] : [];
  return { buttons, step: count ? Math.min(pitch, span / count) : pitch };
}

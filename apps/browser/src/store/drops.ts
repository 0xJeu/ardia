import type { BrowserState } from "./browser";
import type { TabPlacement } from "./organize";

type Slot = { readonly tabIds: readonly string[] };
type Order = Pick<BrowserState, "tabs" | "windows">;

export type Lane = { pinned: boolean; groupId: string | null };

export function firstStaying(slots: readonly Slot[], moving: readonly string[]): string | null {
  for (const slot of slots) for (const id of slot.tabIds) if (!moving.includes(id)) return id;
  return null;
}

export function tabAfter(s: Order, id: string | undefined, moving: readonly string[]): string | null {
  const w = id ? s.windows[s.tabs[id]?.windowId ?? ""] : undefined;
  if (!w || !id) return null;
  return w.tabIds.slice(w.tabIds.indexOf(id) + 1).find((t) => !moving.includes(t)) ?? null;
}

export function slotAnchor(s: Order, slots: readonly Slot[], from: number, to: number, moving: readonly string[]): string | null {
  const others = slots.filter((_, i) => i !== from);
  return firstStaying(others.slice(to), moving) ?? tabAfter(s, others.at(-1)?.tabIds.at(-1), moving);
}

export function slotPlacement(s: Order, ids: readonly string[], slots: readonly Slot[], from: number, to: number, lane: Lane): TabPlacement | null {
  if (to === from || !ids.length) return null;
  return { pinned: lane.pinned, groupId: lane.groupId, beforeId: slotAnchor(s, slots, from, to, ids) };
}

import type { BrowserState } from "./browser";
import { rootOf } from "./groups";
import { pinKeyOf } from "./pinMirror";
import type { BrowserWindow, TabGroup } from "./types";

type Block = { key: string; row: boolean; ids: string[] };

function pinnedBlocks(s: Pick<BrowserState, "tabs" | "groups">, w: BrowserWindow, profileId: string): Block[] {
  const blocks: Block[] = [];
  const byRoot = new Map<string, Block>();
  const pinnedRoot = new Map<string, TabGroup>();
  for (const g of Object.values(s.groups)) {
    if (!g.pinned || g.windowId !== w.id || g.profileId !== profileId) continue;
    const root = rootOf(s.groups, g.id) ?? g;
    for (const id of g.tabIds) pinnedRoot.set(id, root);
  }
  for (const id of w.tabIds) {
    const t = s.tabs[id];
    if (!t || t.profileId !== profileId) continue;
    if (t.pinned) {
      if (t.pinnedAsRow) blocks.push({ key: `t:${pinKeyOf(t)}`, row: true, ids: [id] });
      continue;
    }
    const root = pinnedRoot.get(id);
    if (!root) continue;
    const known = byRoot.get(root.id);
    if (known) known.ids.push(id);
    else {
      const block = { key: `g:${pinKeyOf(root)}`, row: false, ids: [id] };
      byRoot.set(root.id, block);
      blocks.push(block);
    }
  }
  return blocks;
}

export type Anchors = Map<string, string | null>;

function anchorsOf(keys: string[]): Anchors {
  const anchors: Anchors = new Map();
  let row: string | null = null;
  for (const key of keys) {
    if (key.startsWith("t:")) row = key.slice(2);
    else anchors.set(key.slice(2), row);
  }
  return anchors;
}

export function parkedAnchors(s: Pick<BrowserState, "parkedPins">, profileId: string): Anchors {
  const park = s.parkedPins[profileId];
  if (!park) return new Map();
  const parentOf = new Map(park.groups.map((g) => [g.id, g.parentId]));
  const rootOf = (id: string) => {
    const seen = new Set([id]);
    let root = id;
    for (let up = parentOf.get(root); up && parentOf.has(up) && !seen.has(up); up = parentOf.get(root)) {
      seen.add(up);
      root = up;
    }
    return root;
  };
  const keys: string[] = [];
  for (const t of park.tabs) {
    const key = t.groupId ? `g:${rootOf(t.groupId)}` : t.pinnedAsRow ? `t:${t.id}` : null;
    if (key && !keys.includes(key)) keys.push(key);
  }
  return anchorsOf(keys);
}

export const pinnedAreaKeys = (s: Pick<BrowserState, "tabs" | "groups">, w: BrowserWindow, profileId: string): string[] =>
  pinnedBlocks(s, w, profileId).map((b) => b.key);

export const pinnedAnchors = (s: Pick<BrowserState, "tabs" | "groups">, w: BrowserWindow, profileId: string): Anchors => anchorsOf(pinnedAreaKeys(s, w, profileId));

export function arrangePinnedArea(s: Pick<BrowserState, "tabs" | "groups">, w: BrowserWindow, profileId: string, anchorOf: (groupKey: string) => string | null | undefined): string[] {
  const blocks = pinnedBlocks(s, w, profileId);
  const rows = blocks.filter((b) => b.row);
  const groups = blocks.filter((b) => !b.row);
  const rowKeys = new Set(rows.map((r) => r.key.slice(2)));
  const placed = new Map<string | null, Block[]>();
  const last: Block[] = [];
  for (const g of groups) {
    const anchor = anchorOf(g.key.slice(2));
    if (anchor === null || (anchor !== undefined && rowKeys.has(anchor))) placed.get(anchor)?.push(g) ?? placed.set(anchor, [g]);
    else last.push(g);
  }
  if (!placed.size) return w.tabIds;
  const order = [...(placed.get(null) ?? []), ...rows.flatMap((r) => [r, ...(placed.get(r.key.slice(2)) ?? [])]), ...last].flatMap((b) => b.ids);
  const area = new Set(order);
  const at = w.tabIds.findIndex((id) => area.has(id));
  const rest = w.tabIds.filter((id) => !area.has(id));
  const next = [...rest.slice(0, at), ...order, ...rest.slice(at)];
  return next.every((id, i) => id === w.tabIds[i]) ? w.tabIds : next;
}

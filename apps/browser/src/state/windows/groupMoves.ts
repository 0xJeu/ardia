import type { BrowserState } from "../browser/store";
import type { TabGroup } from "../browser/types";
import { newId } from "../browser/model";
import { descendantIds, nestGroups, withGroupsPlaced, withParent } from "../groups/groups";

export function groupTree(groups: Record<string, TabGroup>, groupId: string): TabGroup[] {
  const root = groups[groupId];
  return root ? [withParent(root, undefined), ...descendantIds(groups, groupId).map((id) => groups[id]!)] : [];
}

export function regrouped(s: BrowserState, tree: TabGroup[], windowId: string, profileId: string, fresh: boolean): BrowserState {
  const ids = new Map(tree.map((g) => [g.id, fresh || s.groups[g.id] ? newId("g") : g.id]));
  const groups = { ...s.groups };
  for (const g of tree) {
    const tabIds = g.tabIds.filter((id) => s.tabs[id]?.windowId === windowId && s.tabs[id]?.profileId === profileId);
    if (!tabIds.length) continue;
    const id = ids.get(g.id)!;
    const parentId = g.parentId ? ids.get(g.parentId) : undefined;
    const { pinKey: _, ...unkeyed } = g;
    groups[id] = withParent({ ...(fresh ? unkeyed : g), id, windowId, profileId, tabIds }, parentId && groups[parentId] ? parentId : undefined);
  }
  const w = s.windows[windowId];
  if (!w) return s;
  const order = (tree[0]?.tabIds ?? []).filter((id) => w.tabIds.includes(id));
  const members = new Set(order);
  let next = 0;
  const tabIds = w.tabIds.map((id) => (members.has(id) ? order[next++]! : id));
  return withGroupsPlaced({ ...s, windows: { ...s.windows, [windowId]: { ...w, tabIds } } }, windowId, nestGroups(groups));
}

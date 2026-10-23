import { useBrowser, type BrowserState } from "./browser";
import { isIncognitoProfile } from "./model";
import { nextPinChoice, orderChoiceKey } from "./organize";
import { anchorsOf, pinnedAreaKeys } from "./pinnedArea";

let remote = 0;

export function fromSync<T>(apply: () => T): T {
  remote++;
  try {
    return apply();
  } finally {
    remote--;
  }
}

function homes(s: BrowserState): Map<string, string> {
  const out = new Map<string, string>();
  for (const profileId of new Set(Object.values(s.groups).filter((g) => g.pinned && !g.parentId).map((g) => g.profileId))) {
    if (isIncognitoProfile(profileId)) continue;
    const home = [...s.ui.focusOrder, ...s.windowOrder].map((id) => s.windows[id]).find((w) => !!w && !w.incognito && w.kind !== "small" && w.tabIds.some((id) => s.tabs[id]?.profileId === profileId));
    if (home) out.set(profileId, home.id);
  }
  return out;
}

export function noteOrderChoices(s: BrowserState, prev: BrowserState) {
  if (remote) return;
  if (s.groups === prev.groups && Object.values(s.windows).every((w) => w.tabIds === prev.windows[w.id]?.tabIds)) return;
  const homesBefore = homes(prev);
  let pinChoices = s.pinChoices;
  for (const [profileId, windowId] of homes(s)) {
    if (homesBefore.get(profileId) !== windowId) continue;
    const before = pinnedAreaKeys(prev, prev.windows[windowId]!, profileId);
    const after = pinnedAreaKeys(s, s.windows[windowId]!, profileId);
    const kept = new Set(before.filter((k) => after.includes(k)));
    const was = anchorsOf(before.filter((k) => kept.has(k)));
    const moved = [...anchorsOf(after.filter((k) => kept.has(k)))].filter(([group, a]) => was.get(group) !== a).map(([group]) => orderChoiceKey(group));
    if (moved.length) pinChoices = { ...pinChoices, [profileId]: { ...pinChoices[profileId], ...Object.fromEntries(moved.map((k) => [k, nextPinChoice()])) } };
  }
  if (pinChoices !== s.pinChoices) useBrowser.setState({ pinChoices });
}

useBrowser.subscribe(noteOrderChoices);

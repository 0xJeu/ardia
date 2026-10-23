import type { Adapter, Extraction } from "@ardia/sync";
import { useBrowser, type BrowserState } from "../../store/browser";
import { pinKeyOf } from "../../store/pinMirror";
import { tileFolderOf, withTileFolder } from "../../store/tileFolders";
import type { Tab, TileFolder } from "../../store/types";

const store = () => useBrowser.getState();

type Window = BrowserState["windows"][string];

const openWindows = (s: BrowserState) => s.windowOrder.map((id) => s.windows[id]).filter((w): w is Window => !!w && !w.incognito && w.kind !== "small");

function homeWindow(s: BrowserState, profileId: string): Window | undefined {
  const order = [...s.ui.focusOrder, ...s.windowOrder].map((id) => s.windows[id]).filter((w): w is Window => !!w && !w.incognito && w.kind !== "small");
  const shows = (w: Window) => w.tabIds.some((id) => s.tabs[id]?.profileId === profileId);
  return order.find((w) => w.profileId === profileId && shows(w)) ?? order.find(shows) ?? order.find((w) => w.profileId === profileId) ?? order[0];
}

const TILE_FOLDER = "tilefold:";
type TileFolderValue = { f: string; n: string };

const syncedFolder = (value: unknown): TileFolder | undefined => {
  const v = value as TileFolderValue | undefined;
  return v && typeof v.f === "string" ? { id: v.f, name: typeof v.n === "string" ? v.n : "" } : undefined;
};
const folderMark = (base: (key: string) => unknown, key: string) => {
  const folder = syncedFolder(base(`${TILE_FOLDER}${key}`));
  return folder ? { tileFolder: folder } : {};
};

export function tileFoldersAdapter(profileId: string): Adapter {
  const keyOf = (k: string) => k.slice(TILE_FOLDER.length);
  return {
    prefix: TILE_FOLDER,
    extract: (base) => {
      const s = store();
      const values = new Map<string, unknown>();
      const known = new Set<string>();
      const mark = (key: string, folder: TileFolder | undefined) => {
        known.add(key);
        if (folder) values.set(`${TILE_FOLDER}${key}`, { f: folder.id, n: folder.name } satisfies TileFolderValue);
      };
      const home = homeWindow(s, profileId);
      for (const w of home ? [home, ...openWindows(s).filter((w) => w.id !== home.id)] : openWindows(s)) {
        for (const id of w.tabIds) {
          const t = s.tabs[id];
          if (t?.pinned && t.profileId === profileId && !known.has(pinKeyOf(t))) mark(pinKeyOf(t), tileFolderOf(t));
        }
      }
      for (const p of s.parkedPins[profileId]?.tabs ?? []) if (!p.groupId && !known.has(p.id)) mark(p.id, p.pinnedAsRow ? undefined : p.tileFolder);
      return { values, ignore: (k) => !known.has(keyOf(k)) && base(`pin:t:${keyOf(k)}`) === undefined } satisfies Extraction;
    },
    apply: (visible, changed) => {
      const s = store();
      const touched = new Set([...changed].map(keyOf));
      const shared = new Map<string, TileFolder>();
      const wanted = (key: string) => {
        const folder = syncedFolder(visible.get(`${TILE_FOLDER}${key}`));
        if (!folder) return undefined;
        const same = shared.get(`${folder.id}\u0001${folder.name}`);
        if (same) return same;
        shared.set(`${folder.id}\u0001${folder.name}`, folder);
        return folder;
      };
      const differs = (a: TileFolder | undefined, b: TileFolder | undefined) => a?.id !== b?.id || a?.name !== b?.name;
      let tabs: Record<string, Tab> | null = null;
      for (const w of openWindows(s)) {
        for (const id of w.tabIds) {
          const t = s.tabs[id];
          if (!t?.pinned || t.pinnedAsRow || t.profileId !== profileId || !touched.has(pinKeyOf(t))) continue;
          const folder = wanted(pinKeyOf(t));
          if (differs(t.tileFolder, folder)) (tabs ??= { ...s.tabs })[id] = withTileFolder(t, folder);
        }
      }
      const park = s.parkedPins[profileId];
      const parked = park?.tabs.map((p) => {
        if (p.groupId || p.pinnedAsRow || !touched.has(p.id) || !differs(p.tileFolder, wanted(p.id))) return p;
        const { tileFolder: _, ...rest } = p;
        const folder = wanted(p.id);
        return folder ? { ...rest, tileFolder: folder } : rest;
      });
      const parkEdited = !!park && parked!.some((p, i) => p !== park.tabs[i]);
      if (!tabs && !parkEdited) return true;
      useBrowser.setState({
        ...(tabs ? { tabs } : {}),
        ...(parkEdited ? { parkedPins: { ...s.parkedPins, [profileId]: { ...park!, tabs: parked! } } } : {}),
      });
      return true;
    },
  };
}


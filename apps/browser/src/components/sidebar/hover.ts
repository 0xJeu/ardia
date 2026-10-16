import { useContext, useEffect, useReducer, useRef, useState } from "react";
import { markHoverProps } from "../../lib/hoverShift";
import { useBrowser } from "../../store/browser";
import { PageProfileContext } from "../../store/hooks";
import { measureRow, setSidebarUi, sidebarUi, type Target } from "./state";

const SHOW_DELAY_MS = 650;
const HIDE_DELAY_MS = 160;
let showTimer: ReturnType<typeof setTimeout> | undefined;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
let suppressed = false;
let ticket = 0;
let underPointer: string | null = null;
let owner: string | null = null;
let ownerWindow: string | null = null;

export const pointerOnRow = (id: string) => underPointer === id;

const panelOpen = (windowId: string) => !!useBrowser.getState().windowUi[windowId]?.panel?.open;
const covered = new Set<string>();
const pointedRows = new Map<string, Set<() => void>>();

export function setRowsCovered(windowId: string, on: boolean) {
  if (on === covered.has(windowId)) return;
  if (on) covered.add(windowId);
  else covered.delete(windowId);
  for (const refresh of pointedRows.get(windowId) ?? []) refresh();
}

function pointed(windowId: string, refresh: () => void, on: boolean) {
  let rows = pointedRows.get(windowId);
  if (on) {
    if (!rows) pointedRows.set(windowId, (rows = new Set()));
    rows.add(refresh);
  } else if (rows?.delete(refresh) && !rows.size) pointedRows.delete(windowId);
}

export function suppressHover(value: boolean) {
  suppressed = value;
  if (value) dismissHover();
}

async function show(windowId: string, target: Target, mine: number) {
  const anchor = await measureRow(windowId, target.id);
  if (mine !== ticket || suppressed || !anchor || panelOpen(windowId) || sidebarUi().iconPicker || sidebarUi().renaming) return;
  setSidebarUi({ hover: { windowId, ...target, anchor } });
}

export function hoverEnter(windowId: string, target: Target) {
  if (suppressed || panelOpen(windowId)) return;
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  const current = sidebarUi().hover;
  owner = target.id;
  ownerWindow = windowId;
  if (current?.id === target.id) return;
  const mine = ++ticket;
  if (current) void show(windowId, target, mine);
  else showTimer = setTimeout(() => void show(windowId, target, mine), SHOW_DELAY_MS);
}

export function hoverLeave(from?: unknown) {
  if (typeof from === "string" && from !== owner) return;
  owner = null;
  ticket++;
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => setSidebarUi({ hover: null }), HIDE_DELAY_MS);
}

export const keepHover = () => clearTimeout(hideTimer);

export function dismissHover() {
  owner = null;
  ownerWindow = null;
  ticket++;
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  if (sidebarUi().hover) setSidebarUi({ hover: null });
}

export function dismissHoverIn(windowId: string) {
  if (ownerWindow === windowId || sidebarUi().hover?.windowId === windowId) dismissHover();
}

function releaseAnchor(windowId: string, id: string) {
  if (underPointer === id) underPointer = null;
  if (owner === id && ownerWindow === windowId) return dismissHover();
  const hover = sidebarUi().hover;
  if (hover?.windowId === windowId && hover.id === id) setSidebarUi({ hover: null });
}

export function useRowHover(windowId: string, target: Target | null) {
  const [hovered, setHovered] = useState(false);
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const page = useContext(PageProfileContext);
  const latest = useRef({ windowId, target, page });
  latest.current = { windowId, target, page };
  const onCurrentPage = () => {
    const { windowId, page } = latest.current;
    return !page || useBrowser.getState().windows[windowId]?.profileId === page;
  };
  const [hoverProps] = useState(() =>
    markHoverProps({
      onMouseEnter: () => {
        if (!onCurrentPage()) return;
        setHovered(true);
        const { windowId, target } = latest.current;
        pointed(windowId, refresh, true);
        underPointer = target?.id ?? null;
        if (target) hoverEnter(windowId, target);
      },
      onMouseLeave: () => {
        setHovered(false);
        pointed(latest.current.windowId, refresh, false);
        if (underPointer === latest.current.target?.id) underPointer = null;
        if (latest.current.target && onCurrentPage()) hoverLeave(latest.current.target.id);
      },
    }),
  );
  useEffect(
    () => () => {
      const { windowId, target } = latest.current;
      pointed(windowId, refresh, false);
      if (target) releaseAnchor(windowId, target.id);
    },
    [],
  );
  return { hovered: hovered && !covered.has(windowId), hoverProps };
}

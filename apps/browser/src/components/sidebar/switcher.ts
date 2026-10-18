import { setSwitcherCapture, switcherPointerMoved } from "@ardia/shell";
import { useBrowser } from "../../store/browser";
import { recentTabIds } from "../../store/organize";
import { setSidebarUi, sidebarUi } from "./state";

const SHOW_AFTER_MS = 140;
const POINTER_POLL_MS = 50;
let showTimer: ReturnType<typeof setTimeout> | undefined;
let pointerTimer: ReturnType<typeof setInterval> | undefined;
let hoveredRow: number | null = null;

export function switcherStep(windowId: string, backward: boolean) {
  const current = sidebarUi().switcher;
  if (current && current.windowId === windowId) return moveSwitcher(backward ? -1 : 1);
  const ids = recentTabIds(useBrowser.getState(), windowId);
  if (ids.length < 2) return;
  setSidebarUi({ switcher: { windowId, ids, index: backward ? ids.length - 1 : 1, visible: false } });
  setSwitcherCapture(true);
  clearTimeout(showTimer);
  showTimer = setTimeout(() => {
    const s = sidebarUi().switcher;
    if (s) setSidebarUi({ switcher: { ...s, visible: true } });
  }, SHOW_AFTER_MS);
}

export function moveSwitcher(step: 1 | -1) {
  const s = sidebarUi().switcher;
  if (s) focusSwitcherRow(s.index + step);
}

export function focusSwitcherRow(index: number) {
  const s = sidebarUi().switcher;
  if (!s) return;
  const n = s.ids.length;
  setSidebarUi({ switcher: { ...s, index: (index + n) % n } });
}

export function hoverSwitcherRow(index: number) {
  hoveredRow = index;
  if (switcherPointerMoved()) return focusSwitcherRow(index);
  pointerTimer ??= setInterval(() => {
    if (!sidebarUi().switcher || hoveredRow === null) return stopPointerWatch();
    if (!switcherPointerMoved()) return;
    const row = hoveredRow;
    stopPointerWatch();
    focusSwitcherRow(row);
  }, POINTER_POLL_MS);
}

export function leaveSwitcherRow(index: number) {
  if (hoveredRow === index) hoveredRow = null;
}

function stopPointerWatch() {
  clearInterval(pointerTimer);
  pointerTimer = undefined;
}

export function commitSwitcher(index?: number) {
  const s = sidebarUi().switcher;
  if (!s) return;
  endSwitcher();
  const id = s.ids[index ?? s.index];
  if (id && useBrowser.getState().tabs[id]) useBrowser.getState().activate(id);
}

export function cancelSwitcher() {
  if (sidebarUi().switcher) endSwitcher();
}

function endSwitcher() {
  clearTimeout(showTimer);
  stopPointerWatch();
  hoveredRow = null;
  setSwitcherCapture(false);
  setSidebarUi({ switcher: null });
}

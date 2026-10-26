import { call, on } from "./engine/call";

export type DeviceChooser = {
  id: number;
  browserId: number;
  open: boolean;
  title: string;
  okLabel: string;
  cancelLabel: string;
  noOptionsText: string;
  scanningText: string;
  refreshing: boolean;
  canRefresh: boolean;
  adapterOff: boolean;
  unauthorized: boolean;
  bothButtonsEnabled: boolean;
  showSignal: boolean;
  options: { name: string; connected: boolean; paired: boolean; signal: number }[];
};

export const CastMode = { presentation: 1, tab: 2, screen: 4, remotePlayback: 8 } as const;

export type CastSink = {
  id: string;
  name: string;
  status: string;
  state: "available" | "connecting" | "connected" | "disconnecting" | "unavailable";
  icon: number;
  modes: number;
  routeId: string;
  issue: string;
};

export type CastDialog = {
  id: number;
  browserId: number;
  open: boolean;
  header: string;
  permissionRejected: boolean;
  castingStarted: boolean;
  sinks: CastSink[];
};

export type CastRoute = { id: string; sink: string; description: string; source: string };

export type SidePanelRequest = { browserId: number; extensionId: string; open: boolean };
export type ActionPopupRequest = { browserId: number; extensionId: string };

export const onDeviceChooser = (listener: (e: DeviceChooser) => void) => on("media.deviceChooser", listener);
export const selectDevice = (id: number, index: number) => call("media.selectDevice", { id, index });
export const cancelDeviceChooser = (id: number) => call("media.cancelDeviceChooser", { id });
export const refreshDeviceChooser = (id: number) => call("media.refreshDeviceChooser", { id });
export const openBluetoothSettings = (id: number) => call("media.openBluetoothSettings", { id });

export const onCastDialog = (listener: (e: CastDialog) => void) => on("media.castDialog", listener);
export const onCastRoutes = (listener: (e: { profile: string; routes: CastRoute[] }) => void) => on("media.castRoutes", listener);
export const showCastDialog = (browserId: number) => call("media.showCastDialog", { browserId });
export const startCasting = (dialogId: number, sinkId: string, mode: number) => call("media.startCasting", { id: dialogId, sink: sinkId, mode });
export const stopCasting = (dialogId: number, routeId: string) => call("media.stopCasting", { id: dialogId, route: routeId });
export const closeCastDialog = (dialogId: number) => call("media.closeCastDialog", { id: dialogId });
export const watchCastRoutes = (profile: string) => call("media.watchCastRoutes", { profile });
export const terminateCastRoute = (routeId: string) => call("media.terminateCastRoute", { route: routeId });
export function preferredCastMode(modes: number): number {
  for (const mode of [CastMode.presentation, CastMode.tab, CastMode.screen, CastMode.remotePlayback]) if (modes & mode) return mode;
  return 0;
}

export const onExtensionSidePanel = (listener: (e: SidePanelRequest) => void) => on("extensions.sidePanel", listener);
export const extensionSidePanelUrl = (browserId: number, extensionId: string) => call("extensions.sidePanelUrl", { browserId, extensionId });
export const onExtensionActionPopup = (listener: (e: ActionPopupRequest) => void) => on("extensions.actionPopup", listener);
export const onExtensionActionShortcut = (listener: (e: ActionPopupRequest) => void) => on("extensions.actionShortcut", listener);

export const changeCaptureSource = (capturer: number, target: number) => call("media.changeCaptureSource", { capturer, target });
export const stopCapture = (capturer: number) => call("media.stopCapture", { browserId: capturer });

export const showAutofillSuggestions = (browserId: number, kind: "passwords" | "field") =>
  call("autofill.showSuggestions", { browserId, passwords: kind === "passwords" });

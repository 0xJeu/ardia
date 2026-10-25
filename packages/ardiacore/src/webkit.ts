import { requireOptionalNativeModule, type EventSubscription } from "expo-modules-core";
import type { BrowsingDataType, Download, PermissionRequest, PermissionResult } from "./module";
import type { SiteSettings, SiteSettingType, SiteSettingValue } from "./siteSettings";

export type PageEngine = "chromium" | "webkit";

type WebKitNative = {
  addListener(name: "onDownload", listener: (d: Download) => void): EventSubscription;
  addListener(name: "onPermission", listener: (p: PermissionRequest) => void): EventSubscription;
  addListener(name: "onPermissionDismissed", listener: (p: { id: string }) => void): EventSubscription;
  prepareTransfer(key: string): void;
  releaseTransfer(key: string): void;
  resolvePermission(id: string, result: PermissionResult, remember: boolean): Promise<void>;
  downloadCommand(action: "cancel" | "pause" | "resume", id: string): Promise<void>;
  setDownloadSettings(profile: string, folder: string, ask: boolean): Promise<void>;
  endPrivateSession(session: string): Promise<void>;
  sitePermissions(profile: string, origin: string): Promise<Partial<SiteSettings>>;
  setSitePermission(profile: string, origin: string, kind: string, value: string): Promise<void>;
  resolveExternalApp(id: string, open: boolean, remember: boolean): Promise<void>;
  clearBrowsingData(profile: string, types: BrowsingDataType[], since: number | null): Promise<void>;
  deleteProfileData(profile: string): Promise<boolean>;
  info(): Promise<{ safariVersion: string; userAgentSuffix: string; passkeys: boolean }>;
};

export const WebKit = requireOptionalNativeModule<WebKitNative>("ArdiaWebKit");

const NO_SUBSCRIPTION: EventSubscription = { remove() {} };

export const isWebKitDownload = (id: string) => id.startsWith("wk-download-");
export const isWebKitPermission = (id: string) => id.startsWith("wk-permission-");
export const isWebKitExternalApp = (id: string) => id.startsWith("wk-external-");
export const WEBKIT_SITE_SETTINGS: readonly SiteSettingType[] = ["camera", "microphone"];

export const webKitListener = <T>(name: "onDownload" | "onPermission" | "onPermissionDismissed", listener: (value: T) => void): EventSubscription =>
  WebKit ? WebKit.addListener(name as "onDownload", listener as (d: Download) => void) : NO_SUBSCRIPTION;

export const setWebKitDownloadSettings = (profile: string, folder: string, ask: boolean) =>
  WebKit?.setDownloadSettings(profile, folder, ask) ?? Promise.resolve();
export const endWebKitPrivateSession = (session: string) => WebKit?.endPrivateSession(session) ?? Promise.resolve();
export const getWebKitSiteSettings = async (profile: string, origin: string): Promise<SiteSettings> =>
  ((await WebKit?.sitePermissions(profile, origin)) ?? {}) as SiteSettings;
export const setWebKitSiteSetting = (profile: string, origin: string, type: SiteSettingType, value: SiteSettingValue) =>
  WebKit?.setSitePermission(profile, origin, type, value) ?? Promise.resolve();
export const webKitInfo = () => WebKit?.info() ?? Promise.resolve(null);

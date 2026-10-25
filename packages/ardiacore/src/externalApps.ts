import { Cef } from "./native";
import { WebKit, isWebKitExternalApp } from "./webkit";

export type ExternalAppRequest = {
  id: string;
  url: string;
  scheme: string;
  origin: string | null;
  app: string | null;
  appPath: string | null;
  icon: string | null;
  title: string;
  message: string | null;
  remember: string | null;
};

export type ExternalAppAllowance = { origin: string; scheme: string; app: string | null; icon: string | null };

export const resolveExternalApp = (id: string, open: boolean, remember = false) =>
  isWebKitExternalApp(id) ? (WebKit?.resolveExternalApp(id, open, remember) ?? Promise.resolve()) : Cef.resolveExternalApp(id, open, remember);
export const getExternalAppAllowances = (profile: string) => Cef.getExternalAppAllowances(profile);
export const removeExternalAppAllowance = (profile: string, origin: string, scheme: string) =>
  Cef.removeExternalAppAllowance(profile, origin, scheme);

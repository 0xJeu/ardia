import { call } from "./engine/call";
import { isWebKitExternalApp } from "./webkit";

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
  isWebKitExternalApp(id) ? call("webKit.resolveExternalApp", { id, open, remember }) : call("permissions.resolveExternalApp", { id, open, remember });
export const getExternalAppAllowances = async (profile: string): Promise<ExternalAppAllowance[]> => {
  const [chromium, webkit] = await Promise.all([
    call("permissions.externalAppAllowances", { profile }).catch((): ExternalAppAllowance[] => []),
    call("webKit.externalAppAllowances", { profile }).catch((): ExternalAppAllowance[] => []),
  ]);
  const seen = new Set(chromium.map((a) => `${a.origin}|${a.scheme}`));
  return [...chromium, ...webkit.filter((a) => !seen.has(`${a.origin}|${a.scheme}`))];
};
export const removeExternalAppAllowance = (profile: string, origin: string, scheme: string) =>
  Promise.all([
    call("permissions.removeExternalAppAllowance", { profile, origin, scheme }),
    call("webKit.removeExternalAppAllowance", { profile, origin, scheme }),
  ]).then(() => {});

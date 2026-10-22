import { HexclaveClientApp } from "@hexclave/js";
import { PRODUCTION_HOSTS } from "../data/telemetry";

// Hexclave Analytics counts page views and clicks on ardia.dev (the owners' Hexclave project).
// Session replays stay off: the site's own recorder is the only replay.
if (PRODUCTION_HOSTS.includes(location.hostname)) {
  new HexclaveClientApp({
    projectId: "49be2e2e-87c4-433e-b42f-f255854bff56",
    tokenStore: "cookie",
    analytics: { replays: { enabled: false } },
    devTool: false,
    noAutomaticPrefetch: true,
  });
}

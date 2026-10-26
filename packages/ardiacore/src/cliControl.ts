import { call, on } from "./engine/call";

export type CliControlStatus = {
  state: "off" | "starting" | "on" | "external";
  port?: number;
  connections?: number;
  generation?: number;
  file?: string;
  reason?: string;
};

export const setCliControl = (on: boolean) => call("engine.cliControl", { on });

export const setCliActiveTab = (chromeTabId: number) => call("engine.cliControl", { active: chromeTabId });

export const cliControlStatus = () => call("engine.cliControl");

export const onCliControlChanged = (listener: (status: CliControlStatus) => void) =>
  on("engine.cliControl", (payload) => listener(payload as unknown as CliControlStatus));

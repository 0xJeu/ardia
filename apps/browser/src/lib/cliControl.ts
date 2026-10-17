import { cliControlStatus, onCliControlChanged, setCliControl, type CliControlStatus } from "@ardia/ardiacore";
import { installCli, installedCliVersion, onCliInstallLine, readDocument, systemInfo, writeDocument, type CliInstallResult } from "@ardia/shell";
import { create } from "zustand";
import { useBrowser } from "../store/browser";
import { afterFirstWindow } from "./afterFirstWindow";

const DOC = "ardia-cli.json";
const UPGRADE_DELAY_MS = 8000;

type Saved = { binPath?: string | null; version?: string | null; error?: string | null; at?: number };

export type CliInstallReason = "onboarding" | "settings" | "upgrade";

type CliState = {
  server: CliControlStatus | null;
  installing: CliInstallReason | null;
  step: string | null;
  installedVersion: string | null;
  binPath: string | null;
  error: string | null;
};

function readSaved(): Saved {
  try {
    const json = readDocument(DOC);
    return json ? (JSON.parse(json) as Saved) : {};
  } catch {
    return {};
  }
}

function save(patch: Saved) {
  try {
    writeDocument(DOC, JSON.stringify({ ...readSaved(), ...patch, at: Date.now() }));
  } catch (error) {
    console.warn("[cli] couldn't save the install status", error);
  }
}

const saved = readSaved();

export const useCli = create<CliState>(() => ({
  server: null,
  installing: null,
  step: null,
  installedVersion: installedCliVersion(),
  binPath: saved.binPath ?? null,
  error: saved.error ?? null,
}));

let running: Promise<CliInstallResult> | null = null;

export function installCliInBackground(reason: CliInstallReason): Promise<CliInstallResult> {
  if (running) return running;
  useCli.setState({ installing: reason, step: null });
  const lines = onCliInstallLine((line) => {
    const step = /^step (\S+)/.exec(line)?.[1];
    if (step) useCli.setState({ step });
  });
  running = installCli()
    .catch((e: unknown): CliInstallResult => ({ ok: false, appVersion: "", error: e instanceof Error ? e.message : String(e), lines: [] }))
    .then((result) => {
      lines.remove();
      running = null;
      const installedVersion = installedCliVersion();
      if (result.ok) {
        save({ binPath: result.binPath ?? null, version: result.version ?? installedVersion, error: null });
        useCli.setState({ installing: null, step: null, installedVersion, binPath: result.binPath ?? null, error: null });
      } else {
        const error = result.error ?? "The installer stopped.";
        save({ error });
        useCli.setState({ installing: null, step: null, installedVersion, error });
      }
      return result;
    });
  return running;
}

export function describeCliInstall(state: Pick<CliState, "installing" | "step" | "installedVersion" | "binPath" | "error">): string {
  if (state.installing) return state.step ? `Installing (${state.step})…` : "Installing…";
  if (state.error) return state.error;
  if (state.installedVersion) return state.binPath ? `Installed at ${state.binPath}` : `Version ${state.installedVersion} is installed.`;
  return "Not installed.";
}

export const stopCliControl = () => useBrowser.getState().updateSettings({ cliControl: false });

function upgradeIfBehind() {
  const installed = installedCliVersion();
  useCli.setState({ installedVersion: installed });
  const app = systemInfo().appVersion;
  if (!installed || !app || installed === app) return;
  void installCliInBackground("upgrade");
}

let started = false;

export function startCliControl() {
  if (started) return;
  started = true;
  const setServer = (server: CliControlStatus) => useCli.setState({ server });
  onCliControlChanged(setServer);
  let applied: boolean | null = null;
  const sync = () => {
    const on = useBrowser.getState().settings.cliControl ?? false;
    if (on === applied) return;
    const first = applied === null;
    applied = on;
    const call = first && !on ? cliControlStatus() : setCliControl(on);
    void call.then(setServer, (e: unknown) => setServer({ state: "off", error: e instanceof Error ? e.message : String(e) }));
  };
  sync();
  useBrowser.subscribe(sync);
  afterFirstWindow(() => setTimeout(upgradeIfBehind, UPGRADE_DELAY_MS));
}

if (__DEV__) (globalThis as { acCli?: unknown }).acCli = { store: useCli, install: installCliInBackground, upgradeIfBehind };

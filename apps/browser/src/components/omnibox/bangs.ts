import { bangTable, joinBangTables, slimBangs, type BangTable } from "@ardia/core";
import { readDocument, writeDocument } from "@ardia/shell";
import { useEffect, useSyncExternalStore } from "react";
import { loadBundledBangs, refreshesBangs } from "./bangPlatform";

export const BANGS_URL = "https://services.helium.imput.net/bangs.json";
const LIST_DOC = "bangs.txt";
const STATE_DOC = "bangs-state.json";
const REFRESH_EVERY_MS = 86_400_000;
const FETCH_TIMEOUT_MS = 30_000;
const MAX_BYTES = 5_000_000;
const MIN_TRIGGERS = 1000;

type RefreshState = { etag: string | null; checkedAt: number };
export type BangRefresh = { at: number; status: number | "skipped" | "failed"; result: "updated" | "unchanged" | "failed" | "fresh" };

let table: BangTable | null = null;
let tableSource: "bundled" | "stored" | "fetched" | null = null;
let loading: Promise<BangTable> | null = null;
let refreshing: Promise<BangRefresh> | null = null;
const refreshes: BangRefresh[] = [];
const listeners = new Set<() => void>();

function setTable(next: BangTable, source: NonNullable<typeof tableSource>) {
  table = next;
  tableSource = source;
  for (const listener of listeners) listener();
}

function readState(): RefreshState | null {
  try {
    const state = JSON.parse(readDocument(STATE_DOC) ?? "null") as Partial<RefreshState> | null;
    if (!state || typeof state.checkedAt !== "number") return null;
    return { etag: typeof state.etag === "string" ? state.etag : null, checkedAt: state.checkedAt };
  } catch {
    return null;
  }
}

function writeState(state: RefreshState) {
  try {
    writeDocument(STATE_DOC, JSON.stringify(state));
  } catch {}
}

function storedTable(): BangTable | null {
  try {
    const text = readDocument(LIST_DOC);
    const stored = text ? bangTable(text) : null;
    return stored && stored.size >= MIN_TRIGGERS ? stored : null;
  } catch {
    return null;
  }
}

export function loadBangs(): Promise<BangTable> {
  if (table) return Promise.resolve(table);
  return (loading ??= (async () => {
    const stored = storedTable();
    if (stored) {
      if (!table) setTable(stored, "stored");
      return table!;
    }
    const { BANG_LIST, BANG_LIST_UNICODE } = await loadBundledBangs();
    if (!table) setTable(joinBangTables([bangTable(BANG_LIST), bangTable(BANG_LIST_UNICODE)]), "bundled");
    return table!;
  })());
}

export function bangsFor(text: string): BangTable | null {
  if (!table && text.includes("!")) void loadBangs();
  return table;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const currentTable = () => table;

export function useBangs(typed: boolean): BangTable | null {
  const current = useSyncExternalStore(subscribe, currentTable);
  useEffect(() => {
    if (!typed) return;
    void loadBangs();
    void refreshBangsOnce();
  }, [typed]);
  return typed ? current : null;
}

export function refreshBangsOnce(): Promise<BangRefresh> {
  return (refreshing ??= refreshBangs());
}

export async function refreshBangs(fetchFn: typeof fetch = fetch): Promise<BangRefresh> {
  const now = Date.now();
  const note = (status: BangRefresh["status"], result: BangRefresh["result"]): BangRefresh => {
    const entry = { at: now, status, result };
    refreshes.push(entry);
    return entry;
  };
  if (!refreshesBangs) return note("skipped", "fresh");
  const stored = readState();
  if (stored && now >= stored.checkedAt && now - stored.checkedAt < REFRESH_EVERY_MS) return note("skipped", "fresh");
  writeState({ etag: stored?.etag ?? null, checkedAt: now });
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), FETCH_TIMEOUT_MS);
  try {
    await loadBangs();
    const etag = tableSource === "bundled" ? (await loadBundledBangs()).BANG_LIST_ETAG : stored?.etag;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (etag) headers["If-None-Match"] = etag;
    const response = await fetchFn(BANGS_URL, { method: "GET", credentials: "omit", headers, signal: abort.signal });
    if (response.status === 304) {
      writeState({ etag: etag ?? null, checkedAt: now });
      return note(304, "unchanged");
    }
    if (!response.ok || !/json/i.test(response.headers.get("content-type") ?? "")) return note(response.status, "failed");
    const body = await response.text();
    if (body.length > MAX_BYTES) return note(response.status, "failed");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const slim = slimBangs(body);
    if (!slim) return note(response.status, "failed");
    writeDocument(LIST_DOC, slim);
    writeState({ etag: response.headers.get("etag"), checkedAt: now });
    setTable(bangTable(slim), "fetched");
    return note(response.status, "updated");
  } catch {
    return note("failed", "failed");
  } finally {
    clearTimeout(timer);
  }
}

export const bangStatus = () => ({ loaded: !!table, source: tableSource, size: table?.size ?? 0, refreshes: refreshes.slice(), state: readState() });

export function resetBangsForTests() {
  table = null;
  tableSource = null;
  loading = null;
  refreshing = null;
  refreshes.length = 0;
}

import { readDocument, removeDocument, saveDocument, writeDocument } from "../../platform/documents";
import { Clock, emptyScope, restoreJournal, SyncNative, writtenSeq, type LogFile, type ScopeState, type SyncRecord } from "../../platform/sync";
import { parseSaved, versionedJson } from "../../lib/savedDocument";
import { APP_SCOPE, DOC, DOC_MIGRATIONS, DOC_VERSION, JOURNAL, STATE, defaultTypes, emptyDoc, type SyncDoc } from "./syncDoc";

type Journal = Record<string, LogFile[]>;
type ScopeChange = { records: Record<string, SyncRecord | null>; base: Record<string, string | null>; rest: Partial<ScopeState> };
type JournalPart = { journal?: Journal; device?: string | null; changes?: Record<string, ScopeChange> };

const STATE_EVERY_MS = 60 * 60_000;
const JOURNAL_BYTES_LIMIT = 1_000_000;
const JOURNAL_PARTS_LIMIT = 400;
const DOC_IDLE_MS = 5 * 60_000;

const journalPart = (n: number) => `sync-journal-${n}.nns`;

async function openSealed<T>(sealed: string | null | undefined, fallback: T): Promise<T> {
  const json = sealed ? await SyncNative?.openLocal(sealed) : null;
  try {
    if (json) return JSON.parse(json) as T;
  } catch {}
  return fallback;
}

function addBatches(into: Journal, part: Journal | undefined) {
  for (const [scope, files] of Object.entries(part ?? {})) {
    const list = (into[scope] ??= []);
    for (const file of files) if (!list.some((f) => f.seq === file.seq && f.device === file.device)) list.push(file);
  }
}

function restOf(state: ScopeState): Partial<ScopeState> {
  const rest: Partial<ScopeState> = { ...state };
  delete rest.records;
  delete rest.base;
  return rest;
}

function changedEntries<T>(before: Record<string, T>, after: Record<string, T>): Record<string, T | null> {
  const changed: Record<string, T | null> = {};
  for (const key in after) if (before[key] !== after[key]) changed[key] = after[key]!;
  for (const key in before) if (!(key in after)) changed[key] = null;
  return changed;
}

function replayChanges(scopes: SyncDoc["scopes"], changes: Record<string, ScopeChange>, live: Set<string>) {
  for (const [scope, change] of Object.entries(changes)) {
    if (!live.has(scope)) continue;
    const { records, base } = scopes[scope] ?? emptyScope();
    for (const [key, record] of Object.entries(change.records)) {
      if (record) records[key] = record;
      else delete records[key];
    }
    for (const [key, json] of Object.entries(change.base)) {
      if (json !== null) base[key] = json;
      else delete base[key];
    }
    scopes[scope] = { ...emptyScope(), ...change.rest, records, base };
  }
}

export function syncFiles(current: () => SyncDoc) {
  let savedJson = "";
  let savedLasting = "";
  let docSavedAt = 0;
  let journal: Journal = {};
  let journalParts = 0;
  let journalPartsCounted = false;
  let journalBytes = 0;
  let partWrites = 0;
  let partsInFlight = 0;
  let legacyJournal = false;
  const writtenRest = new Map<string, string>();
  let savedState = "";
  let stateOnDisk = false;
  let stateLoaded = false;
  let stateSavedAt = 0;
  let stateWanted = false;
  let sealing: Promise<void> | null = null;

  function read(): SyncDoc | null {
    try {
      const json = readDocument(DOC);
      const saved = parseSaved(json, DOC_VERSION, DOC_MIGRATIONS, "v") as SyncDoc | null;
      const loaded = saved ? { ...emptyDoc(), ...saved, types: { ...defaultTypes(), ...saved.types }, scopes: {} } : null;
      savedJson = json ?? "";
      return loaded;
    } catch (error) {
      console.warn("[sync] couldn't read sync.json", error);
      return null;
    }
  }

  async function readJournal() {
    const batches: Journal = {};
    const changes: JournalPart[] = [];
    const take = async (sealed: string | null) => {
      const part = await openSealed<JournalPart>(sealed, {});
      addBatches(batches, part.journal);
      if (part.changes) changes.push(part);
    };
    const legacy = readDocument(JOURNAL);
    legacyJournal = !!legacy;
    journalBytes = legacy?.length ?? 0;
    await take(legacy);
    journalParts = 0;
    for (let n = 1; ; n++) {
      const part = readDocument(journalPart(n));
      if (!part) break;
      journalParts = n;
      journalBytes += part.length;
      await take(part);
    }
    journalPartsCounted = true;
    return { batches, changes };
  }

  async function loadState() {
    const sealedState = readDocument(STATE);
    const scopes = await openSealed<SyncDoc["scopes"]>(sealedState, {});
    const { batches, changes } = await readJournal();
    const doc = current();
    const live = new Set([APP_SCOPE, ...Object.values(doc.profiles).map((link) => `p:${link.syncId}`)]);
    for (const part of changes) if (part.device === doc.deviceId) replayChanges(scopes, part.changes!, live);
    journal = {};
    for (const [scope, files] of Object.entries(batches)) {
      const mine = files.filter((f) => f.device === doc.deviceId);
      if (mine.length) journal[scope] = mine;
    }
    const clock = new Clock(doc.deviceId ?? "", doc.clock);
    for (const scope of new Set([...Object.keys(doc.seqs ?? {}), ...Object.keys(journal)])) {
      restoreJournal((scopes[scope] ??= emptyScope()), journal[scope] ?? [], clock, doc.seqs?.[scope]);
    }
    if (doc.deviceId && Object.keys(journal).length) doc.clock = clock.last;
    doc.scopes = scopes;
    writtenRest.clear();
    for (const [scope, state] of Object.entries(scopes)) writtenRest.set(scope, JSON.stringify(restOf(state)));
    stateOnDisk = !!sealedState;
    savedState = "";
    stateLoaded = true;
    stateSavedAt = Date.now();
  }

  function countJournalParts() {
    if (journalPartsCounted) return;
    while (readDocument(journalPart(journalParts + 1))) journalParts++;
    journalPartsCounted = true;
  }

  async function writePart(part: JournalPart) {
    partWrites++;
    partsInFlight++;
    try {
      const sealed = await SyncNative!.sealLocal(JSON.stringify(part));
      countJournalParts();
      const n = journalParts + 1;
      await saveDocument(journalPart(n), sealed);
      journalParts = Math.max(journalParts, n);
      journalBytes += sealed.length;
    } finally {
      partsInFlight--;
    }
  }

  const persistJournal = (scope: string) => async (batches: LogFile[]) => {
    const list = (journal[scope] ??= []);
    const fresh = batches.filter((file) => !list.some((f) => f.seq === file.seq));
    if (!fresh.length) return;
    list.push(...fresh);
    try {
      await writePart({ journal: { [scope]: fresh } });
    } catch (error) {
      const left = (journal[scope] ?? []).filter((f) => !fresh.includes(f));
      if (left.length) journal[scope] = left;
      else delete journal[scope];
      throw error;
    }
  };

  function watchScope(scope: string, state: ScopeState) {
    const records = { ...state.records };
    const base = { ...state.base };
    return async () => {
      if (current().scopes[scope] !== state) return;
      const change: ScopeChange = { records: changedEntries(records, state.records), base: changedEntries(base, state.base), rest: restOf(state) };
      const touched = Object.keys(change.records).length > 0 || Object.keys(change.base).length > 0;
      const rest = JSON.stringify(change.rest);
      if (!touched && rest === writtenRest.get(scope)) return;
      try {
        await writePart({ device: current().deviceId, changes: { [scope]: change } });
        writtenRest.set(scope, rest);
      } catch (error) {
        console.warn("[sync] couldn't journal this cycle's changes", error);
        stateWanted = true;
      }
    };
  }

  function pruneJournal(saved: Record<string, number>, mark: number) {
    for (const [scope, list] of Object.entries(journal)) {
      const left = list.filter((f) => f.seq > (saved[scope] ?? 0));
      if (left.length) journal[scope] = left;
      else delete journal[scope];
    }
    if (!Object.keys(journal).length && partWrites === mark && !partsInFlight) clearJournal();
  }

  function clearJournal() {
    journal = {};
    countJournalParts();
    for (let n = journalParts; n > 0; n--) removeDocument(journalPart(n));
    if (legacyJournal) writeDocument(JOURNAL, "");
    journalParts = 0;
    journalBytes = 0;
    legacyJournal = false;
  }

  function saveDoc() {
    const { scopes, ...meta } = current();
    const seqs = Object.fromEntries(Object.entries(scopes).map(([k, s]) => [k, writtenSeq(s)]));
    const json = versionedJson({ ...meta, seqs }, DOC_VERSION, "v");
    if (json === savedJson) return;
    const lasting = versionedJson({ ...meta, lastSyncedAt: null, seqs }, DOC_VERSION, "v");
    const now = Date.now();
    if (lasting === savedLasting && now - docSavedAt < DOC_IDLE_MS) return;
    savedJson = json;
    savedLasting = lasting;
    docSavedAt = now;
    writeDocument(DOC, json);
  }

  function stateDue() {
    if (stateWanted) return true;
    if (!stateLoaded) return false;
    return journalParts >= JOURNAL_PARTS_LIMIT || journalBytes >= JOURNAL_BYTES_LIMIT || Date.now() - stateSavedAt >= STATE_EVERY_MS;
  }

  function saveState() {
    if (sealing) return;
    const doc = current();
    if (!doc.enabled) {
      if (stateOnDisk || stateWanted) writeDocument(STATE, "");
      stateOnDisk = false;
      stateWanted = false;
      savedState = "";
      return;
    }
    if (!stateDue()) return;
    stateWanted = false;
    stateLoaded = true;
    const mark = partWrites;
    const seqs = Object.fromEntries(Object.entries(doc.scopes).map(([k, s]) => [k, s.seq]));
    const state = JSON.stringify(doc.scopes);
    if (state === savedState) {
      stateSavedAt = Date.now();
      pruneJournal(seqs, mark);
      return;
    }
    sealing = (async () => {
      try {
        const sealed = await SyncNative?.sealLocal(state);
        if (sealed) {
          await saveDocument(STATE, sealed);
          savedState = state;
          stateOnDisk = true;
          stateSavedAt = Date.now();
          pruneJournal(seqs, mark);
        }
      } catch (error) {
        console.warn("[sync] couldn't save the sync state", error);
      } finally {
        sealing = null;
      }
      if (stateWanted || !current().enabled) saveState();
    })();
  }

  function save({ stateNow = false } = {}) {
    saveDoc();
    if (stateNow) stateWanted = true;
    saveState();
  }

  function checkpoint() {
    save({ stateNow: stateLoaded && current().enabled });
  }

  return { read, loadState, persistJournal, watchScope, clearJournal, save, checkpoint };
}

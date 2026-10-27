import { readDocument, removeDocument, saveDocument, writeDocument } from "../../platform/documents";
import { Clock, emptyScope, restoreJournal, SyncNative, writtenSeq, type LogFile } from "../../platform/sync";
import { parseSaved, versionedJson } from "../../lib/savedDocument";
import { DOC, DOC_MIGRATIONS, DOC_VERSION, JOURNAL, STATE, defaultTypes, emptyDoc, type SyncDoc } from "./syncDoc";

type Journal = Record<string, LogFile[]>;

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

export function syncFiles(current: () => SyncDoc) {
  let savedJson = "";
  let savedLasting = "";
  let docSavedAt = 0;
  let journal: Journal = {};
  let journalParts = 0;
  let journalPartsCounted = false;
  let journalBytes = 0;
  let legacyJournal = false;
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

  async function readJournal(): Promise<Journal> {
    const found: Journal = {};
    const legacy = readDocument(JOURNAL);
    legacyJournal = !!legacy;
    journalBytes = legacy?.length ?? 0;
    addBatches(found, (await openSealed<{ journal?: Journal }>(legacy, {})).journal);
    journalParts = 0;
    for (let n = 1; ; n++) {
      const part = readDocument(journalPart(n));
      if (!part) break;
      journalParts = n;
      journalBytes += part.length;
      addBatches(found, (await openSealed<{ journal?: Journal }>(part, {})).journal);
    }
    journalPartsCounted = true;
    return found;
  }

  async function loadState() {
    const sealedState = readDocument(STATE);
    const scopes = await openSealed<SyncDoc["scopes"]>(sealedState, {});
    const found = await readJournal();
    const doc = current();
    journal = {};
    for (const [scope, files] of Object.entries(found)) {
      const mine = files.filter((f) => f.device === doc.deviceId);
      if (mine.length) journal[scope] = mine;
    }
    const clock = new Clock(doc.deviceId ?? "", doc.clock);
    for (const scope of new Set([...Object.keys(doc.seqs ?? {}), ...Object.keys(journal)])) {
      restoreJournal((scopes[scope] ??= emptyScope()), journal[scope] ?? [], clock, doc.seqs?.[scope]);
    }
    if (doc.deviceId && Object.keys(journal).length) doc.clock = clock.last;
    doc.scopes = scopes;
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

  const persistJournal = (scope: string) => async (batches: LogFile[]) => {
    const list = (journal[scope] ??= []);
    const fresh = batches.filter((file) => !list.some((f) => f.seq === file.seq));
    if (!fresh.length) return;
    list.push(...fresh);
    try {
      const sealed = await SyncNative!.sealLocal(JSON.stringify({ journal: { [scope]: fresh } }));
      countJournalParts();
      journalParts++;
      journalBytes += sealed.length;
      await saveDocument(journalPart(journalParts), sealed);
    } catch (error) {
      const left = (journal[scope] ?? []).filter((f) => !fresh.includes(f));
      if (left.length) journal[scope] = left;
      else delete journal[scope];
      throw error;
    }
  };

  function pruneJournal(saved: Record<string, number>) {
    for (const [scope, list] of Object.entries(journal)) {
      const left = list.filter((f) => f.seq > (saved[scope] ?? 0));
      if (left.length) journal[scope] = left;
      else delete journal[scope];
    }
    if (!Object.keys(journal).length) clearJournal();
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
    const seqs = Object.fromEntries(Object.entries(doc.scopes).map(([k, s]) => [k, s.seq]));
    const state = JSON.stringify(doc.scopes);
    if (state === savedState) {
      stateSavedAt = Date.now();
      pruneJournal(seqs);
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
          pruneJournal(seqs);
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

  return { read, loadState, persistJournal, clearJournal, save };
}

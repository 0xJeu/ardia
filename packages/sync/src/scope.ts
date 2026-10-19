import { canonical } from "./canon.ts";
import { hlcWall, type Clock, type HLC } from "./hlc.ts";

export type Origin = [device: string, seq: number];
export type SyncRecord = { h: HLC; v: unknown; o: Origin };
export type Op = { k: string; h: HLC; v: unknown };

export type Ack = { s: number; vv: Record<string, number> };
export type LogFile = { v: 1; kind: "log"; device: string; seq: number; at: number; ops: Op[]; vv?: Record<string, number> };
export type SnapshotFile = {
  v: 1;
  kind: "snapshot";
  device: string;
  at: number;
  vv: Record<string, number>;
  seen: Record<string, number>;
  records: Record<string, SyncRecord>;
  extra?: Record<string, number[]>;
  gaps?: Record<string, number>;
  acks?: Record<string, Ack[]>;
  retired?: Record<string, number>;
};
export type SyncFile = LogFile | SnapshotFile;

type FileMeta = { d: string; k: "log" | "snapshot" | "bad"; s?: number; vv?: Record<string, number>; at: number };

export type ScopeState = {
  records: Record<string, SyncRecord>;
  base: Record<string, string>;
  unapplied: string[];
  vv: Record<string, number>;
  extra: Record<string, number[]>;
  files: Record<string, FileMeta>;
  damaged: Record<string, number>;
  seq: number;
  outbox: Op[];
  journal?: LogFile[];
  seen: Record<string, number>;
  joined: boolean;
  awaitRemote?: boolean;
  snapshotAt: number;
  pending: number;
  acks?: Record<string, Ack[]>;
  gaps?: Record<string, number>;
  retired?: Record<string, number>;
  ackedAt?: number;
  epoch?: number;
  rebasing?: string[];
};

export const scopeDevice = (state: ScopeState, device: string) => (state.epoch ? `${device}~${state.epoch}` : device);
export const baseDevice = (id: string) => id.replace(/~\d+$/, "");

export const emptyScope = (): ScopeState => ({
  records: {},
  base: {},
  unapplied: [],
  vv: {},
  extra: {},
  files: {},
  damaged: {},
  seq: 0,
  outbox: [],
  seen: {},
  joined: false,
  snapshotAt: 0,
  pending: 0,
});

export interface Transport {
  write(scope: string, payload: string): Promise<string>;
  read(scope: string, known: string[]): Promise<Listing>;
  remove(scope: string, ids: string[]): Promise<void>;
}

export type Listing = {
  files: { id: string; payload: string }[];
  pending: string[];
  damaged: { id: string; age: number }[];
  present: string[];
};

export type Extraction = {
  values: Map<string, unknown>;
  ignore?: (key: string) => boolean;
  republish?: (key: string) => boolean;
  published?: (keys: Set<string>) => void;
};

export type ApplyRecords = {
  known(key: string): boolean;
  now: number;
  horizon: number;
};

export interface Adapter {
  prefix: string;
  extract(base: (key: string) => unknown, queued: (key: string) => boolean, now: number): Extraction | null | Promise<Extraction | null>;
  apply(visible: Map<string, unknown>, changed: Set<string>, base: (key: string) => unknown, records: ApplyRecords): boolean | void | Promise<boolean | void>;
  editedAt?(value: unknown): number | undefined;
  adoptRemoteOnJoin?: boolean;
}

export type ScopeOptions = {
  expired?: (key: string, value: unknown, now: number) => boolean;
  tombstoneTTL?: number;
  retireAfter?: number;
  compactAfterFiles?: number;
  compactInterval?: number;
  pruneGrace?: number;
  damagedGiveUp?: number;
  persist?: (batches: LogFile[]) => Promise<void>;
};

const DEFAULTS: Required<Omit<ScopeOptions, "persist">> = {
  expired: () => false,
  tombstoneTTL: 45 * 86_400_000,
  retireAfter: 180 * 86_400_000,
  compactAfterFiles: 40,
  compactInterval: 10 * 60_000,
  pruneGrace: 60 * 60_000,
  damagedGiveUp: 86_400_000,
};

export const covered = (vv: Record<string, number>, [device, seq]: Origin) => (vv[device] ?? 0) >= seq;

function markApplied(state: ScopeState, device: string, seq: number) {
  if (covered(state.vv, [device, seq])) return;
  const extra = new Set(state.extra[device] ?? []);
  extra.add(seq);
  let top = state.vv[device] ?? 0;
  while (extra.delete(top + 1)) top++;
  state.vv[device] = top;
  if (extra.size) state.extra[device] = [...extra].sort((a, b) => a - b);
  else delete state.extra[device];
}

const ACK_EVERY = 86_400_000;
const KEEP_ALIVE = 30 * 86_400_000;

function noteAck(state: ScopeState, device: string, s: number, vv: Record<string, number>) {
  if (state.retired?.[device]) return;
  const list = ((state.acks ??= {})[device] ??= []);
  if (list.some((a) => a.s === s)) return;
  list.push({ s, vv: { ...vv } });
  list.sort((a, b) => a.s - b.s);
}

function retire(state: ScopeState, device: string, at: number) {
  if (state.retired?.[device]) return;
  (state.retired ??= {})[device] = at;
  delete state.extra[device];
  delete state.gaps?.[device];
  delete state.acks?.[device];
}

const isApplied = (state: ScopeState, [device, seq]: Origin) =>
  covered(state.vv, [device, seq]) || (state.extra[device]?.includes(seq) ?? false);

function see(state: ScopeState, device: string, at: number) {
  if (!(device in state.seen) || at > state.seen[device]!) state.seen[device] = at;
}

function mergeRecord(state: ScopeState, key: string, record: SyncRecord, clock: Clock): boolean {
  clock.observe(record.h);
  const current = state.records[key];
  if (current && current.h >= record.h) return false;
  state.records[key] = record;
  return true;
}

function ingestLog(state: ScopeState, file: LogFile, clock: Clock, changed: Set<string>) {
  if (state.retired?.[file.device]) return;
  see(state, file.device, file.at);
  if (isApplied(state, [file.device, file.seq])) return;
  for (const op of file.ops) {
    if (mergeRecord(state, op.k, { h: op.h, v: op.v, o: [file.device, file.seq] }, clock)) changed.add(op.k);
  }
  markApplied(state, file.device, file.seq);
  if (file.vv) noteAck(state, file.device, file.seq, file.vv);
}

function reannounce(state: ScopeState, key: string) {
  const record = state.records[key]!;
  if (!state.outbox.some((op) => op.k === key && op.h === record.h)) state.outbox.push({ k: key, h: record.h, v: record.v });
}

export function ingestSnapshot(state: ScopeState, file: SnapshotFile, clock: Clock, changed: Set<string>) {
  for (const [device, at] of Object.entries(file.retired ?? {})) retire(state, device, at);
  if (state.retired?.[file.device]) return;
  for (const [device, at] of Object.entries(file.seen)) see(state, device, at);
  see(state, file.device, file.at);
  const current = !!file.acks;
  for (const [key, record] of Object.entries(file.records)) {
    if (!(key in state.records) && isApplied(state, record.o)) continue;
    const mine = state.records[key];
    if (mine && mine.h > record.h && covered(file.vv, mine.o)) reannounce(state, key);
    if (mergeRecord(state, key, record, clock)) changed.add(key);
  }
  for (const [key, record] of Object.entries(state.records)) {
    if (key in file.records || !covered(file.vv, record.o)) continue;
    if (!current && record.v === null) {
      reannounce(state, key);
      continue;
    }
    delete state.records[key];
    changed.add(key);
  }
  for (const [device, seq] of Object.entries(file.vv)) {
    if (state.retired?.[device] || seq <= (state.vv[device] ?? 0)) continue;
    state.vv[device] = seq;
    const extra = (state.extra[device] ?? []).filter((s) => s > seq);
    for (let top = seq; extra[0] === top + 1; top++) state.vv[device] = extra.shift()!;
    if (extra.length) state.extra[device] = extra;
    else delete state.extra[device];
  }
  for (const [device, seqs] of Object.entries(file.extra ?? {})) if (!state.retired?.[device]) for (const s of seqs) markApplied(state, device, s);
  for (const [device, since] of Object.entries(file.gaps ?? {})) if (state.extra[device]) (state.gaps ??= {})[device] = Math.min(state.gaps[device] ?? Infinity, since);
  for (const [device, list] of Object.entries(file.acks ?? {})) for (const a of list) noteAck(state, device, a.s, a.vv);
  if (current) noteAck(state, file.device, file.vv[file.device] ?? 0, file.vv);
}

export function visible(state: ScopeState, prefix: string): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [key, record] of Object.entries(state.records)) {
    if (record.v !== null && key.startsWith(prefix)) out.set(key, record.v);
  }
  return out;
}

const parseBase = (json: string | undefined) => (json === undefined ? undefined : (JSON.parse(json) as unknown));

const settling = new WeakMap<ScopeState, (() => void)[]>();

function settleWhenDurable(state: ScopeState, settle: () => void) {
  const queue = settling.get(state);
  if (queue) queue.push(settle);
  else settling.set(state, [settle]);
}

function settleDurable(state: ScopeState) {
  const queue = settling.get(state);
  if (!queue) return;
  settling.delete(state);
  for (const settle of queue) settle();
}

async function publishAdapter(state: ScopeState, adapter: Adapter, clock: Clock, device: string, now: number): Promise<Set<string>> {
  const published = new Set<string>();
  if ((adapter.adoptRemoteOnJoin && !state.joined) || state.rebasing) return published;
  let pending: Set<string> | null = null;
  const queued = (key: string) => (pending ??= new Set([...state.outbox, ...(state.journal ?? []).flatMap((f) => f.ops)].map((op) => op.k))).has(key);
  const extraction = await adapter.extract((key) => parseBase(state.base[key]), queued, now);
  if (!extraction) return published;
  const put = (key: string, value: unknown) => {
    const known = state.records[key];
    const editedAt = !known && value !== null ? adapter.editedAt?.(value) : undefined;
    const h = editedAt !== undefined ? clock.at(editedAt) : clock.tick();
    if (known && known.h >= h) return;
    state.records[key] = { h, v: value, o: [device, state.seq + 1] };
    state.outbox.push({ k: key, h, v: value });
    published.add(key);
  };
  for (const [key, value] of extraction.values) {
    if (value === null || value === undefined) throw new Error(`[sync] ${key}: a live value can't be null`);
    const json = canonical(value);
    if (state.base[key] === json && !extraction.republish?.(key)) continue;
    state.base[key] = json;
    put(key, value);
  }
  for (const key of Object.keys(state.base)) {
    if (!key.startsWith(adapter.prefix) || extraction.values.has(key) || extraction.ignore?.(key)) continue;
    delete state.base[key];
    put(key, null);
  }
  const { published: settle } = extraction;
  if (settle && published.size) settleWhenDurable(state, () => settle(published));
  return published;
}

export async function publish(state: ScopeState, adapters: Adapter[], clock: Clock, device: string, now = Date.now()): Promise<Set<string>> {
  const published = new Set<string>();
  for (const adapter of adapters) for (const key of await publishAdapter(state, adapter, clock, device, now)) published.add(key);
  return published;
}

const sameCoverage = (a: Record<string, number> = {}, b: Record<string, number>) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].every((d) => (a[d] ?? 0) === (b[d] ?? 0));

export async function flush(state: ScopeState, transport: Transport, scope: string, device: string, now: number, options: ScopeOptions = {}, heartbeat = false) {
  if (state.outbox.length || heartbeat) {
    state.seq++;
    const vv = { ...state.vv, [device]: state.seq };
    (state.journal ??= []).push({ v: 1, kind: "log", device, seq: state.seq, at: now, ops: state.outbox, vv });
    state.outbox = [];
  }
  if (!state.journal?.length) return;
  if (options.persist) {
    await options.persist(state.journal);
    settleDurable(state);
  }
  while (state.journal.length) {
    const file = state.journal[0]!;
    const id = await transport.write(scope, JSON.stringify(file));
    state.files[id] = { d: file.device, k: "log", s: file.seq, at: file.at };
    state.journal.shift();
    markApplied(state, file.device, file.seq);
    if (file.vv) noteAck(state, file.device, file.seq, file.vv);
    state.ackedAt = now;
    see(state, file.device, now);
  }
  delete state.journal;
  settleDurable(state);
}

export function restoreJournal(state: ScopeState, batches: LogFile[], clock: Clock, written = 0) {
  const saved = state.seq;
  for (const file of [...batches].sort((a, b) => a.seq - b.seq)) {
    if (file.seq <= state.seq) continue;
    if (file.seq === saved + 1) state.outbox = [];
    for (const op of file.ops) {
      mergeRecord(state, op.k, { h: op.h, v: op.v, o: [file.device, file.seq] }, clock);
      if (op.v === null) delete state.base[op.k];
      else state.base[op.k] = canonical(op.v);
    }
    state.seq = file.seq;
    if (file.seq <= written) markApplied(state, file.device, file.seq);
    else (state.journal ??= []).push(file);
  }
  state.seq = Math.max(state.seq, written);
}

export const writtenSeq = (state: ScopeState) => state.seq - (state.journal?.length ?? 0);

export async function pull(state: ScopeState, transport: Transport, scope: string, clock: Clock, now: number, options: ScopeOptions = {}) {
  const { damagedGiveUp } = { ...DEFAULTS, ...options };
  const listing = await transport.read(scope, Object.keys(state.files));
  const changed = new Set<string>();
  const parsed: { id: string; file: SyncFile }[] = [];
  const bad = (id: string) => {
    state.damaged[id] ??= now;
    if (now - state.damaged[id]! > damagedGiveUp) {
      state.files[id] = { d: "", k: "bad", at: now };
      delete state.damaged[id];
    }
  };
  for (const { id, payload } of listing.files) {
    try {
      const file = JSON.parse(payload) as SyncFile;
      if (file.v !== 1 || (file.kind !== "log" && file.kind !== "snapshot")) throw new Error("unknown file");
      parsed.push({ id, file });
    } catch {
      bad(id);
    }
  }
  for (const { id } of listing.damaged) bad(id);
  parsed.sort((a, b) => (a.file.kind === b.file.kind ? 0 : a.file.kind === "snapshot" ? -1 : 1));
  for (const { id, file } of parsed) {
    if (file.kind === "snapshot") {
      ingestSnapshot(state, file, clock, changed);
      state.files[id] = { d: file.device, k: "snapshot", vv: file.vv, at: file.at };
    } else {
      ingestLog(state, file, clock, changed);
      state.files[id] = { d: file.device, k: "log", s: file.seq, at: file.at };
    }
    delete state.damaged[id];
  }
  const present = new Set(listing.present);
  for (const id of Object.keys(state.files)) if (!present.has(id)) delete state.files[id];
  for (const id of Object.keys(state.damaged)) if (!present.has(id)) delete state.damaged[id];
  state.pending = listing.pending.length;
  for (const device of Object.keys(state.extra)) (state.gaps ??= {})[device] ??= now;
  for (const device of Object.keys(state.gaps ?? {})) if (!state.extra[device]) delete state.gaps![device];
  return changed;
}

async function applyAdapter(state: ScopeState, adapter: Adapter, keys: Set<string>, now: number, horizon: number): Promise<boolean> {
  const mine = new Set([...keys].filter((k) => k.startsWith(adapter.prefix)));
  if (!mine.size) return true;
  const view = visible(state, adapter.prefix);
  let ok: boolean | void = false;
  try {
    ok = await adapter.apply(view, mine, (key) => parseBase(state.base[key]), { known: (key) => key in state.records, now, horizon });
  } catch (error) {
    console.warn(`[sync] applying ${adapter.prefix} failed`, error);
  }
  if (ok === false) return false;
  for (const key of mine) {
    if (view.has(key)) state.base[key] = canonical(view.get(key));
    else delete state.base[key];
  }
  return true;
}

function retireSilent(state: ScopeState, me: string, now: number, retireAfter: number) {
  for (const [device, at] of Object.entries(state.seen)) if (device !== me && now - at > retireAfter) retire(state, device, now);
  for (const [device, since] of Object.entries(state.gaps ?? {})) {
    if (now - since <= retireAfter) continue;
    state.vv[device] = Math.max(state.vv[device] ?? 0, ...(state.extra[device] ?? []));
    delete state.extra[device];
    delete state.gaps![device];
  }
}

function stableAcks(state: ScopeState) {
  const live = Object.keys(state.acks ?? {}).filter((d) => !state.retired?.[d] && state.acks![d]!.length);
  const latest = live.map((d) => state.acks![d]!.at(-1)!.vv);
  const floor: Record<string, number> = {};
  for (const x of new Set([...Object.keys(state.vv), ...latest.flatMap((vv) => Object.keys(vv))])) floor[x] = Math.min(state.vv[x] ?? 0, ...latest.map((vv) => vv[x] ?? 0));
  const stable = new Map<string, Ack | undefined>();
  for (const d of live) {
    const list = state.acks![d]!;
    let at = list.length - 1;
    while (at >= 0 && list[at]!.s > (floor[d] ?? 0)) at--;
    stable.set(d, list[at]);
    if (at > 0) state.acks![d] = list.slice(at);
  }
  return stable;
}

export async function compact(state: ScopeState, transport: Transport, scope: string, device: string, now: number, options: ScopeOptions = {}, force = false) {
  const o = { ...DEFAULTS, ...options };
  const me = scopeDevice(state, device);
  const count = Object.keys(state.files).length;
  const newestSnapshot = Math.max(state.snapshotAt, ...Object.values(state.files).filter((f) => f.k === "snapshot").map((f) => f.at));
  if (!force && (count <= o.compactAfterFiles || now - newestSnapshot < o.compactInterval)) return false;
  await flush(state, transport, scope, me, now, options);
  retireSilent(state, me, now, o.retireAfter);
  const stable = [...stableAcks(state).values()];
  const settled = (origin: Origin) => covered(state.vv, origin) && stable.every((a) => !!a && covered(a.vv, origin));
  const records: Record<string, SyncRecord> = {};
  for (const [key, record] of Object.entries(state.records)) {
    const drop = record.v === null ? now - hlcWall(record.h) > o.tombstoneTTL && settled(record.o) : o.expired(key, record.v, now);
    if (drop) delete state.records[key];
    else records[key] = record;
  }
  const vv = { ...state.vv };
  noteAck(state, me, vv[me] ?? 0, vv);
  const file: SnapshotFile = {
    v: 1,
    kind: "snapshot",
    device: me,
    at: now,
    vv,
    seen: { ...state.seen },
    records,
    extra: { ...state.extra },
    gaps: { ...state.gaps },
    acks: structuredClone(state.acks ?? {}),
    retired: { ...state.retired },
  };
  const id = await transport.write(scope, JSON.stringify(file));
  state.files[id] = { d: me, k: "snapshot", vv, at: now };
  state.snapshotAt = now;
  state.ackedAt = now;
  const dominated = (other: Record<string, number>) => Object.entries(other).every(([d, s]) => (vv[d] ?? 0) >= s);
  const prune = Object.entries(state.files)
    .filter(([fileId, f]) => {
      if (fileId === id || now - f.at < o.pruneGrace) return false;
      if (state.retired?.[f.d]) return true;
      if (f.k === "log") return covered(vv, [f.d, f.s ?? Infinity]);
      if (f.k === "snapshot") return dominated(f.vv ?? {});
      return false;
    })
    .map(([fileId]) => fileId);
  if (prune.length) {
    await transport.remove(scope, prune);
    for (const fileId of prune) delete state.files[fileId];
  }
  return true;
}

function rebase(state: ScopeState) {
  const keys = [...new Set([...Object.keys(state.base), ...Object.keys(state.records), ...state.unapplied])];
  const { joined, awaitRemote } = state;
  const epoch = (state.epoch ?? 0) + 1;
  settling.delete(state);
  for (const key of Object.keys(state)) delete (state as Record<string, unknown>)[key];
  Object.assign(state, emptyScope(), { joined, epoch, rebasing: keys }, awaitRemote === undefined ? {} : { awaitRemote });
}

export type CycleResult = { published: number; changed: number; pending: number; compacted: boolean };

export async function syncScope(args: {
  scope: string;
  state: ScopeState;
  transport: Transport;
  adapters: Adapter[];
  clock: Clock;
  device: string;
  now?: () => number;
  options?: ScopeOptions;
}): Promise<CycleResult> {
  const { scope, state, transport, adapters, clock, device, options } = args;
  const now = args.now ?? Date.now;
  let me = scopeDevice(state, device);
  let published = (await publish(state, adapters, clock, me, now())).size;
  await flush(state, transport, scope, me, now(), options);
  let changed = await pull(state, transport, scope, clock, now(), options);
  if (state.retired?.[me]) {
    rebase(state);
    me = scopeDevice(state, device);
    changed = await pull(state, transport, scope, clock, now(), options);
  }
  const keys = new Set([...state.unapplied, ...(state.rebasing ?? []), ...changed]);
  const unapplied: string[] = [];
  for (const adapter of adapters) {
    const late = await publishAdapter(state, adapter, clock, me, now());
    published += late.size;
    for (const key of late) keys.delete(key);
    if (!(await applyAdapter(state, adapter, keys, now(), options?.retireAfter ?? DEFAULTS.retireAfter))) unapplied.push(...[...keys].filter((k) => k.startsWith(adapter.prefix)));
  }
  state.unapplied = [...unapplied, ...[...keys].filter((k) => !adapters.some((a) => k.startsWith(a.prefix)))];
  if (state.rebasing) {
    const left = state.rebasing.filter((k) => state.unapplied.includes(k));
    if (left.length) state.rebasing = left;
    else delete state.rebasing;
  }
  if (!state.awaitRemote || Object.keys(state.seen).some((d) => baseDevice(d) !== device)) {
    state.joined = true;
    delete state.awaitRemote;
  }
  await flush(state, transport, scope, me, now(), options);
  const quiet = state.ackedAt === undefined ? Infinity : now() - state.ackedAt;
  const coverage = { ...state.vv, [me]: state.seq };
  if (!state.rebasing && (quiet >= KEEP_ALIVE || (quiet >= ACK_EVERY && !sameCoverage(state.acks?.[me]?.at(-1)?.vv, coverage)))) await flush(state, transport, scope, me, now(), options, true);
  const compacted = await compact(state, transport, scope, device, now(), options);
  return { published, changed: changed.size, pending: state.pending, compacted };
}

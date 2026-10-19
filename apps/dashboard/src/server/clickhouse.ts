import { serverEnv } from "./env";

const FRESH_MS = 5 * 60_000;
const KEEP_MS = 6 * 60 * 60_000;
const MAX_IN_FLIGHT = 2;
const SETTINGS = {
  max_execution_time: "15",
  cancel_http_readonly_queries_on_client_close: "1",
  max_memory_usage: "500000000",
  output_format_json_quote_64bit_integers: "0",
};

type Rows = unknown[][];

type Job = {
  sql: string;
  label: string;
  waiters: number;
  controller: AbortController;
  started: boolean;
  promise: Promise<Rows>;
  resolve: (rows: Rows) => void;
  reject: (error: unknown) => void;
};

const cache = new Map<string, { at: number; rows: Rows }>();
const inFlight = new Map<string, Job>();
const queue: Job[] = [];
let running = 0;

function endpoint() {
  const base = serverEnv("CLICKHOUSE_URL") ?? (serverEnv("CLICKHOUSE_HOST") ? `http://${serverEnv("CLICKHOUSE_HOST")}:8123/` : null);
  if (!base) throw new Error("ClickHouse is not configured: set CLICKHOUSE_URL or CLICKHOUSE_HOST");
  const url = new URL(base);
  for (const [key, value] of Object.entries(SETTINGS)) url.searchParams.set(key, value);
  return url;
}

async function execute(job: Job): Promise<Rows> {
  const user = serverEnv("CLICKHOUSE_USER");
  const password = serverEnv("CLICKHOUSE_PASSWORD");
  if (!user || !password) throw new Error("ClickHouse credentials are not configured");
  const timeout = AbortSignal.timeout(20_000);
  const started = performance.now();
  const res = await fetch(endpoint(), {
    method: "POST",
    headers: { "X-ClickHouse-User": user, "X-ClickHouse-Key": password, "Content-Type": "text/plain" },
    body: `${job.sql}\nFORMAT JSONCompact`,
    signal: AbortSignal.any([job.controller.signal, timeout]),
  });
  if (!res.ok) {
    const text = await res.text();
    if (/^\s*</.test(text)) throw new Error(`ClickHouse is unavailable right now (HTTP ${res.status}).`);
    const code = /Code: (\d+)/.exec(text)?.[1];
    if (code === "159") throw new Error("ClickHouse took longer than 15 s on this, so it was stopped. It will be retried.");
    throw new Error(`ClickHouse ${res.status}: ${text.slice(0, 240).replace(/\s+/g, " ")}`);
  }
  const body = (await res.json()) as { data: Rows; statistics?: { elapsed?: number; rows_read?: number; bytes_read?: number } };
  const stats = body.statistics;
  console.log(
    `[clickhouse] ${Math.round(performance.now() - started)} ms total, ${Math.round((stats?.elapsed ?? 0) * 1000)} ms server, ${stats?.rows_read ?? "?"} rows read, ${body.data.length} rows, ${job.label}`,
  );
  return body.data;
}

function pump() {
  while (running < MAX_IN_FLIGHT && queue.length) {
    const job = queue.shift()!;
    if (job.waiters <= 0) {
      inFlight.delete(job.sql);
      job.reject(new DOMException("Aborted", "AbortError"));
      continue;
    }
    running++;
    job.started = true;
    execute(job)
      .then((rows) => {
        cache.set(job.sql, { at: Date.now(), rows });
        job.resolve(rows);
      }, job.reject)
      .finally(() => {
        running--;
        inFlight.delete(job.sql);
        pump();
      });
  }
}

function prune(now: number) {
  if (cache.size < 400) return;
  for (const [key, entry] of cache) if (now - entry.at >= KEEP_MS) cache.delete(key);
}

function refreshInBackground(sql: string) {
  if (inFlight.has(sql)) return;
  const controller = new AbortController();
  query(sql, controller.signal, true).catch(() => undefined);
}

export function query(sql: string, signal?: AbortSignal, background = false): Promise<Rows> {
  const now = Date.now();
  const hit = cache.get(sql);
  if (!background && hit && now - hit.at < KEEP_MS) {
    if (now - hit.at >= FRESH_MS) refreshInBackground(sql);
    return Promise.resolve(hit.rows);
  }
  prune(now);

  let job = inFlight.get(sql);
  if (!job) {
    let resolve!: (rows: Rows) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<Rows>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    promise.catch(() => undefined);
    job = { sql, label: sql.replace(/\s+/g, " ").trim().slice(0, 70), waiters: 0, controller: new AbortController(), started: false, promise, resolve, reject };
    inFlight.set(sql, job);
    queue.push(job);
  }
  const current = job;
  current.waiters++;

  return new Promise<Rows>((resolve, reject) => {
    let settled = false;
    const leave = () => {
      if (settled) return;
      settled = true;
      current.waiters--;
      if (current.waiters <= 0 && current.started) {
        if (inFlight.get(current.sql) === current) inFlight.delete(current.sql);
        current.controller.abort();
      }
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal?.aborted) return leave();
    signal?.addEventListener("abort", leave, { once: true });
    current.promise.then(
      (rows) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", leave);
        resolve(rows);
      },
      (error) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", leave);
        reject(error);
      },
    );
    pump();
  });
}


export const num = (value: unknown): number => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};

export const str = (value: unknown): string => (value == null ? "" : String(value));

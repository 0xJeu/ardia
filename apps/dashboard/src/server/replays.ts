import { gunzipSync } from "node:zlib";
import { windowFor, type RangeKey } from "../lib/range";
import { num, query, str } from "./clickhouse";
import { serverEnv } from "./env";
import { prop, since } from "./sql";

export const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEPT_DAYS = 30;
const DAY = 86_400_000;
const PAGE_SIZE = 50;

export type ReplayFilters = {
  range: RangeKey;
  page: number;
  minDuration: number;
  clicks: boolean;
  device: string;
  url: string;
  sort: "newest" | "longest" | "clicks";
};

const deviceName = (type: string, os: string) => {
  if (type === "Desktop") return os === "Mac OS X" ? "Mac" : os || "Desktop";
  if (os === "iOS") return type === "Tablet" ? "iPad" : "iPhone";
  if (os === "Android") return "Android";
  return os || type || "Other";
};

function replayStart(range: RangeKey) {
  const w = windowFor(range);
  const keptFrom = Math.floor((w.end - KEPT_DAYS * DAY) / DAY) * DAY;
  return Math.max(w.start, keptFrom);
}

export async function listReplays(filters: ReplayFilters, signal?: AbortSignal) {
  const from = replayStart(filters.range);
  const chunkFilter = `event = '$replay_chunk' AND ${since(from)} AND session_id != ''`;
  const [chunks, pages] = await Promise.all([
    query(
      `SELECT session_id, min(toInt64OrZero(properties['first_timestamp'])), max(toInt64OrZero(properties['last_timestamp'])), count(),
         sum(toUInt32OrZero(properties['clicks'])), sum(toUInt64OrZero(properties['bytes']))
       FROM telemetry.events WHERE ${chunkFilter}
       GROUP BY session_id`,
      signal,
    ),
    query(
      `SELECT session_id, count(), argMin(properties['$current_url'], timestamp), any(${prop("$device_type")}), any(${prop("$os")}), any(${prop("$browser")}), any(${prop("$geoip_country_code")})
       FROM telemetry.events
       WHERE event = '$pageview' AND ${since(from)} AND session_id IN (SELECT session_id FROM telemetry.events WHERE ${chunkFilter})
       GROUP BY session_id`,
      signal,
    ),
  ]);
  const pageBySession = new Map(pages.map((r) => [str(r[0]), r]));
  let rows = chunks.map((r) => {
    const id = str(r[0]);
    const p = pageBySession.get(id);
    const start = num(r[1]);
    const end = num(r[2]);
    return {
      id,
      start,
      durationS: Math.max(0, Math.round((end - start) / 1000)),
      chunks: num(r[3]),
      clicks: num(r[4]),
      bytes: num(r[5]),
      pages: p ? num(p[1]) : 0,
      firstUrl: p ? str(p[2]) : "",
      device: p ? deviceName(str(p[3]), str(p[4])) : "Unknown",
      browser: p ? str(p[5]) : "",
      country: p ? str(p[6]) : "",
    };
  });
  const devices = [...new Set(rows.map((r) => r.device))].sort();
  const url = filters.url.trim().toLowerCase();
  rows = rows.filter(
    (r) =>
      r.durationS >= filters.minDuration &&
      (!filters.clicks || r.clicks > 0) &&
      (!filters.device || r.device === filters.device) &&
      (!url || r.firstUrl.toLowerCase().includes(url)),
  );
  rows.sort((a, b) => (filters.sort === "longest" ? b.durationS - a.durationS : filters.sort === "clicks" ? b.clicks - a.clicks : b.start - a.start) || b.start - a.start);
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, filters.page), pageCount);
  return { from, total, page, pageCount, pageSize: PAGE_SIZE, devices, rows: rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) };
}

function replaysBase() {
  const url = serverEnv("REPLAYS_URL") ?? (serverEnv("REPLAYS_HOST") ? `http://${serverEnv("REPLAYS_HOST")}:8888/buckets/replays/` : null);
  if (!url) throw new Error("Replay storage is not configured: set REPLAYS_URL or REPLAYS_HOST");
  return url.endsWith("/") ? url : `${url}/`;
}

function replayHeaders(): Record<string, string> {
  const token = serverEnv("REPLAYS_TOKEN");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const TIMELINE_EVENTS = ["$pageview", "$autocapture", "$rageclick", "$dead_click", "$exception", "download_clicked", "github_clicked", "screenshot_opened", "release_notes_viewed", "send_to_mac_clicked", "notify_clicked"];

export async function getReplay(sessionId: string, signal?: AbortSignal) {
  if (!SESSION_ID.test(sessionId)) throw new Error("Not a session id");
  const keptFrom = Math.floor((Date.now() - (KEPT_DAYS + 1) * DAY) / DAY) * DAY;
  const [meta] = await query(
    `SELECT groupUniqArray(toString(toDate(timestamp))), min(toInt64OrZero(properties['first_timestamp'])), max(toInt64OrZero(properties['last_timestamp'])), count(),
       sum(toUInt32OrZero(properties['clicks'])), sum(toUInt64OrZero(properties['bytes']))
     FROM telemetry.events WHERE event = '$replay_chunk' AND ${since(keptFrom)} AND session_id = '${sessionId}'`,
    signal,
  );
  const days = ((meta?.[0] as string[] | undefined) ?? []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  if (!days.length) return { found: false as const, sessionId };

  const start = num(meta![1]);
  const end = num(meta![2]);
  const lastDay = days.slice().sort().at(-1)!;
  const dayList = [...new Set([...days, new Date(Date.parse(`${lastDay}T00:00:00Z`) + DAY).toISOString().slice(0, 10)])];

  const timelinePromise = query(
    `SELECT toUnixTimestamp64Milli(timestamp), event, properties['$current_url'], properties['$el_text'], properties['$event_type'],
       properties['$exception_values'], properties['location'], ${prop("$device_type")}, ${prop("$os")}, ${prop("$browser")}, ${prop("$geoip_country_code")},
       properties['$referring_domain'], properties['$screen_width'], properties['$screen_height']
     FROM telemetry.events
     WHERE event IN (${TIMELINE_EVENTS.map((e) => `'${e}'`).join(", ")}) AND timestamp >= ${`toDateTime64(${(Date.parse(`${days.slice().sort()[0]}T00:00:00Z`) - DAY) / 1000}, 3, 'UTC')`}
       AND session_id = '${sessionId}'
     ORDER BY timestamp LIMIT 2000`,
    signal,
  );

  const base = replaysBase();
  const headers = replayHeaders();
  const storage = async (url: string, init: RequestInit) => {
    try {
      return await fetch(url, init);
    } catch (error) {
      const cause = (error as { cause?: { code?: string; message?: string } }).cause;
      throw new Error(`Replay storage unreachable (${cause?.code ?? cause?.message ?? (error as Error).message})`);
    }
  };
  const chunks: { seq: number; events: unknown[] }[] = [];
  for (const day of dayList) {
    const listing = await storage(`${base}${day}/${sessionId}/?limit=1000`, { headers: { ...headers, Accept: "application/json" }, signal });
    if (listing.status === 404) continue;
    if (!listing.ok) throw new Error(`Replay storage: ${listing.status}`);
    const entries = ((await listing.json()) as { Entries?: { FullPath: string }[] | null }).Entries ?? [];
    const files = entries
      .map((e) => /(\d+)\.json(\.gz)?$/.exec(e.FullPath.split("/").pop() ?? ""))
      .filter((m): m is RegExpExecArray => m !== null);
    for (let i = 0; i < files.length; i += 4) {
      const loaded = await Promise.all(
        files.slice(i, i + 4).map(async (m) => {
          const res = await storage(`${base}${day}/${sessionId}/${m[0]}`, { headers, signal });
          if (!res.ok) throw new Error(`Replay storage: ${res.status} for chunk ${m[1]}`);
          const bytes = Buffer.from(await res.arrayBuffer());
          const body = JSON.parse((m[2] ? gunzipSync(bytes) : bytes).toString("utf8")) as { events?: unknown[] };
          return { seq: Number(m[1]), events: body.events ?? [] };
        }),
      );
      chunks.push(...loaded);
    }
  }
  const timeline = (await timelinePromise).map((r) => ({
    at: num(r[0]),
    event: str(r[1]),
    url: str(r[2]),
    text: str(r[3]).slice(0, 120),
    kind: str(r[4]),
    message: str(r[5]).slice(0, 200),
    location: str(r[6]),
  }));
  const first = (await timelinePromise).find((r) => str(r[1]) === "$pageview");
  chunks.sort((a, b) => a.seq - b.seq);
  const events = chunks.flatMap((c) => c.events as { timestamp: number }[]).sort((a, b) => a.timestamp - b.timestamp);
  return {
    found: events.length > 0,
    sessionId,
    start,
    end,
    chunks: chunks.length,
    clicks: num(meta![4]),
    bytes: num(meta![5]),
    device: first ? deviceName(str(first[7]), str(first[8])) : "Unknown",
    browser: first ? str(first[9]) : "",
    country: first ? str(first[10]) : "",
    referrer: first ? str(first[11]) : "",
    screen: first && str(first[12]) ? `${str(first[12])}×${str(first[13])}` : "",
    timeline,
    events: JSON.stringify(events),
  };
}

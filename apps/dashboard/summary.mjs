// Read-only daily summary of ardia.dev visits and Mac download clicks, for hekuto.
// Aggregates only: no visitor ids, IPs, pages or referrers leave the server.
// Served at GET /api/site-summary with `Authorization: Bearer $DASHBOARD_SUMMARY_TOKEN`.
// Without that variable set, the route answers 404.
import { timingSafeEqual } from "node:crypto";

const HOSTS = "'ardia.dev', 'www.ardia.dev', 'netnyahoo.com', 'www.netnyahoo.com'";
const SITE = `(source IN ('ardia-site', 'netnyahoo-site', 'posthog-cloud') AND lib IN ('web', 'ardia-web', 'netnyahoo-web') AND host IN (${HOSTS}))`;
const MAC = `(os = 'Mac OS X' AND device_type = 'Desktop')`;

const SQL = `SELECT
  uniqIf(distinct_id, event = '$pageview' AND timestamp >= now() - INTERVAL 7 DAY) AS visitors_7d,
  countIf(event = '$pageview' AND timestamp >= now() - INTERVAL 7 DAY) AS pageviews_7d,
  uniqIf(distinct_id, event = '$pageview' AND timestamp >= now() - INTERVAL 1 DAY) AS visitors_24h,
  countIf(event = 'download_clicked' AND ${MAC} AND timestamp >= now() - INTERVAL 7 DAY) AS mac_download_clicks_7d,
  uniqIf(distinct_id, event = 'download_clicked' AND ${MAC} AND timestamp >= now() - INTERVAL 7 DAY) AS mac_download_people_7d
FROM telemetry.events
WHERE event IN ('$pageview', 'download_clicked')
  AND timestamp >= now() - INTERVAL 7 DAY
  AND ${SITE}
FORMAT JSONEachRow`;

function clickhouse() {
  const base = process.env.CLICKHOUSE_URL ?? (process.env.CLICKHOUSE_HOST ? `http://${process.env.CLICKHOUSE_HOST}:8123/` : null);
  if (!base) throw new Error("ClickHouse is not configured");
  return new URL(base);
}

function authorized(request) {
  const expected = process.env.DASHBOARD_SUMMARY_TOKEN;
  if (!expected) return false;
  const given = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function siteSummaryResponse(request, headers) {
  if (!process.env.DASHBOARD_SUMMARY_TOKEN || !authorized(request)) {
    return new Response("Not found", { status: 404, headers });
  }
  const url = clickhouse();
  url.searchParams.set("max_execution_time", "15");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "X-ClickHouse-User": process.env.CLICKHOUSE_USER ?? "",
      "X-ClickHouse-Key": process.env.CLICKHOUSE_PASSWORD ?? "",
      "Content-Type": "text/plain",
    },
    body: SQL,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return new Response("Summary unavailable", { status: 503, headers });
  const row = JSON.parse((await res.text()).trim().split("\n")[0] || "{}");
  const body = {
    site: "ardia.dev",
    generated_at: new Date().toISOString(),
    visitors_7d: Number(row.visitors_7d) || 0,
    pageviews_7d: Number(row.pageviews_7d) || 0,
    visitors_24h: Number(row.visitors_24h) || 0,
    mac_download_clicks_7d: Number(row.mac_download_clicks_7d) || 0,
    mac_download_people_7d: Number(row.mac_download_people_7d) || 0,
  };
  return new Response(JSON.stringify(body), {
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

#!/usr/bin/env node
import { clickhouse } from "./telemetry-env.mjs";

const query = process.argv.slice(2).join(" ").trim();
if (!query) {
  console.error('usage: node scripts/telemetry-sql.mjs "<query>"');
  process.exit(2);
}
for (const row of await clickhouse(query)) {
  console.log(row.map((v) => (typeof v === "object" ? JSON.stringify(v) : v)).join("\t"));
}

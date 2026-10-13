#!/bin/bash
set -u

rm -rf /data/clickhouse
mkdir -p /data/ch

ulimit -n 1048576 2>/dev/null || ulimit -Sn "$(ulimit -Hn)"
echo "[ac] open files: $(ulimit -Sn) (hard $(ulimit -Hn))"

/entrypoint.sh &
server=$!
trap 'kill -TERM $server 2>/dev/null' TERM INT

for _ in $(seq 1 120); do
  clickhouse client --password "$CLICKHOUSE_ADMIN_PASSWORD" -q "SELECT 1" >/dev/null 2>&1 && break
  sleep 1
done
if clickhouse client --password "$CLICKHOUSE_ADMIN_PASSWORD" --multiquery < /etc/ac/schema.sql; then
  echo "[ac] schema applied"
else
  echo "[ac] schema FAILED" >&2
fi

for table in $(clickhouse client --password "$CLICKHOUSE_ADMIN_PASSWORD" -q "
  SELECT DISTINCT table FROM system.parts
  WHERE active AND database = 'telemetry' AND part_type = 'Wide' AND bytes_on_disk < 1073741824"); do
  clickhouse client --password "$CLICKHOUSE_ADMIN_PASSWORD" -q "OPTIMIZE TABLE telemetry.$table FINAL" \
    && echo "[ac] telemetry.$table merged into compact parts"
done

wait $server

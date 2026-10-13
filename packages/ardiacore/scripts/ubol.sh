#!/usr/bin/env bash
set -euo pipefail

vendor="$(cd "$(dirname "$0")/.." && pwd)/vendor"

UBOL_VERSION="2026.1012.1545"
UBOL_SHA256="73909c8f26d608b00a99f446192630868bea4f947ba293c29bbd18ae948d903b"
UBOL_KEY="MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0ZvGFQVC3AezHHji9jii1xuD992hwYUSRZuvPmdugT/g4FkXxqD9NgrPPVh+nLdRfEvK7ht6i1ADwFJXo9vYh7asPSeB8cU/z/Vt2VufXw7XvR7PGcDWsXXfS3P/LBv/BG3tYOADD/RwwBAPqasjAtWkLsJdEawZArm316VS6Boo89W5lrCNp4bm4RYqTP9MRTBzRzZS7NmMQWNnD1OFEDb4w+36+J1lSLMv8A06EEbVzvIdYK6MQrUwhLXe6CfeITpp/YQ6PWWEfmRpQUolkLiOE/swvV8GvkV9Kpx/USDwhkaybF7JZqKV5nUSYdiRiO/7t30yDnk52MG7xR4KBQIDAQAB"
ubol="$vendor/ubol"
installed() { [ -f "$ubol/.version" ] && [ "$(cat "$ubol/.version")" = "$UBOL_VERSION" ]; }
if ! installed && [ -z "${UBOL_LOCKED:-}" ]; then
  mkdir -p "$ubol"
  UBOL_LOCKED=1 exec lockf -k -t 600 "$ubol/.lock" "$0"
fi
if ! installed; then
  zip="$ubol/uBOLite_$UBOL_VERSION.chromium.zip"
  if [ ! -f "$zip" ]; then
    url="https://github.com/uBlockOrigin/uBOL-home/releases/download/$UBOL_VERSION/uBOLite_$UBOL_VERSION.chromium.zip"
    echo "Downloading $url"
    curl -fL --retry 3 -o "$zip.part" "$url"
    mv "$zip.part" "$zip"
  fi
  echo "$UBOL_SHA256  $zip" | shasum -a 256 -c -
  rm -rf "$ubol/ext.new" "$ubol/ext.old"
  unzip -q "$zip" -d "$ubol/ext.new"
  python3 - "$ubol/ext.new/manifest.json" "$UBOL_KEY" <<'PY'
import json, sys
path, key = sys.argv[1], sys.argv[2]
manifest = json.load(open(path))
manifest["key"] = key
json.dump(manifest, open(path, "w"), indent=2)
PY
  [ -d "$ubol/ext" ] && mv "$ubol/ext" "$ubol/ext.old"
  mv "$ubol/ext.new" "$ubol/ext"
  rm -rf "$ubol/ext.old"
  echo "$UBOL_VERSION" > "$ubol/.version"
fi

#!/usr/bin/env bash
set -euo pipefail

vendor="$(cd "$(dirname "$0")/.." && pwd)/vendor"

UBO_VERSION="1.75.0"
UBO_SHA256="393cf95709d1074d4022970e9014e434395c53a822387f1e25f43be97cf4b582"
UBO_KEY="MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAv1MPdIgJjIsN4Y0N/20GDNPfN4J//aknk5dsH8Y1LBxSnz3Jp/BT187Gub5cv6lee5CUVDmVBa3Yiqow8GMna5KwX+ZP+yc1pt/ewzyNxm2BzoQPgWz+1DgZaahz56/szi1EEtWVYxd3wNxFN4wPDqwV6aqlnV4R3RnxlF1ocw1kDgJ+8BxR1EY+MB+H8bymdef+xB3TNifBZIVmZt81cC3UMOG6KWRTU1wtIXsW+ZqSv5zaeFHLkjG4MPB7EfcMGrvO80ElJBZZLdrTmYOL4uUPsz2Wy6GiPWzpDmzzI9RfsZm11sLiJo63blcPF0Cz3sM0wQfxJPPcQuqkZDReswIDAQAB"
UBO_PATCH="18"
ubo="$vendor/ubo"
stamp="$UBO_VERSION-$UBO_PATCH"
installed() { [ -f "$ubo/.version" ] && [ "$(cat "$ubo/.version")" = "$stamp" ]; }
if ! installed && [ -z "${UBO_LOCKED:-}" ]; then
  mkdir -p "$ubo"
  UBO_LOCKED=1 exec lockf -k -t 600 "$ubo/.lock" "$0"
fi
if ! installed; then
  zip="$ubo/uBlock0_$UBO_VERSION.chromium.zip"
  if [ ! -f "$zip" ]; then
    url="https://github.com/gorhill/uBlock/releases/download/$UBO_VERSION/uBlock0_$UBO_VERSION.chromium.zip"
    echo "Downloading $url"
    curl -fL --retry 3 -o "$zip.part" "$url"
    mv "$zip.part" "$zip"
  fi
  echo "$UBO_SHA256  $zip" | shasum -a 256 -c -
  rm -rf "$ubo/unzip" "$ubo/ext.new" "$ubo/ext.old"
  unzip -q "$zip" -d "$ubo/unzip"
  mv "$ubo/unzip/uBlock0.chromium" "$ubo/ext.new"
  rm -rf "$ubo/unzip"
  python3 -I - "$ubo/ext.new" "$UBO_KEY" "$UBO_PATCH" <<'PY'
import json, os, sys
ext, key, level = sys.argv[1], sys.argv[2], sys.argv[3]
path = os.path.join(ext, "manifest.json")
manifest = json.load(open(path))
manifest["key"] = key
manifest["version_name"] = manifest["version"]
manifest["version"] = f"{manifest['version']}.{level}"
manifest["incognito"] = "spanning"
web = ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"]
if manifest["permissions"].count("<all_urls>") != 1:
    sys.exit("ubo.sh: manifest.json no longer asks for <all_urls>")
manifest["permissions"] = [p for p in manifest["permissions"] if p != "<all_urls>"] + web
scripts = manifest["content_scripts"]
kept = [entry for entry in scripts if entry["js"] not in (["/js/scriptlets/subscriber.js"], ["/js/scriptlets/updater.js"])]
if len(kept) != len(scripts) - 2:
    sys.exit("ubo.sh: manifest.json no longer has the subscriber and updater content scripts")
manifest["content_scripts"] = kept
json.dump(manifest, open(path, "w"), indent=2)
ARDIA_MIRROR_HELPERS = r"""const ardiaMirrorRoot = 'https://services.helium.imput.net/ubo/';
const ardiaMirrorURLs = new Map(Object.entries(ARDIA_MIRROR_MAP));
const ardiaBundledSizes = new Map(Object.entries(ARDIA_MIRROR_BUNDLED_SIZES));
const ardiaMinimumFilterLines = ARDIA_MIRROR_MIN_LINES;
const ardiaIsMirrorURL = url => typeof url === 'string' && url.startsWith(ardiaMirrorRoot);
const ardiaIsFilterLine = line => {
    const s = line.trim();
    if ( s === '' || s.startsWith('!') || /^#(?:\s|$)/.test(s) ) { return false; }
    return /^\[adblock/i.test(s) === false;
};
const ardiaLooksLikeFilterList = text => {
    const start = text.trimStart();
    if ( start.startsWith('{') || start.startsWith('<') ) { return false; }
    return start.startsWith('[') === false || /^\[adblock/i.test(start);
};
async function ardiaMirrorCopyUnusable(assetKey, text) {
    if ( ardiaLooksLikeFilterList(text) === false ) { return 'the mirror copy is not a filter list'; }
    const cached = await assetCacheRead(assetKey);
    const floor = stringIsNotEmpty(cached.content)
        ? cached.content.length
        : ardiaBundledSizes.get(assetKey) || 0;
    if ( floor !== 0 ) {
        return text.length * 2 < floor ? 'the mirror copy is much smaller than the last good one' : undefined;
    }
    let lines = 0;
    for ( const line of text.split('\n') ) {
        if ( ardiaIsFilterLine(line) === false ) { continue; }
        lines += 1;
        if ( lines >= ardiaMinimumFilterLines ) { return; }
    }
    return 'the mirror copy has too few filters';
}
const ardiaMirrorURL = assetKey => {
    const url = ardiaMirrorURLs.get(assetKey);
    if ( ardiaIsMirrorURL(url) === false ) { return; }
    if ( µb.isTrustedList(assetKey) ) { return; }
    return url;
};
const ardiaSameOrigin = (requested, received) => {
    if ( typeof received !== 'string' || received === '' ) { return false; }
    try {
        return new URL(requested).origin === new URL(received).origin;
    } catch {
        return false;
    }
};
const ardiaCachedURL = (assetKey, url) => {
    if ( ardiaIsMirrorURL(url) === false ) { return url; }
    const entry = assetSourceRegistry[assetKey];
    const own = entry instanceof Object
        ? (Array.isArray(entry.contentURL) ? entry.contentURL : [ entry.contentURL ])
        : [];
    return own.find(u => typeof u === 'string' && reIsExternalPath.test(u)) || assetKey;
};

const getContentURLs = (assetKey, options = {}) => {
"""
ARDIA_MIRROR_ON = False
def ardia_mirror_map(ext):
    if not ARDIA_MIRROR_ON:
        return {}, {}, 0
    import hashlib, posixpath, re, struct
    from urllib.parse import urlparse
    registry = json.load(open(os.path.join(ext, "assets", "assets.json")))
    def urls(value):
        return [value] if isinstance(value, str) else value if isinstance(value, list) else []
    mirrored = {}
    for key, entry in registry.items():
        if entry.get("content") != "filters" or key.startswith("ublock-") or key == "user-filters":
            continue
        sources = [u for u in urls(entry.get("contentURL")) + urls(entry.get("cdnURLs"))
                   if isinstance(u, str) and urlparse(u).scheme in ("http", "https")]
        if not sources:
            continue
        name = posixpath.basename(urlparse(sources[0]).path)
        if not (name.endswith(".txt") or name.endswith(".dat")):
            name = "filters.txt"
        first, second = struct.unpack("<II", hashlib.sha256(sources[0].encode()).digest()[:8])
        mirrored[key] = f"https://services.helium.imput.net/ubo/{key}/{first:x}/{second:x}/{name}"
    if len(mirrored) < 40:
        sys.exit(f"ubo.sh: only {len(mirrored)} lists for the mirror; assets.json changed shape")
    bundled = {}
    for key in mirrored:
        for url in urls(registry[key].get("contentURL")):
            if isinstance(url, str) and urlparse(url).scheme == "" and os.path.isfile(os.path.join(ext, url)):
                bundled[key] = os.path.getsize(os.path.join(ext, url))
                break
    def filter_lines(path):
        count = 0
        for line in open(path, encoding="utf-8", errors="replace"):
            text = line.strip()
            if not text or text.startswith("!") or re.match(r"^#(?:\s|$)", text) or re.match(r"^\[adblock", text, re.I):
                continue
            count += 1
        return count
    defaults = [key for key in bundled if registry[key].get("off") is not True]
    if not defaults:
        sys.exit("ubo.sh: no default list for the mirror has a bundled copy")
    fewest = min(filter_lines(os.path.join(ext, next(u for u in urls(registry[key].get("contentURL"))
                                                         if isinstance(u, str) and urlparse(u).scheme == ""
                                                         and os.path.isfile(os.path.join(ext, u)))))
                 for key in defaults)
    scale = 10 ** (len(str(fewest)) - 1)
    return mirrored, bundled, fewest // scale * scale
def patch(rel, old, new):
    path = os.path.join(ext, rel)
    source = open(path).read()
    if source.count(old) != 1:
        sys.exit(f"ubo.sh: {rel} no longer has exactly one {old.strip().splitlines()[0]!r}")
    open(path, "w").write(source.replace(old, new))
patch("js/background.js", "prefetchingDisabled: true,", "prefetchingDisabled: false,")
patch("js/background.js", "    noDashboard: false,", "    noDashboard: true,")
patch("js/background.js", "    autoUpdateDelayAfterLaunch: 37,", "    autoUpdateDelayAfterLaunch: 600,")
patch("js/background.js", "    showIconBadge: true,", "    showIconBadge: false,")
patch("js/background.js", "    contextMenuEnabled: true,", "    contextMenuEnabled: false,")
patch("js/contextmenu.js", "    newBits |= SUBSCRIBE_TO_LIST_BIT;\n", "")
patch("js/vapi-background.js",
      "        let version = manifest.version_name || manifest.version;\n",
      "        let version = manifest.version;\n")
patch("js/start.js",
      "    redirectEngine.invalidateResourcesSelfie(io);\n};\n",
      "    redirectEngine.invalidateResourcesSelfie(io);\n"
      "    µb.compiledFormatChanged = true;\n"
      "    µb.selfieManager.destroy();\n"
      "};\n")
patch("js/vapi-background.js",
      "    if ( webext.storage.managed instanceof Object === false ) {\n        return {",
      "    if ( true ) {\n        return {")
ARDIA_MIRROR = ardia_mirror_map(ext)
patch("js/assets.js", "const getContentURLs = (assetKey, options = {}) => {\n",
      ARDIA_MIRROR_HELPERS.replace("ARDIA_MIRROR_MAP", json.dumps(ARDIA_MIRROR[0], sort_keys=True))
      .replace("ARDIA_MIRROR_BUNDLED_SIZES", json.dumps(ARDIA_MIRROR[1], sort_keys=True))
      .replace("ARDIA_MIRROR_MIN_LINES", str(ARDIA_MIRROR[2])))
patch("js/assets.js",
      "            contentURLs.unshift(...cdnURLs);\n"
      "        }\n"
      "    }\n"
      "    return contentURLs;\n"
      "};\n",
      "            contentURLs.unshift(...cdnURLs);\n"
      "        }\n"
      "    }\n"
      "    const mirrorURL = ardiaMirrorURL(assetKey);\n"
      "    if ( mirrorURL !== undefined ) {\n"
      "        const firstRemote = contentURLs.findIndex(url => reIsExternalPath.test(url));\n"
      "        contentURLs.splice(firstRemote === -1 ? contentURLs.length : firstRemote, 0, mirrorURL);\n"
      "    }\n"
      "    return contentURLs;\n"
      "};\n")
patch("js/assets.js",
      "            statusText: this.statusText || ''\n"
      "        };\n",
      "            statusText: this.statusText || '',\n"
      "            responseURL: this.responseURL || '',\n"
      "        };\n")
patch("js/assets.js",
      "        timeoutTimer.off();\n"
      "    };\n",
      "        timeoutTimer.off();\n"
      "        clearTimeout(deadlineTimer);\n"
      "    };\n")
patch("js/assets.js",
      "    const timeoutTimer = vAPI.defer.create(onTimeout);\n",
      "    const timeoutTimer = vAPI.defer.create(onTimeout);\n"
      "    const deadlineTimer = ardiaIsMirrorURL(url) ? setTimeout(onTimeout, timeoutAfter * 1000) : undefined;\n")
patch("js/assets.js",
      "        details = await assets.fetch(actualUrl);\n",
      "        details = await assets.fetch(actualUrl);\n"
      "        if ( ardiaIsMirrorURL(url) && ardiaSameOrigin(actualUrl, details.responseURL) === false ) {\n"
      "            details.content = '';\n"
      "            details.error = 'assets.fetchText(): redirected to another origin';\n"
      "        }\n")
patch("js/assets.js",
      "                url: contentURL,\n"
      "                silent: options.silent === true,\n",
      "                url: ardiaCachedURL(assetKey, contentURL),\n"
      "                silent: options.silent === true,\n")
patch("js/assets.js",
      "            url: contentURL,\n"
      "            resourceTime: result.resourceTime || 0,\n",
      "            url: ardiaCachedURL(assetKey, contentURL),\n"
      "            resourceTime: result.resourceTime || 0,\n")
patch("js/assets.js",
      "            continue;\n"
      "        }\n"
      "\n"
      "        error = undefined;\n"
      "\n"
      "        // If fetched resource is older than cached one, ignore\n",
      "            continue;\n"
      "        }\n"
      "\n"
      "        if ( ardiaIsMirrorURL(contentURL) ) {\n"
      "            const unusable = await ardiaMirrorCopyUnusable(assetKey, result.content);\n"
      "            if ( unusable !== undefined ) {\n"
      "                error = unusable;\n"
      "                continue;\n"
      "            }\n"
      "        }\n"
      "\n"
      "        error = undefined;\n"
      "\n"
      "        // If fetched resource is older than cached one, ignore\n")
patch("js/assets.js",
      "        if ( details.content === '' ) { continue; }\n"
      "        if ( reIsExternalPath.test(contentURL) && options.dontCache !== true ) {\n",
      "        if ( details.content === '' ) { continue; }\n"
      "        if ( ardiaIsMirrorURL(contentURL) ) {\n"
      "            const unusable = await ardiaMirrorCopyUnusable(assetKey, details.content);\n"
      "            if ( unusable !== undefined ) {\n"
      "                error = unusable;\n"
      "                continue;\n"
      "            }\n"
      "        }\n"
      "        if ( reIsExternalPath.test(contentURL) && options.dontCache !== true ) {\n")
patch("js/diff-updater.js",
      "        const response = await fetch(patchURL).catch(reason => {\n"
      "            console.error(reason, patchURL);\n"
      "        });\n"
      "        if ( response === undefined ) { continue; }\n"
      "        if ( response.status === 404 ) { break; }\n"
      "        if ( response.ok !== true ) { continue; }\n"
      "        const patchText = await response.text();\n",
      "        const controller = new AbortController();\n"
      "        const deadline = setTimeout(( ) => { controller.abort(); }, 30000);\n"
      "        const stop = ( ) => { clearTimeout(deadline); controller.abort(); };\n"
      "        const response = await fetch(patchURL, { signal: controller.signal }).catch(reason => {\n"
      "            console.error(reason, patchURL);\n"
      "        });\n"
      "        const sameOrigin = response !== undefined && typeof response.url === 'string' &&\n"
      "            response.url.startsWith(patchURL.origin + '/');\n"
      "        if ( response === undefined || sameOrigin === false ) { stop(); continue; }\n"
      "        if ( response.status === 404 ) { stop(); break; }\n"
      "        if ( response.ok !== true ) { stop(); continue; }\n"
      "        const patchText = await response.text().catch(( ) => undefined);\n"
      "        clearTimeout(deadline);\n"
      "        if ( patchText === undefined ) { continue; }\n")
patch("js/storage.js",
      "            const match = /^[a-z]+/.exec(i18n.getUILanguage());\n"
      "            if ( match !== null ) {\n"
      "                re = new RegExp('\\\\b' + match[0] + '\\\\b');",
      "            const langs = new Set([ i18n.getUILanguage(), ...(self.navigator.languages || []) ]\n"
      "                .map(lang => (/^[a-z]+/.exec(lang) || [])[0]).filter(Boolean));\n"
      "            if ( langs.size !== 0 ) {\n"
      "                re = new RegExp('\\\\b(?:' + Array.from(langs).join('|') + ')\\\\b');")
PY
  [ -d "$ubo/ext" ] && mv "$ubo/ext" "$ubo/ext.old"
  mv "$ubo/ext.new" "$ubo/ext"
  rm -rf "$ubo/ext.old"
  echo "$stamp" > "$ubo/.version"
fi

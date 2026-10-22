#!/usr/bin/env bash
set -euo pipefail

vendor="$(cd "$(dirname "$0")/.." && pwd)/vendor"

UBO_VERSION="1.75.0"
UBO_SHA256="393cf95709d1074d4022970e9014e434395c53a822387f1e25f43be97cf4b582"
UBO_KEY="MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAv1MPdIgJjIsN4Y0N/20GDNPfN4J//aknk5dsH8Y1LBxSnz3Jp/BT187Gub5cv6lee5CUVDmVBa3Yiqow8GMna5KwX+ZP+yc1pt/ewzyNxm2BzoQPgWz+1DgZaahz56/szi1EEtWVYxd3wNxFN4wPDqwV6aqlnV4R3RnxlF1ocw1kDgJ+8BxR1EY+MB+H8bymdef+xB3TNifBZIVmZt81cC3UMOG6KWRTU1wtIXsW+ZqSv5zaeFHLkjG4MPB7EfcMGrvO80ElJBZZLdrTmYOL4uUPsz2Wy6GiPWzpDmzzI9RfsZm11sLiJo63blcPF0Cz3sM0wQfxJPPcQuqkZDReswIDAQAB"
UBO_PATCH="13"
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
ARDIA_MIRROR_HELPERS = r"""const ardiaMirror = 'https://services.helium.imput.net/ubo/';
const ardiaURLs = value => typeof value === 'string' ? [ value ] : Array.isArray(value) ? value : [];
const ardiaIsRemote = url => /^https?:\/\//.test(url);
const ardiaIsMirror = url => url.startsWith(ardiaMirror);

function ardiaAssetsJsonFirstFromMirror(entry) {
    const urls = ardiaURLs(entry.contentURL);
    if ( urls.some(ardiaIsMirror) === false ) {
        entry.contentURL = [ `${ardiaMirror}assets.json`, ...urls ];
    }
    entry.cdnURLs = null;
    return entry;
}

function ardiaListFirstFromMirror(entry, mirrorEntry) {
    const own = ardiaURLs(entry.contentURL);
    const mirrored = ardiaURLs(mirrorEntry && mirrorEntry.contentURL).filter(ardiaIsMirror);
    if ( mirrored.length === 0 ) { return entry; }
    entry.contentURL = [ ...new Set([
        ...mirrored,
        ...own.filter(ardiaIsRemote),
        ...ardiaURLs(entry.cdnURLs),
        ...own.filter(url => ardiaIsRemote(url) === false),
    ]) ];
    entry.cdnURLs = null;
    entry.patchURLs = Array.isArray(mirrorEntry.patchURLs) ? mirrorEntry.patchURLs.slice() : null;
    return entry;
}

async function ardiaRegistry(json) {
    let dict;
    try { dict = JSON.parse(json); } catch { return json; }
    if ( dict instanceof Object === false || dict['assets.json'] instanceof Object === false ) { return json; }
    if ( ardiaURLs(dict['assets.json'].contentURL).some(ardiaIsMirror) === false ) {
        ardiaAssetsJsonFirstFromMirror(dict['assets.json']);
        return JSON.stringify(dict);
    }
    let base;
    try { base = JSON.parse((await assets.fetchText(µb.assetsJsonPath)).content); } catch { return ''; }
    if ( base instanceof Object === false || base['assets.json'] instanceof Object === false ) { return ''; }
    for ( const [ assetKey, entry ] of Object.entries(base) ) {
        if ( assetKey === 'assets.json' ) {
            ardiaAssetsJsonFirstFromMirror(entry);
        } else {
            ardiaListFirstFromMirror(entry, dict[assetKey]);
        }
    }
    return JSON.stringify(base);
}

function ardiaAdoptMirror() {
    const entry = assetSourceRegistry['assets.json'];
    if ( entry instanceof Object === false ) { return; }
    const merged = Object.entries(assetSourceRegistry).some(([ assetKey, details ]) =>
        assetKey !== 'assets.json' && ardiaURLs(details.contentURL).some(ardiaIsMirror)
    );
    if ( merged && ardiaURLs(entry.contentURL).some(ardiaIsMirror) ) { return; }
    ardiaAssetsJsonFirstFromMirror(entry);
    saveAssetSourceRegistry(true);
    assetCacheMarkAsDirty('assets.json');
}

let assetSourceRegistryPromise;
"""
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
patch("js/assets.js", "let assetSourceRegistryPromise;\n", ARDIA_MIRROR_HELPERS)
patch("js/assets.js",
      "                    assetSourceRegistry = bin.assetSourceRegistry;\n"
      "                    ubolog('Loaded assetSourceRegistry');\n",
      "                    assetSourceRegistry = bin.assetSourceRegistry;\n"
      "                    ardiaAdoptMirror();\n"
      "                    ubolog('Loaded assetSourceRegistry');\n")
patch("js/assets.js",
      "            }).then(details => {\n"
      "                updateAssetSourceRegistry(details.content, true);\n",
      "            }).then(async details => {\n"
      "                updateAssetSourceRegistry(await ardiaRegistry(details.content), true);\n")
patch("js/assets.js",
      "            updateAssetSourceRegistry(result.content);\n",
      "            updateAssetSourceRegistry(await ardiaRegistry(result.content));\n")
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

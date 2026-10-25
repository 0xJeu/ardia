#!/usr/bin/env bash
set -euo pipefail

usage="usage: publish.sh <version> [--dry-run] [--break-lock]"
version="${1:?$usage}"
shift
dry=0
break_lock=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry=1 ;;
    --break-lock) break_lock=1 ;;
    *) echo "error: unknown option $arg ($usage)" >&2; exit 1 ;;
  esac
done
here="$(cd "$(dirname "$0")" && pwd)"
root="$(git -C "$here" rev-parse --show-toplevel)"
repo="mantrakp04/ardia"
dist="${RELEASE_DIST:-$root/dist/$version}"
dist_x64="${RELEASE_DIST_X64:-}"
latest_url="https://github.com/$repo/releases/latest/download"
nightly_url="https://github.com/$repo/releases/download/nightly"
die() { echo "error: $*" >&2; exit 1; }
run() {
  echo "+ $*"
  [ "$dry" = 1 ] || "$@"
}

if [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+-nightly\.[0-9]+$ ]]; then
  channel=nightly
elif [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  channel=stable
else
  die "$version is neither a stable (<major>.<minor>.<patch>) nor a nightly (<next stable>-nightly.<n>) version"
fi
arches=(arm64)
[ -z "$dist_x64" ] || arches+=(x86_64)
dist_of() { if [ "$1" = x86_64 ]; then echo "$dist_x64"; else echo "$dist"; fi; }
suffix_of() { if [ "$1" = x86_64 ]; then echo -x64; fi; }
feed_of() { echo "appcast$(suffix_of "$1").xml"; }
dmg_of() { echo "$(dist_of "$1")/Ardia-$version$(suffix_of "$1").dmg"; }
zip_of() { echo "$(dist_of "$1")/Ardia-$version$(suffix_of "$1").zip"; }
cli_of() { echo "$(dist_of "$1")/ardia-cli-$version-macos-$1.tar.gz"; }

assets=()
for arch in "${arches[@]}"; do
  feed="$(dist_of "$arch")/$(feed_of "$arch")"
  for file in "$(dmg_of "$arch")" "$(zip_of "$arch")" "$feed" "$(cli_of "$arch")" "$(cli_of "$arch").sha256"; do
    [ -f "$file" ] || die "no $file (scripts/release.sh $version --channel $channel --arch $arch first)"
    assets+=("$file")
  done
  item="$(awk -v v="$version" '/<item>/ { buf = "" } { buf = buf $0 "\n" } /<\/item>/ && buf ~ ("shortVersionString>" v "<") { print buf; exit }' "$feed")"
  [ -n "$item" ] || die "$feed has no item for $version"
  if [ "$channel" = nightly ]; then
    grep -q '<sparkle:channel>nightly</sparkle:channel>' <<<"$item" || die "$version's item in $feed isn't on the nightly channel"
  else
    ! grep -q '<sparkle:channel>' <<<"$item" || die "$version's item in $feed is on a channel, so stable copies would skip it"
  fi
done
[ -f "$dist/release-notes.md" ] || die "no $dist/release-notes.md"
for archive in "$dist"/ArdiaCore-*.tar.xz; do [ -f "$archive" ] && assets+=("$archive"); done
if ! git -C "$root" ls-remote --exit-code --tags origin "refs/tags/v$version" >/dev/null 2>&1; then
  [ "$dry" = 1 ] && echo "note: v$version isn't on origin yet (git tag v$version && git push origin main v$version)" \
    || die "push the tag first: git tag v$version && git push origin main v$version"
fi
lock_name="${PUBLISH_LOCK:-release-lock}"
[[ "$lock_name" =~ ^[A-Za-z0-9._-]+$ ]] || die "PUBLISH_LOCK must be a plain branch name"
lock_api="repos/$repo/git/refs/heads/$lock_name"
lock_sha=""
lock_max_age=7200
if [ -n "${GITHUB_RUN_ID:-}" ]; then
  holder="CI run ${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-$repo}/actions/runs/$GITHUB_RUN_ID"
else
  holder="$(id -un)@$(hostname -s)"
fi
holder="$(LC_ALL=C tr -cd 'A-Za-z0-9@._:/ -' <<<"$holder")"
release_lock() {
  [ -n "$lock_sha" ] || return 0
  local current
  current="$(gh api "repos/$repo/git/ref/heads/$lock_name" -q .object.sha 2>/dev/null || true)"
  if [ "$current" = "$lock_sha" ]; then
    gh api -X DELETE "$lock_api" >/dev/null && echo "released the publish lock ($lock_name)"
  fi
  lock_sha=""
}
take_lock() {
  local tree commit existing message since now age
  now="$(date -u +%s)"
  tree="$(gh api "repos/$repo/commits/main" -q .commit.tree.sha)"
  commit="$(printf '{"message":"publish lock: %s by %s (pid %s) since %s","tree":"%s","parents":[]}' \
    "$version" "$holder" "$$" "$now" "$tree" | gh api "repos/$repo/git/commits" --input - -q .sha)"
  if gh api "repos/$repo/git/refs" -f ref="refs/heads/$lock_name" -f sha="$commit" >/dev/null 2>&1; then
    lock_sha="$commit"
    echo "took the publish lock ($lock_name) as $holder"
    return 0
  fi
  existing="$(gh api "repos/$repo/git/ref/heads/$lock_name" -q .object.sha 2>/dev/null)" \
    || die "couldn't take the publish lock ($lock_name), and it isn't there either: check gh's access to $repo"
  message="$(gh api "repos/$repo/git/commits/$existing" -q .message 2>/dev/null || true)"
  since="$(sed -n 's/.* since \([0-9][0-9]*\)$/\1/p' <<<"$message")"
  age=$(( now - ${since:-0} ))
  if [ "$break_lock" = 1 ] && [ "$age" -ge "$lock_max_age" ]; then
    echo "breaking a $((age / 60)) min old publish lock: ${message:-no holder recorded}"
    gh api -X DELETE "$lock_api" >/dev/null || true
    gh api "repos/$repo/git/refs" -f ref="refs/heads/$lock_name" -f sha="$commit" >/dev/null 2>&1 \
      || die "someone else took the publish lock ($lock_name) as it was broken"
    lock_sha="$commit"
    echo "took the publish lock ($lock_name) as $holder"
    return 0
  fi
  if [ "$age" -ge "$lock_max_age" ]; then
    die "publishing is locked by ${message:-an unknown holder} ($((age / 60)) min ago, branch $lock_name): if that publish is dead, run again with --break-lock"
  fi
  die "publishing is locked by ${message:-an unknown holder} ($((age / 60)) min ago, branch $lock_name): wait for it to finish (a lock under 2 h can't be broken)"
}

work="$(mktemp -d "${TMPDIR:-/tmp}/ac-publish.XXXXXX")"
trap 'release_lock; rm -rf "$work"' EXIT
trap 'exit 130' INT TERM HUP
take_lock
stable_tag="$(gh release view -R "$repo" --json tagName -q .tagName)"
[[ "$stable_tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "the latest release is $stable_tag, not a stable one: the feed lives on the latest stable release"
published="$(gh release view "$stable_tag" -R "$repo" --json assets -q '.assets[].name')"

for arch in "${arches[@]}"; do
  feed="$(feed_of "$arch")" arch_dist="$(dist_of "$arch")"
  if grep -qx "$feed" <<<"$published"; then
    mkdir -p "$work/live-$arch"
    gh release download "$stable_tag" -R "$repo" -p "$feed" -D "$work/live-$arch"
    source="$work/live-$arch/$feed"
  else
    echo "note: $stable_tag has no $feed yet: $version starts it"
    source=none
  fi
  if [ "$dry" = 1 ]; then
    mkdir -p "$work/$arch"
    cp "$arch_dist/$feed" "$work/$arch/"
    cp "$arch_dist/${feed%.xml}.built.xml" "$work/$arch/" 2>/dev/null || true
    arch_dist="$work/$arch"
  fi
  RELEASE_DIST="$arch_dist" APPCAST_NAME="$feed" "$here/appcast-merge.sh" "$version" "$source"
  python3 -I - "$arch_dist/$feed" "$version" <<'PY'
import re, sys
path, version = sys.argv[1:]
items = re.findall(r"<item>.*?</item>", open(path).read(), re.S)
def build_of(item):
    found = re.search(r"<sparkle:version>([0-9]+)</sparkle:version>", item)
    return int(found.group(1)) if found else None
mine = [build_of(i) for i in items if f"<sparkle:shortVersionString>{version}<" in i]
others = [build_of(i) for i in items if f"<sparkle:shortVersionString>{version}<" not in i and build_of(i) is not None]
if len(mine) != 1 or mine[0] is None:
    sys.exit(f"error: {path} has {len(mine)} items for {version}, not one")
if others and mine[0] <= max(others):
    sys.exit(f"error: {version} is build {mine[0]}, but the published feed already has build {max(others)}: a stale build would sit below it (and a stable would move latest backward); bump CURRENT_PROJECT_VERSION and rebuild")
print(f"PASS  {version} (build {mine[0]}) is above every other build in {path.rsplit('/', 1)[-1]} ({max(others) if others else 'none'})")
PY
done
if [ "$channel" = stable ]; then
  latest_version="${stable_tag#v}"
  [ "$version" != "$latest_version" ] && [ "$(printf '%s\n%s\n' "$latest_version" "$version" | sort -V | tail -1)" = "$version" ] \
    || die "$version isn't above the latest stable release ($latest_version): publishing it as latest would move every download and feed backward"
  echo "PASS  $version is above the latest stable release ($latest_version)"
fi

carried=""
if [ "$channel" = stable ] && [ -z "$dist_x64" ] && grep -qx appcast-x64.xml <<<"$published"; then
  echo "note: no Intel build in $version: its release carries $stable_tag's appcast-x64.xml unchanged, so Intel copies keep their feed"
  gh release download "$stable_tag" -R "$repo" -p appcast-x64.xml -D "$work"
  grep -q 'xmlns:sparkle' "$work/appcast-x64.xml" || die "$stable_tag's appcast-x64.xml isn't a Sparkle appcast"
  carried="$work/appcast-x64.xml"
  assets+=("$carried")
fi

if [ "$channel" = nightly ]; then
  release_flags=(--prerelease --latest=false)
else
  release_flags=(--latest)
fi
run gh release create "v$version" -R "$repo" "${release_flags[@]}" --verify-tag --title "Ardia $version" \
  --notes-file "$dist/release-notes.md" "${assets[@]}"
feeds=()
for arch in "${arches[@]}"; do feeds+=("$(dist_of "$arch")/$(feed_of "$arch")"); done
if [ "$channel" = nightly ]; then
  nightly_notes="The newest nightly, always as Ardia-Nightly.dmg (https://ardia.dev/nightly)${dist_x64:+, and Ardia-Nightly-x64.dmg for Intel Macs}. Now $version: its notes and source are at https://github.com/$repo/releases/tag/v$version. Every nightly's notes: https://ardia.dev/release-notes"
  if ! gh release view nightly -R "$repo" >/dev/null 2>&1; then
    run gh release create nightly -R "$repo" --prerelease --latest=false --title "Ardia Nightly" --notes "$nightly_notes"
  fi
  nightly_dmgs=()
  for arch in "${arches[@]}"; do
    cp -c "$(dmg_of "$arch")" "$work/Ardia-Nightly$(suffix_of "$arch").dmg"
    nightly_dmgs+=("$work/Ardia-Nightly$(suffix_of "$arch").dmg")
  done
  run gh release upload nightly -R "$repo" --clobber "${nightly_dmgs[@]}"
  run gh release edit nightly -R "$repo" --notes "$nightly_notes"
  run gh release upload "$stable_tag" -R "$repo" --clobber "${feeds[@]}"
fi

tap() { [ "${PUBLISH_TAP:-1}" = 0 ] && { echo "note: the Homebrew tap is left alone (PUBLISH_TAP=0): run update-tap.sh $version"; return 0; }; "$here/update-tap.sh" "$@"; }
[ "$dry" = 1 ] && { tap "$version" --dry-run || true; echo "dry run: nothing published"; exit 0; }
status=0
for arch in "${arches[@]}"; do
  feed="$(feed_of "$arch")"
  for url in "$latest_url/$feed" "https://ardia.dev/$feed"; do
    for _ in $(seq 1 18); do
      xml="$(curl -fsSL --max-time 20 "$url" 2>/dev/null || true)"
      grep -q "<sparkle:shortVersionString>$version<" <<<"$xml" && break
      sleep 10
    done
    grep -q "<sparkle:shortVersionString>$version<" <<<"$xml" && echo "PASS  $url lists $version" \
      || { echo "FAIL  $url lists $version"; status=1; }
  done
done
if [ -n "$carried" ]; then
  carried_xml="$(curl -fsSL --max-time 20 "$latest_url/appcast-x64.xml" 2>/dev/null || true)"
  [ "$carried_xml" = "$(cat "$carried")" ] && echo "PASS  $latest_url/appcast-x64.xml is still the Intel feed" \
    || { echo "FAIL  $latest_url/appcast-x64.xml is still the Intel feed"; status=1; }
fi
if [ "$channel" = nightly ]; then
  for arch in "${arches[@]}"; do
    dmg="$(dmg_of "$arch")" url="$nightly_url/Ardia-Nightly$(suffix_of "$arch").dmg"
    size="$(curl -fsSLI --max-time 30 "$url" | awk 'tolower($1) == "content-length:" { n = $2 } END { print n + 0 }')"
    [ "$size" = "$(stat -f %z "$dmg")" ] && echo "PASS  $url is $version's DMG" \
      || { echo "FAIL  $url is $version's DMG (size $size, expected $(stat -f %z "$dmg"))"; status=1; }
  done
  to="$(curl -s -o /dev/null --max-time 15 -w '%{redirect_url}' https://ardia.dev/nightly || true)"
  [ "$to" = "$nightly_url/Ardia-Nightly.dmg" ] && echo "PASS  https://ardia.dev/nightly leads there" \
    || { echo "FAIL  https://ardia.dev/nightly leads there (goes to ${to:-nothing}: deploy the site, infra/site/nginx.conf)"; status=1; }
fi
tap "$version" || { echo "FAIL  the Homebrew tap's cask is $version"; status=1; }
exit $status

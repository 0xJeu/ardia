#!/usr/bin/env bash
# Puts Ardia's own Chromium code into the tree: engine/chromium/src mirrors paths under
# chromium/src, and each directory listed in `owned` is ours alone, so it is copied with --delete.
# The hook that makes Chromium build it is a patch in engine/patches (`series`:
# chromium-ardia-layer.patch links it into Chrome's framework for ArdiaCore). Every other file under
# src/ replaces Chromium's own (its logo, by Ardia's: docs/brand/ardia/build.py writes them). Idempotent;
# never touches args.gn.
#
# The convention, shared with engine/ardiacore: engine/<layer>/src mirrors the tree, engine/<layer>/apply.sh
# copies it in (`--check` exits 1 when the tree differs), and the repo copy is the only one to edit.
#
#   engine/chromium/apply.sh            copy
#   engine/chromium/apply.sh --check    exit 1 if the tree differs from the repo
#   engine/chromium/apply.sh --paths    the Chromium files it replaces, relative to chromium/src
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
src=${CHROMIUM_SRC:-$HOME/chromium-build/chromium_git/chromium/src}
owned=(chrome/browser/ardia)

# The files under src/ outside the owned directories.
replaced() {
  local prune=() dir
  for dir in "${owned[@]}"; do prune+=(-path "./$dir" -prune -o); done
  (cd "$here/src" && find . "${prune[@]}" -type f ! -name '.*' -print | sed 's|^\./||' | sort)
}
if [[ "${1:-}" == --paths ]]; then
  replaced
  exit 0
fi

for dir in "${owned[@]}"; do
  if [[ "${1:-}" == --check ]]; then
    diff -r "$here/src/$dir" "$src/$dir" >/dev/null || { echo "drift: $dir" >&2; exit 1; }
  else
    mkdir -p "$src/$dir"
    # Not -t: a copied file gets the time of the copy, so ninja always sees it as new (a repo file
    # older than the last gn run would otherwise never regenerate or recompile).
    rsync -rlp --delete --checksum "$here/src/$dir/" "$src/$dir/"
  fi
done

while IFS= read -r path; do
  [[ -f "$src/$path" ]] || { echo "error: $path isn't in the tree: src/ replaces Chromium's files, it adds none" >&2; exit 1; }
  if [[ "${1:-}" == --check ]]; then
    cmp -s "$here/src/$path" "$src/$path" || { echo "drift: $path" >&2; exit 1; }
  else
    # Only when it differs, and with the time of the copy, as above.
    cmp -s "$here/src/$path" "$src/$path" || cp "$here/src/$path" "$src/$path"
  fi
done < <(replaced)

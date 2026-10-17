#!/bin/sh
# Installs the ardia command, which controls a running Ardia from the terminal.
#
#   install.sh [--version V] [--uninstall]
#   install.sh -h | --help
#
# --version V   install that release (default: the latest release that ships the CLI).
# --uninstall   remove the installed CLI and its ardia link.
#
# Installs into ${ARDIA_CLI_HOME:-~/Library/Application Support/Ardia/CLI}/<version>, points its `current` link
# there and links ${ARDIA_CLI_BIN_DIR:-~/.local/bin}/ardia to current/bin/ardia. When the default bin dir isn't on
# the login shell's PATH, it adds one PATH line to ~/.zprofile (~/.bash_profile for bash), once.
# Re-running it upgrades: a version that is already current is left alone; a new one is staged in <version>.partial,
# renamed, and `current` is swapped atomically (a running ardia keeps its old dir). It keeps the current and the
# previous version and prunes the rest. Two runs never overlap (a lock in $ARDIA_CLI_HOME/.lock).
# The installed version is `basename "$(readlink "$ARDIA_CLI_HOME/current")"`.
# ARDIA_CLI_URL overrides the tarball URL (file:// works); its checksum is read from $ARDIA_CLI_URL.sha256.
#
# Prints one line per event: `step resolve|download|verify|install|link`, `version <v>`, `path <rc file>`,
# then `installed <bin path>` (or `uninstalled`), or `error <message>` and exits 1.
set -eu

repo=mantrakp04/ardia
asset_suffix=-macos-arm64.tar.gz
cli_home=${ARDIA_CLI_HOME:-$HOME/Library/Application Support/Ardia/CLI}
default_bin_dir=$HOME/.local/bin
bin_dir=${ARDIA_CLI_BIN_DIR:-$default_bin_dir}
version=
uninstall=0
work=
reported=0
locked=0

help() {
  awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"
  exit 0
}

fail() {
  reported=1
  printf 'error %s\n' "$*"
  exit 1
}

finish() {
  status=$?
  [ -n "$work" ] && rm -rf "$work"
  [ "$locked" -eq 1 ] && rm -rf "$cli_home/.lock"
  if [ "$status" -ne 0 ] && [ "$reported" -eq 0 ]; then
    printf 'error install stopped (exit %s)\n' "$status"
  fi
}
trap finish EXIT

while [ $# -gt 0 ]; do
  case $1 in
    --version) [ $# -ge 2 ] || fail "--version needs a value"; version=${2#v}; shift 2 ;;
    --version=*) version=${1#--version=}; version=${version#v}; shift ;;
    --uninstall) uninstall=1; shift ;;
    -h|--help) help ;;
    *) fail "unknown option: $1" ;;
  esac
done

fetch() {
  curl -fsSL --retry 2 --connect-timeout 15 "$@"
}

take_lock() {
  lock=$cli_home/.lock
  tries=0
  until mkdir "$lock" 2>/dev/null; do
    holder=$(cat "$lock/pid" 2>/dev/null || true)
    if [ -n "$holder" ] && ! kill -0 "$holder" 2>/dev/null; then
      rm -rf "$lock"
      continue
    fi
    tries=$((tries + 1))
    [ "$tries" -le 120 ] || fail "another install is still running (pid ${holder:-unknown})"
    sleep 1
  done
  printf '%s\n' "$$" >"$lock/pid"
  locked=1
}

link_bin() {
  target=$cli_home/current/bin/ardia
  [ -L "$bin_dir/ardia" ] && [ "$(readlink "$bin_dir/ardia")" = "$target" ] && return 0
  printf 'step link\n'
  mkdir -p "$bin_dir" || fail "couldn't create $bin_dir"
  if [ -e "$bin_dir/ardia" ] && ! [ -L "$bin_dir/ardia" ]; then
    fail "$bin_dir/ardia exists and isn't a link; move it away and run this again"
  fi
  ln -s "$target" "$work/ardia" || fail "couldn't create the ardia link"
  mv -fh "$work/ardia" "$bin_dir/ardia" || fail "couldn't link $bin_dir/ardia"
}

ardia_link_is_ours() {
  [ -L "$bin_dir/ardia" ] || return 1
  case $(readlink "$bin_dir/ardia") in
    "$cli_home"/*) return 0 ;;
  esac
  return 1
}

if [ "$uninstall" -eq 1 ]; then
  step=uninstall
  printf 'step %s\n' "$step"
  if ardia_link_is_ours; then
    rm -f "$bin_dir/ardia" || fail "couldn't remove $bin_dir/ardia"
  fi
  if [ -d "$cli_home" ]; then
    take_lock
    for entry in "$cli_home"/* "$cli_home"/.install.*; do
      [ -e "$entry" ] || [ -L "$entry" ] || continue
      [ "$entry" = "$cli_home/.lock" ] && continue
      rm -rf "$entry" || fail "couldn't remove $entry"
    done
  fi
  [ "$locked" -eq 1 ] && rm -rf "$cli_home/.lock" && locked=0
  rmdir "$cli_home" 2>/dev/null || true
  reported=1
  printf 'uninstalled\n'
  exit 0
fi

[ "$(uname -s)" = Darwin ] || fail "the ardia CLI runs on macOS only"
[ "$(uname -m)" = arm64 ] || fail "the ardia CLI needs an Apple silicon Mac"

printf 'step resolve\n'
if [ -n "${ARDIA_CLI_URL:-}" ]; then
  url=$ARDIA_CLI_URL
  if [ -z "$version" ]; then
    name=${url##*/}
    version=${name#ardia-cli-}
    version=${version%"$asset_suffix"}
    [ "$version" != "$name" ] || fail "can't read a version from $name"
  fi
elif [ -n "$version" ]; then
  url=https://github.com/$repo/releases/download/v$version/ardia-cli-$version$asset_suffix
else
  pattern="https://github\.com/$repo/releases/download/[^\"]*/ardia-cli-[^\"/]*-macos-arm64\.tar\.gz"
  url=$(fetch https://api.github.com/repos/$repo/releases/latest 2>/dev/null | grep -o "$pattern" | head -n 1 || true)
  if [ -z "$url" ]; then
    url=$(fetch "https://api.github.com/repos/$repo/releases?per_page=30" 2>/dev/null | grep -o "$pattern" | head -n 1 || true)
  fi
  [ -n "$url" ] || fail "no Ardia release ships the CLI yet (or GitHub is unreachable)"
  name=${url##*/}
  version=${name#ardia-cli-}
  version=${version%"$asset_suffix"}
fi
case $version in
  ''|*/*|.*) fail "bad version: $version" ;;
esac
printf 'version %s\n' "$version"

mkdir -p "$cli_home" || fail "couldn't create $cli_home"
take_lock
work=$(mktemp -d "$cli_home/.install.XXXXXX") || fail "couldn't create a temporary folder in $cli_home"

previous=$(readlink "$cli_home/current" 2>/dev/null || true)
if [ "$previous" = "$version" ] && [ -x "$cli_home/$version/bin/ardia" ]; then
  link_bin
  reported=1
  printf 'installed %s\n' "$bin_dir/ardia"
  exit 0
fi

printf 'step download\n'
fetch -o "$work/cli.tar.gz" "$url" 2>"$work/curl.err" || fail "download failed: $url ($(tail -n 1 "$work/curl.err"))"
expected=$(fetch "$url.sha256" 2>"$work/curl.err" | awk '{ print $1; exit }') || fail "checksum download failed: $url.sha256"

printf 'step verify\n'
case $expected in
  [0-9a-f]*) [ ${#expected} -eq 64 ] || fail "bad checksum file: $url.sha256" ;;
  *) fail "bad checksum file: $url.sha256" ;;
esac
actual=$(shasum -a 256 "$work/cli.tar.gz" | awk '{ print $1 }')
[ "$actual" = "$expected" ] || fail "checksum mismatch: expected $expected, got $actual"

printf 'step install\n'
staged=$cli_home/$version.partial
dest=$cli_home/$version
rm -rf "$staged"
mkdir "$staged" && tar -xzf "$work/cli.tar.gz" -C "$staged" --strip-components 1 "ardia-cli-$version" \
  || fail "couldn't extract ardia-cli-$version from the tarball"
[ -x "$staged/bin/ardia" ] || fail "the tarball has no ardia-cli-$version/bin/ardia"
xattr -dr com.apple.quarantine "$staged" 2>/dev/null || true
"$staged/bin/ardia" --version >"$work/check.out" 2>&1 || fail "the downloaded ardia doesn't run: $(tail -n 1 "$work/check.out")"
if [ -e "$dest" ]; then
  mv "$dest" "$work/replaced" || fail "couldn't replace $dest"
fi
mv "$staged" "$dest" || fail "couldn't move the CLI into $dest"
ln -s "$version" "$work/current" || fail "couldn't create the current link"
mv -fh "$work/current" "$cli_home/current" || fail "couldn't switch $cli_home/current"
for entry in "$cli_home"/*; do
  case ${entry##*/} in
    current|"$version"|"$previous") continue ;;
  esac
  if [ -d "$entry" ] && { [ -x "$entry/bin/ardia" ] || [ "${entry%.partial}" != "$entry" ]; }; then
    rm -rf "$entry"
  fi
done

link_bin

if [ "$bin_dir" = "$default_bin_dir" ]; then
  login_shell=$(dscl . -read "/Users/$(id -un)" UserShell 2>/dev/null | awk '{ print $2 }')
  [ -x "${login_shell:-}" ] || login_shell=${SHELL:-/bin/zsh}
  login_path=$(env -i HOME="$HOME" USER="$(id -un)" LOGNAME="$(id -un)" TERM=dumb "$login_shell" -l -c 'printf "%s" "$PATH"' </dev/null 2>/dev/null || true)
  case :$login_path: in
    *:"$bin_dir":*|*:"$bin_dir/":*) ;;
    *)
      case ${login_shell##*/} in
        bash) rc=$HOME/.bash_profile ;;
        *) rc=$HOME/.zprofile ;;
      esac
      line='export PATH="$HOME/.local/bin:$PATH"'
      if ! [ -f "$rc" ] || ! grep -qxF "$line" "$rc"; then
        if [ -s "$rc" ] && [ -n "$(tail -c 1 "$rc")" ]; then
          printf '\n' >>"$rc" || fail "couldn't write $rc"
        fi
        printf '%s\n' "$line" >>"$rc" || fail "couldn't write $rc"
        printf 'path %s\n' "$rc"
      fi
      ;;
  esac
fi

reported=1
printf 'installed %s\n' "$bin_dir/ardia"

# The `ardia` command

`ardia` drives a running Ardia from the terminal with Python and [pydoll](https://pydoll.tech) 3.0. It's a separate
download, not part of the app bundle. The app ships `install.sh`, and runs it when the user opts in during onboarding
or in Settings ("Let the ardia command control Ardia").

Code: `apps/cli` (`ardia_cli`, `install.sh`, `scripts/build.sh`). Dependencies are pinned with hashes in
`apps/cli/requirements.lock` (regenerate with `uv pip compile requirements.in --python-version 3.13
--python-platform aarch64-apple-darwin --generate-hashes --no-annotate --no-header -o requirements.lock`, then copy
the pins into `pyproject.toml`).

## Commands

- `ardia exec [CODE | -] [-f FILE] [--data-dir DIR] [--port N] [--ws URL] [--timeout S] [--json]` runs Python with
  top-level `await`. In scope: `browser` (pydoll `Chrome`), `tab` (the user's tab: visible and focused, else visible,
  else the first), `tabs` (http, https, file and about pages), `new_tab(url, background=True)`, `js(expression, tab=None)`,
  `By`, `Key`, `asyncio`, pydoll's exports and its common exceptions. It prints the last expression's value. Exit 0
  done, 1 the code raised or timed out (default 300 s), 2 Ardia can't be reached, 130 interrupted.
- `ardia skills install --target general|codex|claude-code|cursor|opencode [--target …] [--project]` installs the
  agent skill (`ardia_cli/skill`: `SKILL.md` and `references/pydoll.md`) into `~/.agents/skills` (general, codex),
  `~/.claude/skills`, `~/.cursor/skills` or `~/.config/opencode/skills`; with `--project`, into `./.agents/skills`,
  `./.claude/skills`, `./.cursor/skills` or `./.opencode/skills`. It replaces only its own `ardia` folder.
- `ardia --version`, `ardia --help`, `ardia exec --help`.

`exec` never quits Ardia: it refuses `browser.stop()`, `Browser.close` and `Browser.crash`, and on exit (normal, an
exception or Ctrl-C) it closes only its own page and browser WebSockets.

## How it finds Ardia

1. `--ws URL`, a browser WebSocket URL.
2. `--port N`, a plain DevTools server on 127.0.0.1 (`/json/version`). For test servers only.
3. `$ARDIA_CDP_URL`, like `--ws`.
4. `<data dir>/Chromium/ArdiaControl.json`, with `--data-dir` or `$ARDIA_DATA_DIR`, else the installed app's
   `~/Library/Application Support/com.ardia.browser/Chromium/ArdiaControl.json`.

The app writes `ArdiaControl.json` when the setting is on:
`{"port":P,"browser":"/devtools/browser/<guid>","token":"…","pid":…,"generation":N}`. The CLI opens it without
following links and trusts it only when it's a regular file the user owns, mode 0600, and `pid` is alive. It connects
to `ws://127.0.0.1:P<browser>?token=<token>`; pydoll keeps the query on every `/devtools/page/<id>` URL, so page
sockets carry the token too. A missing, stale or unsafe file, or a refused connection, prints one line and exits 2:
`Ardia isn't running, or "Let the ardia command control Ardia" is off in Settings.` There's no port scanning and no
`/json` fallback on this path. The token never reaches the output: stdout, stderr, log records and tracebacks are
redacted, and pydoll's loggers stay at WARNING.

## Install and upgrade

`install.sh [--version V] [--sha256 DIGEST] [--uninstall]` (run with `/bin/sh`; `--help`):

- Downloads `https://github.com/mantrakp04/ardia/releases/download/v<V>/ardia-cli-<V>-macos-arm64.tar.gz` (https only)
  into a private temp dir. Without `--version` it takes the latest release that has the asset. `--sha256` is the only
  digest it trusts when given (the app passes `Ardia.app/Contents/Resources/ardia-cli.sha256`); otherwise it reads the
  `.sha256` asset.
- Verifies the digest, refuses entries outside `ardia-cli-<V>/`, `..` paths, hard links and links pointing outside the
  tree, extracts to `$ARDIA_CLI_HOME/<V>.partial`, renames it to `<V>`, and swaps `current` atomically. A running
  `ardia` keeps its old dir. It keeps the current and the previous version.
- Links `$ARDIA_CLI_BIN_DIR/ardia` (default `~/.local/bin`) to `current/bin/ardia`. It replaces only a link that
  already points into `$ARDIA_CLI_HOME` and refuses anything else. With the default bin dir off the login shell's
  PATH, it adds `export PATH="$HOME/.local/bin:$PATH"` to `~/.zprofile` once.
- A version that is already current is a no-op. A lock (`$ARDIA_CLI_HOME/.lock`) keeps two runs apart.
- Output for the app, one line each: `step resolve|download|verify|install|link`, `version <v>`, `path <rc file>`,
  then `installed <bin path>` or `uninstalled`, or `error <message>` with exit 1.

`$ARDIA_CLI_HOME` defaults to `~/Library/Application Support/Ardia/CLI`. The installed version is
`basename "$(readlink "$ARDIA_CLI_HOME/current")"`; the app reads that link to decide whether to upgrade, and after an
app update it runs `install.sh --version <app version> --sha256 <pinned digest>` in the background. The CLI never
updates itself.

## Build and release

`apps/cli/scripts/build.sh <version> <out dir>` writes `ardia-cli-<version>-macos-arm64.tar.gz` and its `.sha256`:
python-build-standalone CPython 3.13 (release and sha256 pinned in the script), the locked dependencies and
`ardia_cli` in its site-packages, pruned of tests, idlelib, Tk, ensurepip, the unused libpython dylib and
`__pycache__`, plus `bin/ardia`, an sh launcher that resolves its links and runs `python3 -I -m ardia_cli`. About
14 MB; 41 MB installed. `ardia --version` takes about 10 ms; the first `exec` about 1 s while Python writes its
bytecode cache, later ones about 0.15 s.

`scripts/release.sh` builds it into the release's dist dir after the export and writes its digest to
`Ardia.app/Contents/Resources/ardia-cli.sha256` before the app is signed. `publish-nightly.sh` and the stable
`gh release create` in the release skill upload the tarball and its `.sha256`.

## Test

Never against the real home. A hidden instance's plain DevTools port works with `--port`:

```sh
scripts/agent/ac launch <Ardia.app> --data /tmp/ardia-cli-test --onboarded
ardia exec --port <port> 't = await new_tab("https://example.com"); await t.title()'
scripts/agent/ac quit /tmp/ardia-cli-test
```

The `ArdiaControl.json` path needs the app's token server: Chrome's plain server accepts `?token=` on the browser
socket but answers 500 on page sockets with a query. For the installer:

```sh
apps/cli/scripts/build.sh 0.0.1 /tmp/ardia-cli-out
HOME=/tmp/ardia-cli-home ARDIA_CLI_URL=file:///tmp/ardia-cli-out/ardia-cli-0.0.1-macos-arm64.tar.gz \
  /bin/sh apps/cli/install.sh
HOME=/tmp/ardia-cli-home ardia skills install --target claude-code
```

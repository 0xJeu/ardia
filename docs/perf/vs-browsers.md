# Ardia against Dia, Helium and Chrome

A cross-browser benchmark for ardia.dev on the release gate's rows (docs/perf/0.2.36-to-0.2.37.md) that can be
measured the same way in any Chromium browser. Harness: `apps/browser/scripts/perf/xbench.mjs` (`--help`).

**Status (2026-10-16): no competitor numbers yet.** The harness runs, its Ardia numbers match native-bench's, and
the size rows are in. The quick check, run gated while the owner was away, hit the brief's stop conditions for all
three competitors (below), so no timing round has run. `apps/site/src/data/bench.json` isn't written until one does.

## Method

- **One harness, from outside the app.** Each browser is launched with `open -g -n` and driven over CDP:
  `Target.createTarget`, `Target.activateTarget`, `Target.closeTarget`, `Browser.getWindowForTarget`,
  `Runtime.evaluate`. The test pages report their own paint timing. Memory, CPU and wakeups come from
  `proc_pid_rusage` (acperf) over every process of the instance: the app's process tree plus anything running
  from inside its bundle (reported as `outside:<name>`).
- **The same pages for all.** They are native-bench's static page (a grid of 60 boxes, 120 paragraphs, a 1 s timer,
  paint and visibility marks), served from 127.0.0.1 on a fixed port (9462). There are no network-dependent rows.
- **The same profile state.** A template profile is made once per browser: one launch, the test page opened over CDP,
  every other page closed, 90 s to settle (component downloads, filter lists, first-run work), quit. Every run
  starts from its own APFS clone of that template.
  - All four restore the same one-tab session. Ardia and Dia restore by default; Chrome and Helium get
    `--restore-last-session`, which is their "Continue where you left off".
  - Ardia's template session has its blank tab dropped, so it has the one tab like the others, and its window frame
    set to the same 1280×800.
- **The same flags.**
  - Every instance: HOME and CFFIXED_USER_HOME point into its run folder, so nothing reaches the real
    `~/Library` except what goes through cfprefsd (see Dia). It also gets Ardia's background-mode switches
    `--disable-backgrounding-occluded-windows --mute-audio`, plus `--no-first-run --no-default-browser-check
    --password-store=basic`.
  - Chromium competitors also get `--user-data-dir --remote-debugging-port --remote-allow-origins=* --use-mock-keychain
    --window-size=1280,800 --window-position=40,80`.
  - Ardia gets `ARDIA_BACKGROUND=1`, `ARDIA_DATA_DIR`, `ARDIA_REMOTE_DEBUGGING_PORT`, onboarding marked done (its
    `--no-first-run`), `ARDIA_UPDATE_FEED_URL` at the local server (no update), and `-NSAppSleepDisabled YES`,
    as in native-bench. Its windows sit behind the owner's, so App Nap would otherwise apply; the competitors'
    windows are in front.
  - Default settings otherwise; built-in ad blockers stay as shipped. Chrome runs without
    `--disable-background-networking`/`--disable-component-update`: those remove background work Chrome really
    does, and its updater stays inside the run's HOME.
- **Interleaved.** A round is every launch (link, then restore), then every session, browser by browser, with the order
  rotated each round. Items run one at a time under the perflab lock, with 3 s between items.
- **Only while the owner is away.** Every item waits until the screen is locked, or there has been no input for 10
  minutes. A watcher reads HIDIdleTime 4 times a second; the moment input comes, the item is thrown away, its browser
  quit, and it reruns later. A browser that becomes the frontmost app stops the run (`--allow-focus` records it
  instead, for an A/B only). So does a copy whose version changed (it updated itself).
- **Resumable.** Results append to `<out>/samples.jsonl` and a rerun skips finished items. `report` writes
  bench.json and the table.

### Rows

| Row | How |
|---|---|
| Cold launch → page painted (link opened from another app) | `open -a <app> <url>` with the browser closed → that page's first-contentful-paint, from just before `open` |
| Cold launch → window on screen | the pid's first on-screen window ≥ 300×200 with alpha > 0 (CGWindowList) |
| Cold launch → restored tab painted | `open -a <app>` → the restored page's FCP (native-bench's "launch → first page painted") |
| New tab → first paint | `Target.createTarget(url)` → FCP, median of 5 per session |
| Tab switch → shown | `Target.activateTarget` → visibilitychange to visible + 2 rAFs, median of 16 among 20 tabs |
| New window → first paint | `Target.createTarget(url, newWindow: true)` → FCP, counted only if a new window opened |
| Memory, 1 / 10 / 20 tabs, back to 1 | phys_footprint summed over every process (1 tab 30 s after launch, 10 tabs +10 s, 20 tabs +15 s, closed +30 s) |
| Idle CPU, idle wakeups/s, 1 and 20 tabs | rusage deltas over 60 s, every process |
| Download (DMG), app on disk | the vendor's DMG for that version; `du` of the bundle |

A row is a win when the ranges don't overlap. Ranges that overlap with a better median elsewhere get a diagnosis
here, as do losses.

### Results shape (`bench.json`, written by `report`)

```json
{
  "date": "YYYY-MM-DD",
  "machine": { "model": "MacBook Pro (Mac17,9)", "chip": "Apple M5 Pro", "cores": 15, "ram": "48 GB", "macOS": "27.2 (26B5112a)" },
  "browsers": { "ardia": { "name": "Ardia", "version": "0.2.37", "chromium": "154.0.8037.97" }, "dia": {}, "helium": {}, "chrome": {} },
  "rows": [
    { "id": "newtab", "label": "New tab → first paint", "unit": "ms", "lowerIsBetter": true, "best": "ardia",
      "browsers": { "ardia": { "name": "Ardia", "version": "0.2.37", "chromium": "154.0.8037.97", "median": 79.2, "min": 77.5, "max": 80.9, "n": 2 } } }
  ],
  "method": "docs/perf/vs-browsers.md",
  "notes": ["…"]
}
```

Row ids are `launch-link`, `launch-window`, `launch-restore`, `newtab`, `switch`, `newwindow`, `memory-1`, `memory-10`,
`memory-20`, `memory-closed`, `idle-cpu-1`, `idle-cpu-20`, `idle-wakeups-1`, `idle-wakeups-20`, `download` and
`on-disk`. A browser that can't be measured on a row has `median: null` and a `note`.

## Machine and versions

MacBook Pro (Mac17,9), Apple M5 Pro, 15 cores, 48 GB, macOS 27.2 (26B5112a), built-in display (1512×982 points).
The display is kept awake by a standing `caffeinate -dims`.

| Browser | Version | Chromium | Copy |
|---|---|---|---|
| Ardia | 0.2.37 (stable, notarized) | 154.0.8037.97 | clone of `dist/0.2.37/export/Ardia.app` |
| Dia | 1.52.0 (88431) | 155.0.8059.40 (ArcCore) | clone of `/Applications/Dia.app` (deleted after it updated itself, below) |
| Helium | 0.19.2.1 | 155.0.8059.39 | clone of `/Applications/Helium.app` |
| Google Chrome | 155.0.8059.85, universal | 155.0.8059.85 | from `dl.google.com/chrome/mac/universal/stable/GGRO/googlechrome.dmg`, Developer ID Google LLC (EQHXZ8M8AV), notarized, `codesign --verify --deep --strict` valid once the DMG's FinderInfo xattrs were removed |

Ardia is a Chromium milestone behind the other three.

## Size (static, measured)

| | Ardia 0.2.37 | Dia 1.52.0 | Helium 0.19.2.1 | Chrome 155 |
|---|---|---|---|---|
| Download (DMG) | 187.1 MB | 855.7 MB | 114.7 MB (arm64) | 276.0 MB (universal) |
| App on disk | 446.2 MB | 1413.8 MB | 354.7 MB | 757.7 MB (universal) |

The DMGs are the vendors' own: `Dia-1.52.0-88431.dmg` from releases.diabrowser.com (1.53.0, 853.6 MB, is
current), Helium's GitHub release asset, Google's universal DMG, and `dist/0.2.37/Ardia-0.2.37.dmg`. Google
serves Mac users only the universal build.

**Ardia loses both size rows to Helium** (+72 MB download, +91 MB on disk). Both are arm64-only, and the difference is:

- `Resources/Extensions/ublock-lite`: 34.6 MB of uBlock Origin Lite rulesets. Helium has no unpacked extension in its
  bundle; its uBlock Origin is fetched or packed elsewhere.
- Chrome's framework binary: 265.1 MB against Helium's 241.2 MB (+24 MB). It's a different build config and patch
  series, and Ardia is still on 154. Framework resources are 88.7 against 81.9 MB.
- React Native: 9.1 MB main executable, 4.6 MB hermes.framework, 3.9 MB JS bundle, 4.6 MB `Assets.car`, 4.6 MB
  `assets`.

To win: ship uBlock Lite's rulesets compressed or fetched on first run, and compare the framework's GN args and
symbol stripping with Helium's (`docs/perf/launch-critical-path.md` already found 175 MB of symbols once).

## Ardia: the harness against native-bench (cross-check)

Same app (`dist/0.2.37/export/Ardia.app`), same machine and day, owner at work. native-bench ran with
`--only launch,session --launch-runs 6 --runs 2` and 0.2.37's bench bundle (`dist/0.2.36/bench/main.jsbundle`, API 9).
xbench ran with `--browsers ardia --gate off`.

| Row | xbench | native-bench |
|---|---|---|
| launch → window on screen | 372 ms (365–386, n=4); 363 (328–431, n=6) | 484 ms (417–536, n=6) |
| launch → restored tab painted | 505 ms (484–530, n=4); 520 (476–605, n=6) | 561 ms (506–660, n=6) |
| launch → page painted (link) | 596 ms (535–699, n=6) | – |
| new tab → first paint | 79 ms (78–81, n=2) | 100 ms (91–109, n=2) |
| tab switch → shown | 40 ms (40–40, n=2) | 31 ms (27–35, n=2) |
| memory 1 / 10 / 20 tabs / back to 1 | 275 / 765 / 1187 / 363 MB | 284 / 761 / 1184 / 362 MB |
| idle CPU, 1 tab / 20 tabs | 0.17 % / 1.35 % | 0.16 % / 1.17 % |
| idle wakeups, 1 tab / 20 tabs | 6.7 / 29.0 /s | 6.7 / 29.1 /s |
| new window → first paint | not measurable (below) | 111 ms (107–116, n=2) |

Memory, idle CPU and wakeups agree within run-to-run noise: the same processes are measured the same way. The gaps
come from the paths, not the measurement:

- **Launch, about 100 ms faster in xbench.** xbench runs the notarized copy as shipped. native-bench runs a re-signed
  copy that loads `acmark.dylib` through `DYLD_INSERT_LIBRARIES` (library validation off) and its own bench bundle.
  The website row should use xbench's number, the one measured the same way as the others.
- **New tab, 21 ms faster in xbench.** `Target.createTarget` makes the WebContents and starts the navigation in
  Chrome first; Ardia's JS adopts the tab after. The store's `newTab` that native-bench calls goes JS → native →
  engine before anything loads.
- **Tab switch, 9 ms slower in xbench.** `Target.activateTarget` activates the tab in Chrome's tab strip. Ardia's
  JS hears it from the strip mirror (`lib/chromeTabs.ts`), updates the store and shows the page. native-bench calls
  the store's `switchToTab` directly.
- **The 20-tab idle row needs the test page's 1 s timer.** Without it (the first xbench version) renderer wakeups
  were 12/s instead of 23/s.

### New window: Ardia doesn't open one over CDP

`Target.createTarget({ newWindow: true })` gives Ardia a new normal Chrome `Browser`.
`ArdiaCoreHost.mm -engineWindowForNewBrowserOfProfile:type:` hosts it in a stray `ArdiaCoreWindow`
(`ArdiaCoreChromeWindow.mm +strayWindowForProfile:`), but the tab ends up in the existing main window:
`Browser.getWindowForTarget` returns the main window's id, and CGWindowList shows no new window. The same path
serves an extension's `chrome.windows.create`, so this is a parity bug, not a harness gap. The harness asks every
browser the same question. Once Ardia opens a window there, the row fills in with no change to xbench, which
counts a new window when the target's window id differs from the restored tab's.

### With the screen locked

Paint timing over CDP still works with the screen locked; display-link frames weren't throttled on this macOS.
Ardia, one gated round while the owner had locked the screen: restored tab painted 494 ms (483–504, n=3), new tab
80 ms, switch 39 ms, idle 0.17 % / 6.5 per s at 1 tab and 1.43 % / 29.5 per s at 20 tabs, memory
274 / 769 / 1191 / 374 MB, 0 samples left out. That matches the unlocked runs. CGWindowList still reports the
windows, so "window on screen" works too. Locked periods count as away for the gate.

## The competitors' quick check (2026-10-16, 10:57, owner away)

`xbench.mjs check` launches each browser once from a fresh scratch dir and reports what it honoured.

| | Chrome 155.0.8059.85 | Helium 0.19.2.1 | Dia 1.52.0 |
|---|---|---|---|
| CDP on the given port | yes | yes | yes (Chrome/155.0.8059.40) |
| became the frontmost app at launch | **yes**, despite `open -g` | **yes** | no |
| profile in `--user-data-dir` | yes | yes | **no**: `Application Support`, `Caches`, `HTTPStorages` under the scratch HOME's Library |
| onboarding | skipped (`--no-first-run`) | skipped | **an Atlassian sign-up page** (`id.atlassian.com/signup?application=dia--mac`): needs an account |
| real `~/Library` touched | no | no | **its defaults domain** `company.thebrowser.dia.plist` (cfprefsd ignores CFFIXED_USER_HOME; only its mtime was checked, never its contents) |
| self-update | none seen | none seen | **Sparkle updated the copy to 1.53.0 within the check** (about a minute) |
| new launchd jobs | none | none | none |

All three hit the brief's stop conditions. The check quit them, the Dia copy (now 1.53.0) was deleted,
`/Applications/Dia.app` is untouched at 1.52.0, and the copies were unregistered from LaunchServices.

### What it takes to run them (owner's call)

- **Chrome and Helium: background-only copies.** `xbench.mjs prepare-bg --browsers chrome,helium` makes
  `/tmp/ac-xbench/apps/{chrome,helium}-bg/`: the copy with `LSBackgroundOnly` set and signed ad hoc without the
  restricted entitlements (application-identifier, associated domains, passkeys: none matter with a mock keychain)
  and without the hardened runtime. That is the activation-prohibited state Ardia's test instances run in
  (`ARDIA_BACKGROUND`), so it can't take focus and the comparison is closer, not further. Both start (`--version`
  runs, so AMFI and dyld accept them); a full launch hasn't been tried. If Chrome's helpers check the browser's
  signature, a `--deep` ad hoc re-sign is the fallback.
- **The A/B that shows background-only changes nothing.** This one needs the owner's OK for normal Chrome to take
  focus once per launch while they're away. Run one interleaved round of both, all rows:
  `xbench.mjs run --out <dir> --browsers chrome,chrome-bg --rounds 2 --launches 3 --allow-focus`.
  Accept background-only when every row's ranges overlap. Idle CPU and wakeups are the rows to watch: a background-only
  app could be scheduled differently. Then measure with `--browsers ardia,dia,helium-bg,chrome-bg`.
- **Dia: an account.** It can't get past onboarding without one. The brief says not to work around it with the
  real profile. Dia's own switches `--onboarding-force-complete` / `--onboarding-skip-wizard` exist in its binary and
  weren't tried: whether they're fair to use is the owner's call. A Dia run also needs two things:
  - a read-only copy (`chmod -R a-w`), so Sparkle can't replace it mid-run;
  - acceptance that it writes the real `company.thebrowser.dia.plist`. Nothing short of re-signing it with a new bundle
    id avoids that, and re-signing drops its keychain entitlement, which its sign-in needs.

## Running it

```sh
OUT=/tmp/ac-xbench/out
node apps/browser/scripts/perf/xbench.mjs check --out $OUT --browsers chrome-bg,helium-bg     # owner away; quick look
node apps/browser/scripts/perf/xbench.mjs run --out $OUT --deadline 100                       # run_in_background; rerun to resume
node apps/browser/scripts/perf/xbench.mjs report --out $OUT --json apps/site/src/data/bench.json --md $OUT/table.md
node apps/browser/scripts/perf/xbench.mjs clean --out $OUT                                    # quit leftovers, unregister copies
```

A full run of four browsers, 3 rounds, 2 launches of each kind and a session per round, takes about 75 minutes of
away time. Every interruption costs only the item in progress.

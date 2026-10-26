# Conventions

How Ardia's code is laid out and written. `apps/browser/src/conventions.test.mjs` enforces most of it (see
[The check](#the-check)); the rest is on review.

## Backwards compatibility: migrations only

The app and its engine ship together (a release bundles its engine; a dev build fetches the prebuilt engine matching
its commit's `engine/` tree), so code never tolerates a mismatched engine.

- No `respondsToSelector` guards for ArdiaCore's API, no optional `?.()` native calls, no always-true `isAvailable`
  checks, no metadata probes, no aliases for old names, no duplicate overloads. Keep `respondsToSelector` only for
  private AppKit or Chromium classes looked up at runtime.
- What stays: versioned on-disk data migrations (Netnyahoo → Ardia included), the versioned sync payload (a nightly Mac
  syncs with a stable Mac a version behind), and the one app/engine version assertion: `NATIVE_API_VERSION` and
  `apiVersion` in `packages/shell/ios/AppModule.swift`. Bump both when the native surface changes.

## Folders and import direction (`apps/browser/src`)

```
App.tsx, main.tsx       entry points
components/ui/          design system: pieces, tokens, motion, wrapped native views
components/<feature>/   sidebar, tabstrip, omnibox, downloads, settings, import, onboarding, …
state/<domain>/         tabs, windows, profiles, bookmarks, history, downloads, settings, engines, extensions, sync, …
platform/               the only code that calls native modules
lib/                    pure helpers: url, time, keys
```

| From | May import |
| --- | --- |
| `components/<feature>` | `components/*`, `state`, `platform`, `lib` |
| `components/ui` | `components/ui`, `lib` |
| `state` | `state`, `platform`, `lib` |
| `platform` | `platform`, `lib` |
| `lib` | `lib` (nothing else in the app) |

- Only `platform/` imports native packages (`@ardia/ardiacore`, `@ardia/shell`, `@ardia/shaders`, `@ardia/import`,
  `@ardia/sync`), `expo-modules-core` or `NativeModules`. `components/ui/` may import native *views* to wrap them.
- Components never call native functions; they call actions in `state/`.
- Nothing lives outside these folders except the entry points.

## UI

- **Values come from tokens.** `components/ui/tokens.ts` holds the colour roles (light and dark), spacing scale,
  radii, type, shadow levels; `components/ui/motion.ts` holds the motion presets (named curves and the one spring
  converter). A Dia-measured value used in one place is a named constant in its feature's `tokens.ts`.
- No hex, `rgb()`/`rgba()`/`hsl()` literals, `Easing.` curves or numeric animation durations outside files named
  `tokens.ts` or `motion.ts`.
- **Screens are built from `components/ui/` pieces:** Box, Text, Button (icon, text, pill and close variants),
  Popover, Dialog, Row, Field, Switch, Radio, Menu, with token props (`pad="m" fill="panel" radius="l"`). Native views
  (Surface, Symbol, the web view, …) are wrapped there too. Feature code passes `style` only for layout (flex,
  position, size) and animated values.
- One copy of each piece. Before writing a button, panel, closing animation or `hostOf`, use the one in
  `components/ui/` or `lib/`.

## State

- Hover, pressed and open state of one component stays in that component's `useState`.
- Anything two components share, or anything saved to disk, lives in `state/<domain>/`: the store slice, its `useX()`
  selector hooks, its actions, and the effects that keep it in sync with the engine.
- Components read through `useX()` hooks and write through actions. Never `getState()` in a component.
- One way to create a store. Saved data has versioned migrations.

## Files

- Components are `PascalCase.tsx`; every other module is `camelCase.ts`. Tests sit next to the code as
  `camelCase.test.mjs` (or `PascalCase.test.mjs` for a component).
- At most 400 lines per TS/TSX file (`apps/browser/src`, `packages/*/src`), 600 per native file (`packages/*/ios`,
  `engine/ardiacore/src`, `engine/chromium/src`). Tests, fixtures and generated files (`packages/core/src/bangList.ts`)
  are exempt, and so is `packages/ardiacore/ios/page_script.js`: it is injected as one closure into every frame, and its
  helpers share builtins captured before page code runs, so splitting it would need a bundling step.
- One type per native file, named after it.
- No comments (AGENTS.md › Hard rules), including comments inside injected page JS and shader source held in strings.
  Allowed: license headers, shebangs and tool directives (`@ts-expect-error`, `eslint-disable`, `#pragma`,
  `swiftlint:`, `nogncheck`, `NOLINT`).

## Names

- App-side ObjC classes and their files are `Ardia<Thing>`; Swift types use plain names (the module namespaces them).
- The engine's exported ObjC API is `ArdiaCore*`; engine C/C++ is `ac_*`.
- No `Cef*`/`CEF`/`cef` names, no `AC*` or app-side `ArdiaCore*` classes in `packages/*/ios`.
- No `Netnyahoo` or `NN*` names outside migration code (`LegacyMigration.swift`, `legacy.ts`, `*Migration.swift`,
  `*migrations.ts`).

## Translation layer (JS ↔ Expo modules ↔ ArdiaCore ↔ `ac_*`)

- **One way to call the engine:** `engine.call("downloads.pause", args)`, typed from one table
  (`packages/ardiacore/src/engine/api.ts`); native dispatches by name to the matching `ac_*` call. Only secrets
  (`callWithSecret`) and views get dedicated functions.
- **One error model:** everything rejects with `{code, message}`; JS throws `ArdiaError` with the code. The bridge
  never falls back silently; callers decide.
- **One event channel per module.** Event names are `domain.event`; payloads are parsed once.
- **IDs at the API surface** are `tabId` (the app's string), `windowId` and `profileId`. Browser ids, transfer keys,
  adopt ids and Chrome's int tab ids stay internal, resolved by one native registry. Per-tab operations live on the
  tab's API.
- **One `PageEngine` protocol** for the Chromium and WebKit page engines: same method names, one event table.
- **One Expo module per domain** (`ArdiaTabs`, `ArdiaDownloads`, `ArdiaExtensions`, `ArdiaProfiles`,
  `ArdiaPermissions`, `ArdiaWindows`, `ArdiaMenus`, `ArdiaSystem`, …), each in `<Domain>Module.swift`, registered as
  `Ardia<Domain>`.
- ArdiaShell links ArdiaCore directly and calls it with types: no selector strings or string notifications between
  them.
- **One authority per rule:** the engine's off-the-record flag alone decides private profiles; one helper builds
  profile directory names.

## Environment variables

Read once, in one place: `ArdiaLaunchConfig` (`packages/ardiacore/ios`) reads the environment at start and JS gets it
from `platform/launchConfig.ts`. No `getenv`, `ProcessInfo…environment`, `base::Environment` or `process.env` anywhere
else in app or engine code (scripts and tests outside the app runtime are free to). The engine reads command-line
switches, never the environment: the app passes `--ardia-test=<list>`, `--ardia-trace=<list>`,
`--ardia-switches=<list>` and `--ardia-<instance key>=<value>` to `ChromeMain`.

| Variable | Value | What it does |
| --- | --- | --- |
| `ARDIA_DATA_DIR` | path | The instance's data directory |
| `ARDIA_BACKGROUND` | `1` | Hidden instance: never activates, windows sit behind the owner's |
| `ARDIA_REMOTE_DEBUGGING_PORT` | port | CDP port |
| `ARDIA_INSTANCE` | `key=value,…` | The few other instance settings (downloads dir, update feed, extra Chromium switches, …) |
| `ARDIA_SWITCHES` | `name=on,…` | The only feature toggle, backed by the kill-switch registry `lib/killSwitches.ts` (owner and `removeBy` per switch, at most 8) |
| `ARDIA_TRACE` | `pip,visibility,…` | Trace logging per area |
| `ARDIA_TEST` | `keychain=file,reauth=granted,…` | All test fakes and fixtures |

- `ARDIA_TEST` and `ARDIA_TRACE` work only in a test instance (not signed for distribution, a scratch data dir, the
  mock keychain); a release build ignores them and logs that once. CDP, argv and extra switches reach Chrome only with
  the mock keychain.
- An experiment ends by keeping the winning path and deleting the other branch and its toggle. One still being tried
  is a kill switch in the registry, not a new variable.

## The check

`apps/browser/src/conventions.test.mjs` runs in `pnpm -C apps/browser test` and checks, per file:

| Rule | What it counts |
| --- | --- |
| `layout` | an app file outside the folders above |
| `imports` | an import against the direction table, or into a file outside the folders |
| `native-calls` | a native package, `expo-modules-core` or `NativeModules` used outside `platform/` and `components/ui/` |
| `tokens` | a colour literal, `Easing.` curve or numeric duration outside `tokens.ts`/`motion.ts` |
| `get-state` | `getState(` in `components/` |
| `size` | a file over its line cap |
| `env` | an environment read outside the launch config |
| `naming` | a `Cef`, `AC*`/app-side `ArdiaCore*`, `Netnyahoo` or `NN*` name |
| `comments` | a comment that isn't a license header or tool directive |
| `file-names` | a file name breaking the PascalCase/camelCase rule |

`apps/browser/src/conventions-baseline.json` lists the violations that existed when the rules arrived, as
`rule → file → count`. It is a ratchet: the test fails on any violation beyond the baseline, and on any baseline entry
higher than what the file has now, so fixes must lower their entries.

- `node apps/browser/src/conventions.test.mjs --report` prints every violation grouped per rule, and the difference
  from the baseline (`--from-head` to scan HEAD instead of the working tree).
- To update the baseline, stage your own hunks, then run
  `node apps/browser/src/conventions.test.mjs --write-baseline` (it scans the git index, so unstaged work stays out;
  check `git diff --cached --stat` lists only your files first, or use `--from-head` to scan HEAD) and commit the baseline with your change. It refuses to write when a rule's
  total grows. The one allowed growth: `imports` may grow while `layout` shrinks, because a file moved out of the old
  layout starts having its imports checked. Moving or renaming a file moves its entries under the new path.
- Never add violations to the baseline by hand. `--force` overrides the refusal and needs the owner's OK.

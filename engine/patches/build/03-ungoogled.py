#!/usr/bin/env python3
"""Step 3: apply ungoogled-chromium's patch series ($UNGOOGLED_TAG, macOS $UNGOOGLED_MACOS_TAG in
env.sh; check those tags out in ~/chromium-build/ungoogled{,-macos} first) to a fresh Chromium
checkout.

Reproduces the patch set this build ships (logs/ungoogled-patches.tsv; the
Ardia repo's docs/engine-build.md explains each exception). The exceptions
first made for CEF are kept as the CEF-era build had them (a behaviour decision
for later, not a build need any more):
  - SKIP: not applied, with the reason;
  - PARTIAL_EXCLUDE: applied without the listed files (git apply --exclude);
  - FIXUPS: small edits after the series;
  - everything else: `git apply` exactly, falling back to `patch -F2`.
Run once on a fresh tree.

Usage: 03-ungoogled.py [--dry-run]
"""
import pathlib
import subprocess
import tempfile
import sys

CB = pathlib.Path.home() / 'chromium-build'
SRC = CB / 'chromium_git/chromium/src'
UG = CB / 'ungoogled'
UGMAC = CB / 'ungoogled-macos'
REPORT = CB / 'logs/ungoogled-patches.tsv'
dry = '--dry-run' in sys.argv

SKIP = {
    'core/ungoogled-chromium/fix-building-with-prunned-binaries.patch': 'assumes pruned binaries (not pruned)',
    'core/ungoogled-chromium/build-with-wasm-rollup.patch': 'only needed when prebuilt rollup is pruned',
    'extra/inox-patchset/0016-chromium-sandbox-pie.patch': 'Linux-only',
    'extra/ungoogled-chromium/remove-disable-setuid-sandbox-as-bad-flag.patch': 'Linux-only',
    'extra/ungoogled-chromium/fix-building-without-mdns-and-service-discovery.patch':
        'build fix for enable_mdns/enable_service_discovery=false (kept enabled, as in the CEF-era build)',
    # Ardia needs the Chrome Web Store (install + extension auto-updates).
    'core/ungoogled-chromium/disable-webstore-urls.patch':
        'disables the Web Store and extension update checks (Ardia needs both)',
    'extra/ungoogled-chromium/enable-extra-locales.patch':
        'not privacy-related; kept out as in the CEF-era build (it broke CEF\'s strings); revisit',
    'extra/ungoogled-chromium/disable-download-quarantine.patch':
        'Chrome quarantines each download (com.apple.quarantine with its source) before it is complete '
        'and reports blocked or infected files as interrupted downloads',
    'extra/iridium-browser/prefs-always-prompt-for-download-directory-by-defaul.patch':
        'Ardia saves downloads to the Downloads folder without asking, as Chrome does by default',
}
PARTIAL_EXCLUDE = {
    # Its webstore_installer.cc hunks stub out Web Store installs; Ardia
    # needs them. The default component extensions stay disabled.
    'core/inox-patchset/0005-disable-default-extensions.patch': ['extensions/browser/webstore_installer.cc'],
    # enable_rlz stays true, as in the CEF-era build (CEF required it); revisit.
    'core/inox-patchset/0021-disable-rlz.patch': ['rlz/buildflags/buildflags.gni'],
    'extra/ungoogled-chromium/add-flag-to-show-avatar-button.patch':
        ['chrome/browser/ui/views/toolbar/toolbar_view.cc'],  # as in the CEF-era build; revisit
    'extra/ungoogled-chromium/add-flag-for-incognito-themes.patch':
        ['chrome/browser/ui/views/frame/browser_widget.cc'],  # as in the CEF-era build; revisit
}
# Small edits after the series: (file, old text, new text).
FUZZ = {
    'core/ungoogled-chromium/fix-building-without-safebrowsing.patch': 3,
}

FIXUPS = [
    # 0006-modify-default-prefs turns off saving/filling passwords, addresses
    # and cards by default; Ardia uses Chrome's password manager and
    # autofill (local only). Autosign-in stays off.
    ('components/password_manager/core/browser/password_manager.cc',
     '      prefs::kCredentialsEnableService, false,', '      prefs::kCredentialsEnableService, true,'),
    ('components/autofill/core/common/autofill_prefs.cc',
     '      kAutofillProfileEnabled, false,', '      kAutofillProfileEnabled, true,'),
    ('components/autofill/core/common/autofill_prefs.cc',
     '      kAutofillCreditCardEnabled, false,', '      kAutofillCreditCardEnabled, true,'),
]


def series():
    for line in (UG / 'patches/series').read_text().splitlines():
        line = line.strip()
        if line and not line.startswith('#'):
            yield UG / 'patches', line
    yield UGMAC / 'patches', 'ungoogled-chromium/macos/fix-disabling-safebrowsing.patch'


def run(cmd):
    return subprocess.run(cmd, cwd=SRC, capture_output=True, text=True)


def without_files(path, excluded):
    kept, keep = [], True
    for line in pathlib.Path(path).read_text().splitlines(keepends=True):
        if line.startswith('--- a/') or line.startswith('diff --git '):
            name = line.split()[-1][2:] if line.startswith('diff') else line[6:].strip()
            keep = name not in excluded
        if keep:
            kept.append(line)
    out = pathlib.Path(tempfile.mkdtemp()) / pathlib.Path(path).name
    out.write_text(''.join(kept))
    return str(out)


rows = []
for base, rel in series():
    path = str(base / rel)
    if rel in SKIP:
        rows.append((rel, 'skipped', SKIP[rel]))
        continue
    status, how = 'applied', ('exact', 'with fuzz/offset')
    if rel in PARTIAL_EXCLUDE:
        path = without_files(path, PARTIAL_EXCLUDE[rel])
        status, how = 'partial', ('without ' + ', '.join(PARTIAL_EXCLUDE[rel]),) * 2
    if run(['git', 'apply', '--check', '-p1', path]).returncode == 0:
        if not dry:
            run(['git', 'apply', '-p1', path]).check_returncode()
        rows.append((rel, status, how[0]))
        continue
    fuzz = f'-F{FUZZ.get(rel, 2)}'
    p = run(['patch', '-p1', fuzz, '--dry-run', '--forward', '-i', path])
    if p.returncode == 0:
        if not dry:
            run(['patch', '-p1', fuzz, '--forward', '--no-backup-if-mismatch', '-i', path]).check_returncode()
        rows.append((rel, status, how[1]))
        continue
    detail = [l for l in (p.stdout + p.stderr).splitlines() if 'failed' in l.lower() or 'No such' in l]
    rows.append((rel, 'FAILED', ' | '.join(detail)[:500]))

if not dry:
    REPORT.write_text('patch\tstatus\tdetail\n' + ''.join('\t'.join(r) + '\n' for r in rows))

if not dry:
    for rel, old, new in FIXUPS:
        f = SRC / rel
        s = f.read_text()
        if new not in s:
            assert s.count(old) == 1, f'fixup anchor missing in {rel}'
            f.write_text(s.replace(old, new, 1))
for r in rows:
    if r[1] != 'applied':
        print('%-8s %s  %s' % (r[1], r[0], r[2]))
counts = {s: sum(1 for r in rows if r[1] == s) for s in ('applied', 'partial', 'skipped', 'FAILED')}
print(' '.join(f'{k}={v}' for k, v in counts.items()))
sys.exit(1 if counts['FAILED'] else 0)

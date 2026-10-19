import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ardia_cli import scripts_store, scripts_test, userscript
from ardia_cli.scripts_store import Store, StoreError
from ardia_cli.userscript import Meta, ScriptError, build, parse_meta, url_runs

PARITY = [
    (["https://example.com/*"], [], [], [], "https://example.com/", True),
    (["https://example.com/*"], ["https://example.com:443/*"], [], [], "https://example.com/", False),
    (["https://example.com:443/*"], [], [], [], "https://example.com/a", True),
    (["https://example.com:8443/*"], [], [], [], "https://example.com/a", False),
    (["http://localhost/*"], [], [], [], "http://localhost:8080/x", True),
    (["http://localhost:80/*"], [], [], [], "http://localhost:8080/x", False),
    (["https://*.example.com/*"], [], [], [], "https://example.com./", True),
    (["https://*.example.com/*"], [], [], [], "https://a.b.example.com/", True),
    (["https://*.example.com/*"], [], [], [], "https://badexample.com/", False),
    (["https://EXAMPLE.com/*"], [], [], [], "https://example.com/", True),
    (["*://example.com/a?b*"], [], [], [], "http://example.com/a?b=1", True),
    (["*://example.com/a.b"], [], [], [], "http://example.com/aXb", False),
    (["*://example.com/*"], [], [], [], "ftp://example.com/", False),
    (["<all_urls>"], [], [], [], "file:///tmp/x.html", True),
    (["https://example.com/*"], [], [], ["*logout*"], "https://example.com/logout", False),
    ([], [], ["https://example.org/a?c"], [], "https://example.org/ac", True),
    ([], [], ["https://example.org/a?c"], [], "https://example.org/abc", True),
    ([], [], ["https://example.org/a?c"], [], "https://example.org/abbc", False),
    ([], [], ["https://example.org/\\*"], [], "https://example.org/*", True),
    ([], [], ["https://example.org/\\*"], [], "https://example.org/x", False),
    ([], [], ["*example.org*"], [], "file:///example.org", False),
    (["https://example.com/*"], [], ["https://*.example.org/*"], [], "https://w.example.org/", True),
]


def meta_for(matches, exclude_matches, includes, excludes) -> Meta:
    return Meta(name="t", matches=matches, exclude_matches=exclude_matches, includes=includes, excludes=excludes)


class Matching(unittest.TestCase):
    def test_python_cases(self):
        for matches, exclude_matches, includes, excludes, url, expected in PARITY:
            with self.subTest(url=url, matches=matches, includes=includes):
                self.assertEqual(url_runs(meta_for(matches, exclude_matches, includes, excludes), url), expected)

    @unittest.skipUnless(shutil.which("node"), "node isn't installed")
    def test_wrapper_agrees(self):
        cases = [
            {"rules": userscript.rules(meta_for(*case[:4])), "url": case[4], "expected": case[5]}
            for case in PARITY
        ]
        program = f"const match = {scripts_test.MATCHER};\nconst cases = {json.dumps(cases)};\n" + (
            "console.log(JSON.stringify(cases.map((c) => (match(c.rules, c.url) === 'run') === c.expected)));"
        )
        result = subprocess.run(["node", "-e", program], capture_output=True, text=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)
        verdicts = json.loads(result.stdout)
        failed = [PARITY[i] for i, ok in enumerate(verdicts) if not ok]
        self.assertEqual(failed, [])

    def test_bad_patterns(self):
        for pattern in ("https://example.com:70000/*", "https://exa mple.com/*", "https://ex*ample.com/*", "https://example.com", "chrome://x/*", "https://é.com/*"):
            with self.subTest(pattern=pattern), self.assertRaises(ScriptError):
                parse_meta(f"// ==UserScript==\n// @match {pattern}\n// ==/UserScript==\n", "x.user.js")


@unittest.skipUnless(userscript.find_esbuild(), "esbuild isn't available")
class Confinement(unittest.TestCase):
    def setUp(self):
        self.work = Path(tempfile.mkdtemp(prefix="ardia-cli-test-")).resolve()
        self.tree = self.work / "tree"
        (self.tree / "lib").mkdir(parents=True)
        (self.tree / "lib" / "ok.ts").write_text("export const ok = 1;\n")
        (self.work / "secret.json").write_text('{"token": "x"}\n')
        self.data = self.tree / "data"
        (self.data / "Chromium").mkdir(parents=True)
        (self.data / "Chromium" / "ArdiaControl.json").write_text('{"token": "x"}\n')

    def tearDown(self):
        shutil.rmtree(self.work, ignore_errors=True)

    def script(self, body: str) -> Path:
        path = self.tree / "s.user.ts"
        path.write_text("// ==UserScript==\n// @match https://example.com/*\n// ==/UserScript==\n" + body)
        return path

    def test_inside_tree_builds(self):
        built = build(self.script('import { ok } from "./lib/ok";\nconsole.log(ok);\n'), data_dirs=[self.data])
        self.assertIn("console.log(ok)", built.js)

    def test_outside_tree_refused(self):
        with self.assertRaisesRegex(ScriptError, "inside"):
            build(self.script('import s from "../secret.json";\nconsole.log(s);\n'), data_dirs=[self.data])

    def test_symlink_out_refused(self):
        os.symlink(self.work / "secret.json", self.tree / "link.json")
        with self.assertRaisesRegex(ScriptError, "inside"):
            build(self.script('import s from "./link.json";\nconsole.log(s);\n'), data_dirs=[self.data])

    def test_data_dir_refused_even_inside(self):
        with self.assertRaisesRegex(ScriptError, "data folder"):
            build(self.script('import s from "./data/Chromium/ArdiaControl.json";\nconsole.log(s);\n'), data_dirs=[self.data])

    def test_tsconfig_ignored(self):
        (self.tree / "tsconfig.json").write_text('{"compilerOptions": {"paths": {"@s": ["../secret.json"]}}}')
        with self.assertRaises(ScriptError):
            build(self.script('import s from "@s";\nconsole.log(s);\n'), data_dirs=[self.data])


class Stores(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="ardia-cli-store-")).resolve()

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def built(self, name: str, match: str = "https://example.com/*"):
        source = f"// ==UserScript==\n// @name {name}\n// @match {match}\n// ==/UserScript==\nconsole.log(1);\n"
        path = self.root / f"{name}.user.js"
        path.write_text(source)
        return userscript.Build(parse_meta(source, path.name), source, path, "console.log(1);\n", None, [])

    def test_install_uninstall_generations(self):
        with Store(self.root) as store:
            _, first = store.apply(add=self.built("a"))
            _, second = store.apply(add=self.built("b"))
            self.assertEqual(store.extension_generation(), second)
            _, third = store.apply(remove="a")
            _, fourth = store.apply(remove="b")
            self.assertFalse(store.extension_present())
            self.assertEqual(store.generation(), fourth)
        self.assertEqual([first, second, third, fourth], [1, 2, 3, 4])
        self.assertEqual(sorted(os.listdir(self.root / "Scripts" / "scripts")), [])
        self.assertEqual(sorted(p for p in os.listdir(self.root / "Scripts") if p.startswith(".") and p != ".lock"), [])

    def test_failed_publish_rolls_back(self):
        with Store(self.root) as store:
            store.apply(add=self.built("a"))
            before = (self.root / "Scripts" / "extension" / "manifest.json").read_text()
            with mock.patch.object(Store, "commit_record", side_effect=OSError("boom")), self.assertRaises(OSError):
                store.apply(add=self.built("b"))
            self.assertEqual((self.root / "Scripts" / "extension" / "manifest.json").read_text(), before)
            self.assertEqual([m["id"] for m in store.installed()], ["a"])
            self.assertEqual(store.generation(), 1)
        leftovers = [p for p in os.listdir(self.root / "Scripts") if p.startswith(".") and p != ".lock"]
        self.assertEqual(leftovers, [])

    def test_crash_before_generation_recovers(self):
        with Store(self.root) as store:
            store.apply(add=self.built("a"))
            with mock.patch.object(scripts_store, "write_atomic", side_effect=OSError("crash")), self.assertRaises(OSError):
                store.apply(add=self.built("b"))
            self.assertEqual(store.generation(), 1)
            self.assertEqual(store.extension_generation(), 2)
            _, generation = store.apply(add=self.built("c"))
            self.assertEqual(generation, 3)
            self.assertEqual(store.generation(), store.extension_generation())

    def test_symlinked_scripts_refused(self):
        elsewhere = self.root / "elsewhere"
        elsewhere.mkdir()
        os.symlink(elsewhere, self.root / "Scripts")
        with self.assertRaises(StoreError):
            with Store(self.root):
                pass

    def test_symlinked_record_refused(self):
        with Store(self.root) as store:
            store.apply(add=self.built("a"))
        os.symlink(self.root, self.root / "Scripts" / "scripts" / "evil")
        with self.assertRaises(StoreError), Store(self.root) as store:
            store.installed()

    def test_invalid_manifest_never_published(self):
        with Store(self.root) as store:
            store.apply(add=self.built("a"))
            bad = self.built("b")
            bad.meta.matches = ["https://example.com:99999/*"]
            with self.assertRaises(StoreError):
                store.apply(add=bad)
            self.assertEqual([m["id"] for m in store.installed()], ["a"])
            self.assertEqual(store.generation(), 1)


if __name__ == "__main__":
    unittest.main()

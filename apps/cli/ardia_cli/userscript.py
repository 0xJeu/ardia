import json
import os
import re
import shutil
import subprocess
import tempfile
from dataclasses import asdict, dataclass, field
from pathlib import Path

RUN_AT = ("document-start", "document-end", "document-idle")
INJECT_INTO = {"page": "MAIN", "auto": "MAIN", "content": "ISOLATED"}
MATCH_SCHEMES = ("*", "http", "https", "file", "ftp", "ws", "wss")
ALL_URLS_SCHEMES = ("http", "https", "file", "ftp", "ws", "wss")
DEFAULT_PORTS = {"http": 80, "https": 443, "ws": 80, "wss": 443, "ftp": 21}
INCLUDE_MATCHES = ["*://*/*"]
SOURCE_URL_PREFIX = "ardia-userscript:///"
CHROME_TARGET = "chrome130"
_HEADER = re.compile(r"^\s*//\s*==UserScript==\s*$")
_FOOTER = re.compile(r"^\s*//\s*==/UserScript==\s*$")
_ENTRY = re.compile(r"^\s*//\s*@([\w-]+(?::[\w-]+)?)(?:\s+(.*?))?\s*$")
_HOST = re.compile(
    r"^(?P<name>\*|(?:\*\.)?[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\.?|\[[0-9A-Fa-f:.]+\])(?::(?P<port>\d{1,5}|\*))?$"
)
_SLUG = re.compile(r"[^a-z0-9]+")


class ScriptError(Exception):
    pass


@dataclass
class Meta:
    name: str
    namespace: str = ""
    version: str = ""
    description: str = ""
    matches: list[str] = field(default_factory=list)
    exclude_matches: list[str] = field(default_factory=list)
    includes: list[str] = field(default_factory=list)
    excludes: list[str] = field(default_factory=list)
    run_at: str = "document-end"
    inject_into: str = "page"
    noframes: bool = False
    warnings: list[str] = field(default_factory=list)

    @property
    def id(self) -> str:
        return slug(self.name)

    @property
    def world(self) -> str:
        return INJECT_INTO[self.inject_into]

    def to_dict(self) -> dict:
        data = asdict(self)
        data["id"] = self.id
        data["world"] = self.world
        return data


def slug(name: str) -> str:
    text = _SLUG.sub("-", name.lower()).strip("-")[:64].strip("-")
    return text or "script"


def parse_meta(source: str, filename: str) -> Meta:
    lines = source.splitlines()
    start = next((i for i, line in enumerate(lines) if _HEADER.match(line)), None)
    entries: list[tuple[str, str]] = []
    if start is not None:
        end = next((i for i in range(start + 1, len(lines)) if _FOOTER.match(lines[i])), None)
        if end is None:
            raise ScriptError(f"{filename}: the // ==UserScript== block has no // ==/UserScript== line")
        for line in lines[start + 1 : end]:
            found = _ENTRY.match(line)
            if found:
                entries.append((found.group(1), (found.group(2) or "").strip()))
    stem = Path(filename).name.split(".")[0] or "script"
    meta = Meta(name=stem)
    grants = []
    for key, value in entries:
        if key == "name" and value:
            meta.name = value
        elif key in ("namespace", "version", "description"):
            setattr(meta, key, value)
        elif key == "match":
            meta.matches.append(check_match(value, key))
        elif key == "exclude-match":
            meta.exclude_matches.append(check_match(value, key))
        elif key in ("include", "exclude"):
            check_glob(value, key)
            (meta.includes if key == "include" else meta.excludes).append(value)
        elif key == "run-at":
            if value not in RUN_AT:
                raise ScriptError(f"@run-at {value!r}: use document-start, document-end or document-idle")
            meta.run_at = value
        elif key == "inject-into":
            if value not in INJECT_INTO:
                raise ScriptError(f"@inject-into {value!r}: use page, content or auto")
            meta.inject_into = value
        elif key == "noframes":
            meta.noframes = True
        elif key == "grant":
            grants.append(value)
        elif key in ("require", "resource"):
            meta.warnings.append(f"@{key} {value} is ignored: import the code instead (esbuild bundles relative imports)")
    for grant in grants:
        if grant != "none":
            meta.warnings.append(f"@grant {grant} is ignored: Ardia runs userscripts without GM_* APIs")
    if not meta.matches and not meta.includes:
        meta.warnings.append("no @match or @include: the script runs nowhere")
    return meta


def parse_match(pattern: str, key: str = "match") -> dict:
    if pattern == "<all_urls>":
        return {"all": True, "schemes": list(ALL_URLS_SCHEMES), "host": "", "sub": True, "port": "*", "path": "*"}
    scheme, sep, rest = pattern.partition("://")
    if not sep or scheme not in MATCH_SCHEMES:
        raise ScriptError(f"@{key} {pattern!r}: a match pattern is <all_urls> or scheme://host/path, scheme one of {', '.join(MATCH_SCHEMES)}")
    host, slash, path = rest.partition("/")
    if not slash:
        raise ScriptError(f"@{key} {pattern!r}: add a path, like {pattern}/*")
    schemes = ["http", "https"] if scheme == "*" else [scheme]
    if scheme == "file":
        if host:
            raise ScriptError(f"@{key} {pattern!r}: file patterns have no host (file:///path)")
        return {"all": False, "schemes": schemes, "host": "", "sub": False, "port": "*", "path": "/" + path}
    found = _HOST.match(host)
    if not found:
        raise ScriptError(f"@{key} {pattern!r}: the host is *, *.example.com or example.com (ASCII; use punycode), with an optional :port")
    name, port = found.group("name"), found.group("port") or "*"
    if port != "*" and int(port) > 65535:
        raise ScriptError(f"@{key} {pattern!r}: the port must be 0 to 65535")
    sub = name == "*" or name.startswith("*.")
    name = "" if name == "*" else name[2:] if name.startswith("*.") else name
    return {"all": False, "schemes": schemes, "host": name.lower().rstrip("."), "sub": sub, "port": str(int(port)) if port != "*" else "*", "path": "/" + path}


def check_match(pattern: str, key: str) -> str:
    parse_match(pattern, key)
    return pattern


def check_glob(glob: str, key: str) -> None:
    if len(glob) > 2 and glob.startswith("/") and glob.endswith("/"):
        raise ScriptError(f"@{key} {glob!r}: regular expressions aren't supported; use @match patterns or * globs")
    if not glob:
        raise ScriptError(f"@{key} needs a value")
    if any(ord(char) < 0x20 or ord(char) == 0x7F for char in glob):
        raise ScriptError(f"@{key} {glob!r}: has control characters")


def _escape(text: str) -> str:
    return "".join("\\" + char if char in ".^$+?*()[]{}|\\/-" else char for char in text)


def wildcard_regex(text: str) -> str:
    return "^" + "[\\s\\S]*".join(_escape(part) for part in text.split("*")) + "$"


def glob_regex(glob: str) -> str:
    out = []
    index = 0
    while index < len(glob):
        char = glob[index]
        if char == "\\" and index + 1 < len(glob):
            out.append(_escape(glob[index + 1]))
            index += 2
            continue
        out.append("[\\s\\S]*" if char == "*" else "[\\s\\S]?" if char == "?" else _escape(char))
        index += 1
    return "^" + "".join(out) + "$"


def _compiled(pattern: dict) -> dict:
    return {**pattern, "path": wildcard_regex(pattern["path"])}


def rules(meta: Meta) -> dict:
    return {
        "match": [_compiled(parse_match(p)) for p in meta.matches],
        "excludeMatch": [_compiled(parse_match(p)) for p in meta.exclude_matches],
        "include": [glob_regex(g) for g in meta.includes],
        "exclude": [glob_regex(g) for g in meta.excludes],
        "runAt": meta.run_at,
        "noframes": meta.noframes,
    }


def _matches(pattern: dict, url) -> bool:
    if url is None or url.scheme not in pattern["schemes"]:
        return False
    if pattern["all"]:
        return True
    if url.scheme != "file":
        host = (url.hostname or "").rstrip(".")
        host = f"[{host}]" if ":" in host else host
        if not (pattern["host"] == "" or host == pattern["host"] or (pattern["sub"] and host.endswith("." + pattern["host"]))):
            return False
        if pattern["port"] != "*":
            try:
                port = url.port or DEFAULT_PORTS.get(url.scheme)
            except ValueError:
                return False
            if str(port) != pattern["port"]:
                return False
    path = (url.path or "/") + (f"?{url.query}" if url.query else "")
    return re.search(pattern["path"], path) is not None


def url_runs(meta: Meta, url: str) -> bool:
    from urllib.parse import urlsplit

    try:
        parsed = urlsplit(url)
    except ValueError:
        parsed = None
    spec = rules(meta)
    globbed = lambda regexes: any(re.search(r, url) for r in regexes)
    included = any(_matches(p, parsed) for p in spec["match"]) or (url.startswith(("http:", "https:")) and globbed(spec["include"]))
    excluded = any(_matches(p, parsed) for p in spec["excludeMatch"]) or globbed(spec["exclude"])
    return included and not excluded


def default_url(meta: Meta) -> str | None:
    for pattern in meta.matches:
        if pattern == "<all_urls>":
            continue
        scheme, _, rest = pattern.partition("://")
        host, _, path = rest.partition("/")
        if "*" in host or scheme == "file":
            continue
        scheme = "https" if scheme == "*" else scheme
        if scheme not in ("http", "https"):
            continue
        return f"{scheme}://{host}/{path.split('*')[0]}"
    for glob in meta.includes:
        if "*" not in glob and "?" not in glob and re.match(r"^https?://", glob):
            return glob
    return None


def manifest_entries(meta: Meta, js: str) -> list[dict]:
    base = {
        "js": [js],
        "run_at": meta.run_at.replace("-", "_"),
        "all_frames": not meta.noframes,
        "world": meta.world,
    }
    entries = []
    if meta.matches:
        entries.append(
            {
                "matches": list(meta.matches),
                "exclude_matches": list(meta.exclude_matches),
                "include_globs": [],
                "exclude_globs": list(meta.excludes),
                **base,
            }
        )
    if meta.includes:
        excluded = list(dict.fromkeys(meta.exclude_matches + meta.matches))
        entries.append(
            {
                "matches": list(INCLUDE_MATCHES),
                "exclude_matches": excluded,
                "include_globs": list(meta.includes),
                "exclude_globs": list(meta.excludes),
                **base,
            }
        )
    return entries


def installed() -> bool:
    return "site-packages" in Path(__file__).resolve().parts


def find_esbuild() -> str | None:
    here = Path(__file__).resolve().parent
    bundled = here / "bin" / "esbuild"
    if os.access(bundled, os.X_OK) and not bundled.is_symlink():
        return str(bundled)
    if installed():
        return None
    for parent in here.parents:
        modules = parent / "node_modules"
        native = modules / "@esbuild" / "darwin-arm64" / "bin" / "esbuild"
        if os.access(native, os.X_OK):
            return str(native)
        for candidate in sorted((modules / ".pnpm").glob("@esbuild+darwin-arm64@*/node_modules/@esbuild/darwin-arm64/bin/esbuild"), reverse=True):
            if os.access(candidate, os.X_OK):
                return str(candidate)
    return shutil.which("esbuild")


@dataclass
class Build:
    meta: Meta
    source: str
    path: Path
    js: str
    sourcemap: dict | None
    warnings: list[str]


def forbidden_roots(data_dirs) -> list[Path]:
    from ardia_cli.endpoint import INSTALLED_DATA_DIR

    roots = [INSTALLED_DATA_DIR, *data_dirs]
    if os.environ.get("ARDIA_DATA_DIR"):
        roots.append(Path(os.environ["ARDIA_DATA_DIR"]).expanduser())
    return [Path(os.path.realpath(root)) for root in roots]


def _inside(path: Path, root: Path) -> bool:
    return path == root or root in path.parents


def check_inputs(inputs, base: Path, entry: Path, data_dirs) -> None:
    tree = entry.parent
    roots = forbidden_roots(data_dirs)
    shallow = tree == Path(os.path.realpath(Path.home())) or tree.parent == tree
    for name in inputs:
        if name.startswith("<data:"):
            continue
        if name.startswith("<"):
            raise ScriptError(f"refusing to bundle {name}: only files in the script's folder can be imported")
        real = Path(os.path.realpath(base / name))
        if any(_inside(real, root) for root in roots):
            raise ScriptError(f"refusing to bundle {real}: it's in Ardia's data folder")
        if real == entry:
            continue
        if shallow:
            raise ScriptError(f"refusing to bundle {real}: a script in {tree} may only import files in a folder of its own; move it into one")
        if not _inside(real, tree):
            raise ScriptError(f"refusing to bundle {real}: imports must stay inside {tree} (symlinks resolved)")


def build(path: str | Path, sourcemap: bool = False, data_dirs=()) -> Build:
    path = Path(path)
    try:
        source = path.read_text(encoding="utf-8")
    except OSError as error:
        raise ScriptError(f"{path}: {error.strerror or error}") from None
    except UnicodeDecodeError:
        raise ScriptError(f"{path}: isn't UTF-8 text") from None
    meta = parse_meta(source, path.name)
    esbuild = find_esbuild()
    if not esbuild:
        hint = "reinstall the ardia command" if installed() else "run pnpm install, or put esbuild on PATH"
        raise ScriptError(f"esbuild isn't available: {hint}")
    entry = Path(os.path.realpath(path))
    if any(_inside(entry, root) for root in forbidden_roots(data_dirs)):
        raise ScriptError(f"refusing to build {entry}: it's in Ardia's data folder")
    with tempfile.TemporaryDirectory(prefix="ardia-script-") as work:
        out = Path(work) / "script.js"
        metafile = Path(work) / "meta.json"
        command = [
            esbuild,
            str(entry),
            "--bundle",
            "--format=iife",
            "--platform=browser",
            f"--target={CHROME_TARGET}",
            "--charset=utf8",
            "--legal-comments=none",
            "--log-level=warning",
            "--color=false",
            "--tsconfig-raw={}",
            f"--metafile={metafile}",
            f"--outfile={out}",
        ]
        if sourcemap:
            command.append("--sourcemap=external")
        try:
            done = subprocess.run(command, capture_output=True, text=True, timeout=60, cwd=str(entry.parent), stdin=subprocess.DEVNULL)
        except subprocess.TimeoutExpired:
            raise ScriptError("esbuild took over 60 s") from None
        except OSError as error:
            raise ScriptError(f"can't run esbuild ({error.strerror or error})") from None
        messages = done.stderr.strip()
        if done.returncode != 0:
            raise ScriptError(f"esbuild couldn't build {path}:\n{messages}" if messages else f"esbuild couldn't build {path}")
        try:
            inputs = json.loads(metafile.read_text(encoding="utf-8")).get("inputs") or {}
        except (OSError, ValueError):
            raise ScriptError("esbuild didn't say which files it bundled") from None
        check_inputs(inputs, entry.parent, entry, data_dirs)
        js = out.read_text(encoding="utf-8")
        mapping = None
        if sourcemap and out.with_suffix(".js.map").exists():
            mapping = json.loads(out.with_suffix(".js.map").read_text(encoding="utf-8"))
            mapping["sources"] = [_display_path(Path(work), source_name) for source_name in mapping.get("sources", [])]
    warnings = [line for line in messages.splitlines() if line.strip()] if messages else []
    return Build(meta, source, path, js, mapping, warnings)


def _display_path(base: Path, name: str) -> str:
    full = os.path.normpath(os.path.join(base, name))
    try:
        relative = os.path.relpath(full)
    except ValueError:
        return full
    return full if relative.startswith("../../") else relative


_B64 = {char: index for index, char in enumerate("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/")}


def _vlq(segment: str) -> list[int]:
    values, shift, value = [], 0, 0
    for char in segment:
        digit = _B64[char]
        value += (digit & 31) << shift
        if digit & 32:
            shift += 5
            continue
        values.append(-(value >> 1) if value & 1 else value >> 1)
        shift, value = 0, 0
    return values


class SourceMap:
    def __init__(self, data: dict | None, line_offset: int):
        self.offset = line_offset
        self.sources = list(data.get("sources", [])) if data else []
        self.lines: list[list[tuple[int, int, int, int]]] = []
        if not data:
            return
        source = line = column = 0
        for text in data.get("mappings", "").split(";"):
            row = []
            generated = 0
            for segment in filter(None, text.split(",")):
                values = _vlq(segment)
                generated += values[0]
                if len(values) >= 4:
                    source += values[1]
                    line += values[2]
                    column += values[3]
                    row.append((generated, source, line, column))
            self.lines.append(row)

    def lookup(self, line: int, column: int) -> tuple[str, int, int] | None:
        index = line - self.offset
        if not 0 <= index < len(self.lines) or not self.lines[index]:
            return None
        row = self.lines[index]
        best = row[0]
        for entry in row:
            if entry[0] > column:
                break
            best = entry
        if not 0 <= best[1] < len(self.sources):
            return None
        return self.sources[best[1]], best[2] + 1, best[3] + 1

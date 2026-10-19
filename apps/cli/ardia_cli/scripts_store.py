import ctypes
import errno
import fcntl
import json
import os
import shutil
import tempfile
import time
from pathlib import Path

from ardia_cli.userscript import Build, Meta, manifest_entries

LOCK_TIMEOUT = 30
STATUS_TIMEOUT = 10
STATUS_POLL = 0.1
RENAME_SWAP = 0x2
EXTENSION_NAME = "Ardia Scripts"
EXTENSION_DESCRIPTION = "Userscripts installed with the ardia command."
SOURCE_SUFFIXES = (".ts", ".mts", ".js", ".mjs")


class StoreError(Exception):
    pass


class Store:
    def __init__(self, data_root: Path):
        self.root = data_root / "Scripts"
        self.records = self.root / "scripts"
        self.extension = self.root / "extension"
        self.generation_file = self.root / "generation"
        self.status_file = self.root / "status.json"
        self.lock_fd: int | None = None

    def __enter__(self):
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.records.mkdir(mode=0o700, exist_ok=True)
        fd = os.open(self.root / ".lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        deadline = time.monotonic() + LOCK_TIMEOUT
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    os.close(fd)
                    raise StoreError(f"another ardia scripts command or Ardia has held {self.root / '.lock'} for {LOCK_TIMEOUT}s") from None
                time.sleep(0.05)
        self.lock_fd = fd
        return self

    def __exit__(self, *_exc):
        self.unlock()

    def unlock(self):
        if self.lock_fd is not None:
            os.close(self.lock_fd)
            self.lock_fd = None

    def installed(self) -> list[dict]:
        found = []
        if not self.records.is_dir():
            return found
        for folder in sorted(self.records.iterdir()):
            if folder.name.startswith(".") or not folder.is_dir():
                continue
            try:
                meta = json.loads((folder / "meta.json").read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if isinstance(meta, dict) and meta.get("id") == folder.name:
                found.append(meta)
        return sorted(found, key=lambda meta: (meta.get("installed_at", 0), meta["id"]))

    def find(self, name: str) -> dict | None:
        scripts = self.installed()
        return next((m for m in scripts if m.get("name") == name), None) or next((m for m in scripts if m["id"] == name), None)

    def save(self, build: Build) -> tuple[dict, bool]:
        meta = build.meta
        folder = self.records / meta.id
        previous = None
        try:
            previous = json.loads((folder / "meta.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            pass
        now = time.time()
        record = meta.to_dict()
        record["source_file"] = str(build.path.resolve())
        suffix = next((s for s in SOURCE_SUFFIXES if build.path.name.endswith(s)), ".js")
        record["source"] = "source" + suffix
        record["installed_at"] = previous.get("installed_at", now) if isinstance(previous, dict) else now
        record["updated_at"] = now
        staging = Path(tempfile.mkdtemp(prefix=f".{meta.id}-", dir=self.records))
        try:
            (staging / record["source"]).write_text(build.source, encoding="utf-8")
            (staging / "script.js").write_text(build.js, encoding="utf-8")
            (staging / "meta.json").write_text(json.dumps(record, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            publish(staging, folder)
        finally:
            shutil.rmtree(staging, ignore_errors=True)
        return record, previous is not None

    def remove(self, script_id: str) -> None:
        folder = self.records / script_id
        trash = Path(tempfile.mkdtemp(prefix=f".{script_id}-old-", dir=self.records))
        try:
            os.rename(folder, trash / "old")
        finally:
            shutil.rmtree(trash, ignore_errors=True)

    def next_generation(self) -> int:
        current = read_int(self.generation_file)
        status = self.status()
        reported = status.get("generation") if isinstance(status, dict) else None
        reported = reported if isinstance(reported, int) and not isinstance(reported, bool) else 0
        return max(current, reported) + 1

    def status(self) -> dict | None:
        try:
            data = json.loads(self.status_file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        return data if isinstance(data, dict) else None

    def regenerate(self) -> int:
        generation = self.next_generation()
        scripts = self.installed()
        if scripts:
            staging = Path(tempfile.mkdtemp(prefix=".extension-", dir=self.root))
            try:
                (staging / "js").mkdir()
                entries = []
                for meta in scripts:
                    js_name = f"js/{meta['id']}.js"
                    shutil.copyfile(self.records / meta["id"] / "script.js", staging / js_name)
                    entries.extend(manifest_entries(meta_from_record(meta), js_name))
                manifest = {
                    "manifest_version": 3,
                    "name": EXTENSION_NAME,
                    "version": manifest_version(generation),
                    "description": EXTENSION_DESCRIPTION,
                    "content_scripts": entries,
                }
                (staging / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
                (staging / "generation").write_text(f"{generation}\n", encoding="utf-8")
                publish(staging, self.extension)
            finally:
                shutil.rmtree(staging, ignore_errors=True)
        elif self.extension.exists() or self.extension.is_symlink():
            trash = Path(tempfile.mkdtemp(prefix=".extension-old-", dir=self.root))
            try:
                os.rename(self.extension, trash / "old")
            finally:
                shutil.rmtree(trash, ignore_errors=True)
        write_atomic(self.generation_file, f"{generation}\n")
        return generation

    def wait_status(self, generation: int, alive) -> tuple[str, dict | None]:
        deadline = time.monotonic() + STATUS_TIMEOUT
        while True:
            status = self.status()
            reported = status.get("generation") if status else None
            if isinstance(reported, int) and not isinstance(reported, bool) and reported >= generation:
                return ("superseded" if reported > generation else "reported"), status
            if not alive():
                return "quit", None
            if time.monotonic() >= deadline:
                return "timeout", None
            time.sleep(STATUS_POLL)


def meta_from_record(record: dict) -> Meta:
    fields = {key: record[key] for key in Meta.__dataclass_fields__ if key in record}
    return Meta(**fields)


def manifest_version(generation: int) -> str:
    return f"1.{generation // 65536 % 65536}.{generation % 65536}"


def read_int(path: Path) -> int:
    try:
        text = path.read_text(encoding="utf-8").strip()
    except OSError:
        return 0
    return int(text) if text.isdigit() else 0


def write_atomic(path: Path, text: str) -> None:
    fd, temp = tempfile.mkstemp(prefix=f".{path.name}-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temp, 0o644)
        os.rename(temp, path)
    except BaseException:
        try:
            os.unlink(temp)
        except OSError:
            pass
        raise


_libc = None


def swap(first: Path, second: Path) -> None:
    global _libc
    if _libc is None:
        _libc = ctypes.CDLL(None, use_errno=True)
        _libc.renamex_np.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]
        _libc.renamex_np.restype = ctypes.c_int
    if _libc.renamex_np(os.fsencode(first), os.fsencode(second), RENAME_SWAP) != 0:
        code = ctypes.get_errno()
        raise OSError(code, os.strerror(code), str(second))


def publish(staging: Path, destination: Path) -> None:
    fresh = staging / "fresh"
    os.mkdir(fresh)
    for item in list(staging.iterdir()):
        if item != fresh:
            os.rename(item, fresh / item.name)
    os.chmod(fresh, 0o755)
    if destination.is_symlink() or (destination.exists() and not destination.is_dir()):
        raise StoreError(f"{destination} isn't a folder the ardia command made; move it away first")
    try:
        os.rename(fresh, destination)
        return
    except OSError as error:
        if error.errno not in (errno.ENOTEMPTY, errno.EEXIST):
            raise
    swap(fresh, destination)

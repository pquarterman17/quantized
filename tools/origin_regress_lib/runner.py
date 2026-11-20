"""Corpus discovery, parallel fingerprinting, and output-path policy."""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import threading
import time
from collections.abc import Iterable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from .fingerprint import SCHEMA

SUFFIXES = {".opj", ".opju"}
# never walked: generated specimens (owner examines them), Origin-exported
# oracle images, baselines themselves, the COM oracle JSON dir.
SKIP_DIRS = {"generated", "_exports", "_baselines", "ground_truth_public", ".git"}
# synthetic/generated sets named in the corpus brief (matched on path parts)
SKIP_PARTS = ("CKPEIIKA_deopjufy/tests/fixtures/synthetic", "BertySnack_norigin")
TOOLS = Path(__file__).resolve().parents[1]
REPO = TOOLS.parent


def _under(path: Path, parent: Path) -> bool:
    p, q = path.resolve(), parent.resolve()
    return p == q or q in p.parents


def repo_roots() -> list[Path]:
    """This checkout plus the main checkout that owns it (linked worktrees)."""
    roots = [REPO]
    try:
        common = subprocess.run(
            ["git", "rev-parse", "--git-common-dir"],
            cwd=REPO, capture_output=True, text=True, check=True,
        ).stdout.strip()  # fmt: skip
        roots.append((REPO / common).resolve().parent)
    except (OSError, subprocess.CalledProcessError):
        pass
    return roots


def refuse_in_repo(path: Path) -> Path:
    """Snapshots can describe private corpora: never write them inside a repo."""
    for root in repo_roots():
        if _under(path, root):
            raise SystemExit(
                f"origin_regress: refusing to write {path} inside the repository ({root}); "
                "use a path outside it (QZ_ORIGIN_BASELINE or ../test-data/origin/_baselines)"
            )
    return path


def _test_data_origin() -> Path | None:
    for anc in [REPO, *REPO.parents]:
        cand = anc / "test-data" / "origin"
        if cand.is_dir():
            return cand
    return None


def baseline_dir() -> Path:
    env = os.environ.get("QZ_ORIGIN_BASELINE")
    if env and not env.endswith(".json"):
        return Path(env)
    td = _test_data_origin()
    if td is not None:
        return td / "_baselines"
    cache = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache"))
    return cache / "quantized" / "origin_baselines"


def default_out(sha: str) -> Path:
    env = os.environ.get("QZ_ORIGIN_BASELINE")
    if env and env.endswith(".json"):
        return Path(env)
    return baseline_dir() / f"{sha}.json"


def discover_corpora(explicit: list[str]) -> dict[str, Path]:
    """label -> root. ``--corpus [LABEL=]PATH`` overrides; else public + owner."""
    out: dict[str, Path] = {}
    for spec in explicit:
        label, _, raw = spec.partition("=") if "=" in spec else (Path(spec).name, "", spec)
        if not Path(raw).is_dir():
            raise SystemExit(f"origin_regress: --corpus {raw!r} is not a directory")
        out[label] = Path(raw)
    if explicit:
        return out
    pub = os.environ.get("QZ_ORIGIN_PUBLIC_CORPUS")
    td = _test_data_origin()
    if pub and Path(pub).is_dir():
        out["public"] = Path(pub)
    elif td and (td / "public").is_dir():
        out["public"] = td / "public"
    owner = os.environ.get("QZ_ORIGIN_OWNER_CORPUS")
    if owner and Path(owner).is_dir():
        out["owner"] = Path(owner)
    elif td and any(_walk(td, extra_skip={"public"})):
        out["owner"] = td
    return out


def _walk(root: Path, extra_skip: Iterable[str] = ()) -> Iterable[Path]:
    skip = SKIP_DIRS | set(extra_skip)
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in skip)
        for fn in sorted(filenames):
            if Path(fn).suffix.lower() in SUFFIXES:
                p = Path(dirpath) / fn
                rel = p.relative_to(root).as_posix()
                if not any(part in rel for part in SKIP_PARTS):
                    yield p


def collect_files(corpora: dict[str, Path]) -> dict[str, Path]:
    files: dict[str, Path] = {}
    for label, root in corpora.items():
        skip = {"public"} if label == "owner" else set()
        for p in _walk(root, skip):
            files[f"{label}:{p.relative_to(root).as_posix()}"] = p
    return dict(sorted(files.items()))


def corpus_id(files: dict[str, Path]) -> str:
    """Stable identity of the file set (names + sizes), for cache keys."""
    h = hashlib.sha1()
    for k, p in files.items():
        h.update(f"{k}|{p.stat().st_size}\n".encode())
    return h.hexdigest()[:12]


class _Worker:
    def __init__(self, src: Path) -> None:
        self.src = src
        self.proc: subprocess.Popen[str] | None = None

    def _start(self) -> subprocess.Popen[str]:
        env = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONPATH=str(self.src))
        self.proc = subprocess.Popen(
            [sys.executable, str(Path(__file__).with_name("worker.py")), str(self.src)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, encoding="utf-8", env=env,
        )  # fmt: skip
        return self.proc

    def kill(self) -> None:
        if self.proc and self.proc.poll() is None:
            self.proc.kill()
            self.proc.wait()
        self.proc = None

    def run(self, key: str, path: Path, timeout: float) -> dict[str, Any]:
        proc = self.proc if self.proc and self.proc.poll() is None else self._start()
        assert proc.stdin and proc.stdout
        timer = threading.Timer(timeout, proc.kill)
        timer.start()
        try:
            proc.stdin.write(json.dumps({"id": key, "path": str(path)}) + "\n")
            proc.stdin.flush()
            while True:
                line = proc.stdout.readline()
                if not line:
                    self.kill()
                    return {"error": "timeout" if not timer.is_alive() else "worker_died"}
                if line.startswith("@@"):
                    return dict(json.loads(line[2:])["fp"])
        except (OSError, ValueError):
            self.kill()
            return {"error": "worker_died"}
        finally:
            timer.cancel()


def snapshot(
    files: dict[str, Path], src: Path, *, jobs: int, timeout: float, meta: dict[str, Any]
) -> dict[str, Any]:
    """Fingerprint every file with the code under ``src`` (a ``<root>/src`` dir)."""
    items = list(files.items())
    local = threading.local()
    workers: list[_Worker] = []

    def one(item: tuple[str, Path]) -> tuple[str, dict[str, Any]]:
        w = getattr(local, "w", None)
        if w is None:
            w = local.w = _Worker(src)
            workers.append(w)
        return item[0], w.run(item[0], item[1], timeout)

    start = time.monotonic()
    with ThreadPoolExecutor(jobs) as ex:
        results = dict(ex.map(one, items))
    for w in workers:
        w.kill()
    return {
        "schema": SCHEMA,
        "meta": {**meta, "files": len(items), "seconds": round(time.monotonic() - start, 1)},
        "projects": dict(sorted(results.items())),
    }

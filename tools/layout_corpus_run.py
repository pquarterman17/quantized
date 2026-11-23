"""Realdata check for "remember the last layout" (WORKSPACE_LAYOUT_PLAN P6).

Acceptance: opening each realdata fixture project restores the exact window
placements. The private corpus (``<root>/test-data/origin``) never enters the
repo: this driver converts every Origin project there to ``.dwk`` in a scratch
directory (``convert_origin_project``, what ``qz convert --to dwk`` runs), then
runs ``frontend/src/store/windowLayoutRestore.corpus.test.ts`` with
``QZ_LAYOUT_CORPUS_DIR`` pointing at it. That vitest file opens each project
with a per-user template remembered, arranges and saves it, and reopens it under
a different template: the saved placements must come back exactly. Without the
variable the vitest file skips, so CI never needs the corpus.

    uv run python tools/layout_corpus_run.py [--limit N] [--keep DIR]

Exit status: vitest's (0 = every converted project restored exactly). Projects
the converter refuses (``failed``) are counted and skipped: converting them is
not what this check is about.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LFS_POINTER = b"version https://git-lfs.github.com/spec/v1"


def corpus_origin_dir() -> Path:
    """``<test-data>/origin``, found the way ``tests/conftest.py`` finds the
    corpus (the sibling of the repo, or of any ancestor for a worktree)."""
    for ancestor in [ROOT.parent, *ROOT.parents]:
        cand = ancestor / "test-data"
        if cand.is_dir():
            return cand / "origin"
    return ROOT.parent / "test-data" / "origin"


def is_project(path: Path) -> bool:
    """A real project file: not an un-fetched Git LFS pointer."""
    with path.open("rb") as fh:
        return not fh.read(len(LFS_POINTER)).startswith(LFS_POINTER)


def convert_all(src: Path, out: Path, limit: int | None) -> tuple[int, int]:
    from quantized.io.origin_convert import convert_origin_project

    projects = sorted(
        p for p in src.rglob("*") if p.suffix.lower() in {".opj", ".opju"} and p.is_file()
    )
    projects = [p for p in projects if is_project(p)][: limit or None]
    ok = failed = 0
    for i, project in enumerate(projects):
        # A per-project folder: two corpus projects may share a file name.
        dest = out / f"p{i:04d}"
        report = convert_origin_project(
            project, dest, "dwk", imported_at="2026-01-01T00:00:00.000Z", allow_partial=True
        )
        written = list(dest.glob("*.dwk")) if dest.is_dir() else []
        if report.get("status") == "failed" or not written:
            failed += 1
            continue
        for w in written:
            w.rename(out / f"p{i:04d}.dwk")
        ok += 1
    return ok, failed


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--limit", type=int, default=None, help="convert at most N projects")
    ap.add_argument(
        "--keep", type=Path, default=None, help="convert into DIR and keep it (default: a temp dir)"
    )
    args = ap.parse_args()
    src = corpus_origin_dir()
    if not src.is_dir():
        print(f"layout corpus: no corpus at {src}; nothing to check (skipped)")
        return 0
    work = args.keep or Path(tempfile.mkdtemp(prefix="qz-layout-corpus-"))
    work.mkdir(parents=True, exist_ok=True)
    try:
        ok, failed = convert_all(src, work, args.limit)
        print(f"layout corpus: {ok} projects converted, {failed} refused by the converter")
        if not ok:
            return 1
        npx = shutil.which("npx") or "npx"
        proc = subprocess.run(
            [
                npx,
                "vitest",
                "run",
                "src/store/windowLayoutRestore.corpus.test.ts",
                "--maxWorkers=1",
            ],
            cwd=ROOT / "frontend",
            env={
                **os.environ,
                "QZ_LAYOUT_CORPUS_DIR": str(work),
                "QZ_LAYOUT_CORPUS_COUNT": str(ok),
            },
            check=False,
        )
        return proc.returncode
    finally:
        if args.keep is None:
            shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())

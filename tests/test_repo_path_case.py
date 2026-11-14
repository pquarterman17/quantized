"""Tracked paths must stay distinct on case-insensitive filesystems.

Windows and default macOS volumes fold case, so two tracked paths that differ
only by case (``WorksheetMenus.tsx`` / ``worksheetMenus.ts`` resolve
extensionlessly to the same module specifier) collide on checkout: one file
silently overwrites the other. Linux CI never sees it, while tsc, eslint, the
Vite build and ~100 worksheet tests break on a developer checkout.

Two kinds of collision are checked:

* exact paths equal under case folding — git can't check both out at all;
* source modules whose *extensionless import specifier* folds equal within
  one directory (``./worksheetMenus`` vs ``./WorksheetMenus``) — both files
  exist on disk, but the bundler's resolver picks either one.
"""

from __future__ import annotations

import shutil
import subprocess
from collections import defaultdict
from pathlib import Path, PurePosixPath

import pytest

ROOT = Path(__file__).resolve().parents[1]

# Extensions a TS/JS import specifier may omit.
_RESOLVABLE = (".tsx", ".ts", ".jsx", ".js", ".mts", ".cts", ".mjs", ".cjs")


def _tracked_paths() -> list[str]:
    git = shutil.which("git")
    if git is None or not (ROOT / ".git").exists():
        pytest.skip("not a git checkout")
    out = subprocess.run(
        [git, "-C", str(ROOT), "ls-files", "-z"],
        check=True,
        capture_output=True,
    ).stdout
    return [p for p in out.decode("utf-8").split("\0") if p]


def _collisions(keys: dict[str, set[str]]) -> list[list[str]]:
    return sorted(sorted(v) for v in keys.values() if len(v) > 1)


def test_no_tracked_paths_collide_case_insensitively() -> None:
    folded: dict[str, set[str]] = defaultdict(set)
    for path in _tracked_paths():
        folded[path.casefold()].add(path)
    clashes = _collisions(folded)
    assert not clashes, (
        "Tracked paths differ only by case and collide on Windows/macOS "
        f"checkouts — rename one of each group: {clashes}"
    )


def test_no_import_specifiers_collide_case_insensitively() -> None:
    folded: dict[str, set[str]] = defaultdict(set)
    for path in _tracked_paths():
        p = PurePosixPath(path)
        if p.suffix not in _RESOLVABLE:
            continue
        # `foo.test.ts` is never imported as `./foo`, so key on the full stem.
        folded[str(p.with_suffix("")).casefold()].add(path)
    # Same spelling with different extensions (foo.ts + foo.css-module shims,
    # a .ts/.tsx pair) is a separate concern; only case-variant spellings
    # are a filesystem collision.
    clashes = [
        group
        for group in _collisions(folded)
        if len({str(PurePosixPath(g).with_suffix("")) for g in group}) > 1
    ]
    assert not clashes, (
        "Modules whose import specifiers differ only by case resolve "
        f"ambiguously on case-insensitive filesystems: {clashes}"
    )

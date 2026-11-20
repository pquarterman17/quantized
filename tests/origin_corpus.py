"""Shared discovery of the local-only Origin corpus for ``realdata`` tests.

Every Origin realdata module resolves the corpus through ``conftest``'s
``TEST_DATA_CORPUS`` (read at call time, not copied at import), so one plugin
that repoints it -- the owner-realdata gate's ``-p corpus_plugin`` -- reaches
all of them. Private ``__file__`` walks ignored that and skipped silently.
Collection runs after ``pytest_sessionstart``, so module-level calls here see
the repointed value.
"""

from __future__ import annotations

from pathlib import Path

import conftest


def origin_corpus_dir() -> Path:
    """``<test-data>/origin`` (may not exist: callers skip on missing files)."""
    root: Path = conftest.TEST_DATA_CORPUS
    return root / "origin"


_LFS_POINTER = b"version https://git-lfs.github.com/spec/v1"


def has_project(path: Path) -> bool:
    """True when ``path`` is a real project file, not missing and not an
    un-fetched Git LFS pointer (``PNR.opj`` is one in a checkout without
    ``git lfs pull``; reading it raises, so tests must skip, not fail)."""
    if not path.is_file():
        return False
    with path.open("rb") as fh:
        return not fh.read(len(_LFS_POINTER)).startswith(_LFS_POINTER)

"""Refuse an output path that would overwrite a file or an input.

"Raw source files are never rewritten" (P1.2 box 4, ``tests/test_write_sites.py``):
the headless writers that take a caller's output path -- ``qz convert``,
``quantized.api.save_table`` -- call :func:`check_target` before they write.

* An existing path (a dangling symlink included) is refused unless
  ``overwrite`` is set.
* Even with ``overwrite``, a path that resolves to one of ``protected`` (the
  inputs), or inside one of them, is refused -- symlinks followed, compared
  case-insensitively where the file system is (``os.path.normcase``). So
  writing through a symlink that points at an input is refused too.

Pure ``io``: no write happens here.
"""

from __future__ import annotations

import os
from collections.abc import Iterable
from pathlib import Path

__all__ = ["WriteRefused", "check_target"]


class WriteRefused(ValueError):
    """The output path was refused; the message says why."""


def _key(path: Path) -> str:
    return os.path.normcase(str(path.resolve()))


def check_target(
    target: Path, *, overwrite: bool = False, protected: Iterable[Path | str] = ()
) -> None:
    """Raise :class:`WriteRefused` when ``target`` must not be written."""
    resolved = _key(target)
    for item in protected:
        guard = _key(Path(item))
        if resolved == guard or resolved.startswith(guard.rstrip(os.sep) + os.sep):
            raise WriteRefused(f"{target}: is an input (or inside one), never written")
    if (target.exists() or target.is_symlink()) and not overwrite:
        raise WriteRefused(f"{target}: exists, not overwritten")

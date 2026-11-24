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

:func:`atomic_write` is the writer every converter output goes through: the
guard first, then the bytes into a hidden temp file beside the target, then a
rename, so a failure part-way (a reader crash, a full disk) never leaves a
partial output behind, and an output that appeared meanwhile is never
replaced.
"""

from __future__ import annotations

import contextlib
import os
import tempfile
from collections.abc import Callable, Iterable
from pathlib import Path

__all__ = ["WriteRefused", "atomic_write", "check_target"]


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


def atomic_write(
    target: Path,
    produce: Callable[[Path], object],
    *,
    overwrite: bool = False,
    protected: Iterable[Path | str] = (),
) -> Path:
    """Write ``target`` through ``produce(temp_path)`` and publish it atomically.

    ``check_target`` runs first (:class:`WriteRefused`). ``produce`` writes the
    complete file to a temp path in the same directory (it keeps ``target``'s
    suffix, so writers that key on it behave); only when it returns is the file
    renamed into place. Any exception removes the temp file and leaves
    ``target`` untouched. Without ``overwrite`` the publish is a hard link,
    which fails if ``target`` appeared since the check (-> ``WriteRefused``);
    where hard links are unavailable it falls back to check-then-rename.
    """
    protected = list(protected)
    check_target(target, overwrite=overwrite, protected=protected)
    fd, tmp_name = tempfile.mkstemp(
        prefix=f".{target.stem[:40]}.", suffix=f".part{target.suffix}", dir=target.parent
    )
    os.close(fd)
    tmp = Path(tmp_name)
    try:
        produce(tmp)
        mask = os.umask(0)  # mkstemp makes the file 0600; a normal output follows the umask
        os.umask(mask)
        with contextlib.suppress(OSError):
            os.chmod(tmp, 0o666 & ~mask)
        if overwrite:
            os.replace(tmp, target)
            return target
        try:
            os.link(tmp, target)
        except FileExistsError as exc:
            raise WriteRefused(f"{target}: exists, not overwritten") from exc
        except OSError:  # no hard links on this file system
            check_target(target, overwrite=False, protected=protected)
            os.replace(tmp, target)
    finally:
        with contextlib.suppress(OSError):
            tmp.unlink()
    return target

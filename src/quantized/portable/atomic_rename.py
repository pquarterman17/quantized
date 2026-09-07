"""P1.7 "Pack Project" PR 5 audit follow-up — an actually atomic no-replace
rename primitive, and an honest fallback when the platform has none.

## Why ``publish.py``'s ``os.mkdir`` reservation was not a fix

The prior version of :func:`quantized.portable.publish.publish_bundle`
closed its TOCTOU window (``os.path.lexists(destination_dir)`` then
``os.rename(staging_root, destination_dir)`` are two separate syscalls)
with an ``os.mkdir(destination_dir)`` "reservation" immediately before the
rename, on the theory that ``os.mkdir`` is itself an atomic existence
check and nothing could race ahead of it. That reasoning has a hole: a
THIRD party can ``rmdir`` our just-created empty reservation and ``mkdir``
its own empty directory at the same path before our ``os.rename`` runs —
POSIX ``rename`` silently succeeds and replaces an EXISTING EMPTY
directory (unlike a non-empty one, which raises ``ENOTEMPTY``), so that
foreign directory is absorbed exactly as if the reservation had never
existed. Two syscalls with an unprotected gap between them, however
narrow, are not one atomic operation — no comment claiming otherwise
changes that.

## The actual fix: one syscall, or an honest fallback

:func:`rename_noreplace` does the existence check and the rename in a
SINGLE syscall wherever the platform provides one:

* **Linux** — glibc's ``renameat2(..., RENAME_NOREPLACE)``, invoked via
  ``ctypes`` (the standard library has no wrapper). The kernel refuses the
  whole operation atomically if anything already exists at the destination
  — there is no gap for a third party to land in.
* **macOS** — ``renamex_np(..., RENAME_EXCL)``, the Darwin equivalent,
  also invoked via ``ctypes``.
* **Windows** — plain ``os.rename`` IS the atomic no-replace primitive:
  it already refuses any existing destination outright (raising
  ``FileExistsError`` — ``WinError 183`` under the hood), unlike POSIX
  ``rename``'s "replace an empty directory" carve-out.

Where none of those is available — an old kernel/glibc without
``renameat2``, a filesystem that rejects the flag (some network/FUSE
mounts), a non-Windows/Linux/macOS platform — :func:`rename_noreplace`
raises :class:`NoReplaceUnsupported` rather than silently downgrading to
a weaker sequence. The caller (:func:`quantized.portable.publish
.publish_bundle`) decides what "weaker" means for it and reports that
choice honestly (``PublishResult.no_replace``); this module never claims
a guarantee it cannot back.

## The seam

The platform-specific implementation is reached through exactly one
module-level name, ``_platform_rename_noreplace``, selected once at
import time from ``os.name``/``sys.platform`` and looked up dynamically
(as a plain global, not bound into a closure) on every call — so a test
can ``monkeypatch.setattr`` it to a fake that models true no-replace
semantics, or one that raises :class:`NoReplaceUnsupported`, without
needing a real unsupported kernel or filesystem to exercise either path.
"""

from __future__ import annotations

import ctypes
import errno
import os
import sys
import tempfile
from collections.abc import Callable
from functools import lru_cache

__all__ = ["NoReplaceUnsupported", "rename_noreplace", "no_replace_available"]

# renameat2(2) / renamex_np(2) flag + AT_FDCWD constants -- not exposed by
# Python's stdlib `os` module (no ctypes-free way to reach either syscall).
_AT_FDCWD = -100
_RENAME_NOREPLACE = 1  # Linux
_RENAME_EXCL = 4  # macOS (renamex_np)

# errno values that mean "the kernel/filesystem does not support this
# flag/syscall" as opposed to "the rename was refused for a real reason"
# (EEXIST, EACCES, ...). ENOTSUP and EOPNOTSUPP are the same value on
# Linux/glibc but are listed separately per the platform man pages, and a
# defensive `getattr` keeps this working even where one name is absent.
_UNSUPPORTED_ERRNOS = frozenset(
    {
        errno.ENOSYS,
        errno.EINVAL,
        getattr(errno, "ENOTSUP", errno.EINVAL),
        getattr(errno, "EOPNOTSUPP", errno.EINVAL),
    }
)


class NoReplaceUnsupported(Exception):
    """Raised by the platform primitive when this platform, kernel, or
    filesystem cannot provide an atomic no-replace rename at all — never
    for an ordinary refusal (an existing destination is always
    ``FileExistsError``, never this). Callers fall back to a documented,
    non-atomic strategy and must report the weaker guarantee level."""


def _raise_from_errno(err: int) -> None:
    """Raise the right exception for a raw errno value from a rename
    syscall: ``OSError(errno, strerror)`` for a real refusal (Python's
    ``OSError.__new__`` auto-maps ``EEXIST`` to ``FileExistsError``), or
    :class:`NoReplaceUnsupported` when the errno itself means "this
    flag/syscall is not available here"."""
    if err in _UNSUPPORTED_ERRNOS:
        raise NoReplaceUnsupported(
            f"no-replace rename is not supported here (errno {err}: "
            f"{errno.errorcode.get(err, '?')})"
        )
    raise OSError(err, os.strerror(err))


def _linux_rename_noreplace(src: str, dst: str) -> None:
    try:
        libc = ctypes.CDLL(None, use_errno=True)
        renameat2 = libc.renameat2
    except (OSError, AttributeError) as exc:
        raise NoReplaceUnsupported(
            "glibc does not export a renameat2 symbol on this system"
        ) from exc
    renameat2.restype = ctypes.c_int
    renameat2.argtypes = (
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_uint,
    )
    ctypes.set_errno(0)
    rc = renameat2(
        _AT_FDCWD, os.fsencode(src), _AT_FDCWD, os.fsencode(dst), _RENAME_NOREPLACE
    )
    if rc == 0:
        return
    _raise_from_errno(ctypes.get_errno())


def _macos_rename_noreplace(src: str, dst: str) -> None:
    try:
        libc = ctypes.CDLL(None, use_errno=True)
        renamex_np = libc.renamex_np
    except (OSError, AttributeError) as exc:
        raise NoReplaceUnsupported(
            "libc does not export a renamex_np symbol on this system"
        ) from exc
    renamex_np.restype = ctypes.c_int
    renamex_np.argtypes = (ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint)
    ctypes.set_errno(0)
    rc = renamex_np(os.fsencode(src), os.fsencode(dst), _RENAME_EXCL)
    if rc == 0:
        return
    _raise_from_errno(ctypes.get_errno())


def _windows_rename_noreplace(src: str, dst: str) -> None:
    """``os.rename`` IS the atomic no-replace primitive on Windows: it
    already refuses to replace ANY existing destination (file or
    directory), unlike POSIX ``rename``'s "silently replace an empty
    directory" carve-out — there is no separate no-replace flag to ask
    for. Raises ``FileExistsError`` for an existing destination, another
    ``OSError`` otherwise."""
    os.rename(src, dst)


def _unsupported_rename_noreplace(src: str, dst: str) -> None:
    raise NoReplaceUnsupported(
        f"no atomic no-replace rename primitive is known for this platform "
        f"({sys.platform!r})"
    )


_RenameFunc = Callable[[str, str], None]


def _select_platform_primitive() -> _RenameFunc:
    if os.name == "nt":
        return _windows_rename_noreplace
    if sys.platform == "darwin":
        return _macos_rename_noreplace
    if sys.platform.startswith("linux"):
        return _linux_rename_noreplace
    return _unsupported_rename_noreplace


# The seam: looked up as a plain module global on every call (see the
# module docstring), so `monkeypatch.setattr(__name__ + "._platform_rename_noreplace", fake)`
# swaps it out for tests without needing a real unsupported platform.
_platform_rename_noreplace: _RenameFunc = _select_platform_primitive()


def rename_noreplace(src: str, dst: str) -> None:
    """Atomically rename ``src`` to ``dst``: raises ``FileExistsError`` if
    anything at all already exists at ``dst`` (file, directory — empty or
    not, symlink), another ``OSError`` on any other rename failure, and
    :class:`NoReplaceUnsupported` when this platform/kernel/filesystem has
    no atomic no-replace rename to offer at all (the caller must fall
    back to a documented, weaker strategy in that case — this function
    itself never downgrades silently). See the module docstring for the
    per-platform primitive."""
    _platform_rename_noreplace(src, dst)


def no_replace_available() -> bool:
    """Does THIS process's platform actually provide a genuine atomic
    no-replace rename right now? Windows: always ``True`` (``os.rename``
    is unconditional there). Elsewhere: a real, cheap probe — a symbol
    lookup alone cannot tell whether the RUNNING kernel/filesystem honors
    the flag (an old kernel can have the symbol but reject the flag with
    ``ENOSYS``/``EINVAL`` at call time) — so this renames a fresh, empty
    temp file onto an absent sibling path and reports whether
    :class:`NoReplaceUnsupported` came back. Cached after the first call;
    never invoked at import time (a sandboxed/read-only import environment
    must not fail just from importing this module)."""
    return _no_replace_available_cached()


@lru_cache(maxsize=1)
def _no_replace_available_cached() -> bool:
    if os.name == "nt":
        return True
    try:
        with tempfile.TemporaryDirectory(prefix=".qz-rename-probe-") as tmp:
            src = os.path.join(tmp, "src")
            dst = os.path.join(tmp, "dst")
            with open(src, "w", encoding="utf-8"):
                pass
            _platform_rename_noreplace(src, dst)
            return os.path.isfile(dst)
    except NoReplaceUnsupported:
        return False
    except OSError:
        # A transient probe failure (permissions on the temp dir, e.g.) is
        # not evidence of "unsupported" -- but it also cannot prove
        # "supported", and this is a cheap best-effort report, not a hard
        # guarantee surface. Treat it as unsupported rather than raising
        # out of what callers use purely to decide how to phrase a result.
        return False

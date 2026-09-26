"""Network-free fakes for Windows UNC paths, shared by the desktop-bridge tests.

Not a test module (no ``test_`` prefix, so pytest never collects it). Tests
import it by name, the same way ``test_calc_refl_dream.py`` imports
``test_calc_refl_fit``: pytest puts ``tests/`` on ``sys.path`` and ``tests/``
has no ``__init__``.

Why these exist: a real ``os.stat`` of ``\\\\server\\share\\file`` on Windows
goes to the SMB redirector, and what comes back depends on the host's name
resolution. A dev box answered ERROR_BAD_NETPATH (53) after ~2.8 s, which
CPython maps to ENOENT. The windows-latest/3.11 runner answered a network code
(ERROR_NETWORK_UNREACHABLE 1231, ERROR_SEM_TIMEOUT 121, ERROR_UNEXP_NET_ERR 59
and so on), which CPython maps to EINVAL, and the test failed with
``'invalid' == 'missing'``. Every test that builds a UNC path therefore goes
through :func:`install_unc_fakes`, which answers every call production makes
for a path under the fake share, so the host's network never matters.
"""

from __future__ import annotations

import errno
import os
import stat
import sys
from typing import Any

import pytest

BACKSLASH = chr(92)

# Windows error codes the tests inject. Values from winerror.h.
ERROR_FILE_NOT_FOUND = 2
ERROR_BAD_NETPATH = 53
ERROR_BAD_NET_NAME = 67
ERROR_UNEXP_NET_ERR = 59
ERROR_SEM_TIMEOUT = 121
ERROR_INVALID_PARAMETER = 87
ERROR_INVALID_NAME = 123
ERROR_NETWORK_UNREACHABLE = 1231
ERROR_NOT_AUTHENTICATED = 1244
ERROR_NO_LOGON_SERVERS = 1311
ERROR_NO_NET_OR_BAD_PATH = 1203
ERROR_LOGON_FAILURE = 1326
ERROR_CANT_RESOLVE_FILENAME = 1921

# The network codes seen on (or plausible for) a runner that cannot resolve
# the fake server. CPython maps each of them to EINVAL.
NETWORK_EINVAL_WINERRORS = (ERROR_NETWORK_UNREACHABLE, ERROR_SEM_TIMEOUT, ERROR_UNEXP_NET_ERR)

# The subset of CPython's PC/errmap.h that maps to ENOENT. Every other code
# these tests use falls through to its `default`, EINVAL.
_ENOENT_WINERRORS = frozenset({2, 3, 15, 18, 53, 67, 161, 206})


def unc_share(server: str = "qz-test-server", share: str = "share") -> str:
    """``\\\\server\\share``, built from ``chr(92)``. A quoting layer once ate
    one backslash of a literal, which left a single-backslash string. That is
    a rooted LOCAL path whose anchor is a real drive, so the test asserted the
    wrong thing without failing loudly."""
    b = BACKSLASH
    return f"{b}{b}{server}{b}{share}"


def unc_file(share_root: str, name: str = "run.dwk") -> str:
    return f"{share_root}{BACKSLASH}{name}"


def windows_oserror(winerror: int, path: str) -> OSError:
    """The OSError Windows raises for ``winerror``, reproducible on any host.

    The errno follows CPython's own mapping for the codes above, so ENOENT
    codes come back as FileNotFoundError and the rest as a plain OSError with
    EINVAL. ``winerror`` is set as an attribute rather than passed as the
    constructor's fourth argument, because POSIX ignores that argument and
    has no such attribute; production reads it with ``getattr``."""
    code = errno.ENOENT if winerror in _ENOENT_WINERRORS else errno.EINVAL
    exc = OSError(code, f"faked Windows error {winerror}", path)
    # setattr, not assignment: off Windows OSError declares no winerror.
    setattr(exc, "winerror", winerror)  # noqa: B010
    return exc


def _as_text(p: object) -> str | None:
    """``p`` as a str path, or None for anything that is not a path (a file
    descriptor, or a type ``os.stat`` would reject anyway)."""
    if isinstance(p, int):
        return None
    try:
        return os.fsdecode(p)  # type: ignore[arg-type]
    except TypeError:
        return None


def _unc_key(s: str) -> str:
    """How Windows compares UNC paths: case-insensitive, either slash."""
    return s.replace("/", BACKSLASH).casefold()


def _split_share(p: object, share_root: str) -> tuple[str, str] | None:
    """``(drive, rest)`` when ``p`` (str, bytes or PathLike) is the share root
    or a path below it, else None. The drive is the caller's own spelling,
    cut at ``len(share_root)`` before comparing, so a case fold that changes
    a string's length cannot shift the split."""
    s = _as_text(p)
    if s is None:
        return None
    n = len(share_root)
    drive, rest = s[:n], s[n:]
    if _unc_key(drive) != _unc_key(share_root) or rest[:1] not in ("", "/", BACKSLASH):
        return None
    return drive, rest


def _under_share(p: object, share_root: str) -> bool:
    return _split_share(p, share_root) is not None


def _is_share_root(p: object, share_root: str) -> bool:
    """The root itself, with or without trailing separators."""
    split = _split_share(p, share_root)
    return split is not None and split[1].strip("/" + BACKSLASH) == ""


def install_unc_fakes(
    monkeypatch: pytest.MonkeyPatch,
    share_root: str,
    *,
    mounted: bool,
    stat_winerror: int | None = None,
) -> None:
    """Make ``os`` answer for ``share_root`` the way Windows would, with no I/O.

    Contract:

    - ``os.path.splitdrive``: the share root is the drive, as ntpath reports
      for a UNC path. POSIX's splitdrive never returns a drive, so without
      this the UNC branch of ``volume_present`` is dead code off Windows.
    - ``os.path.isdir``: the share root is a directory exactly when
      ``mounted``. Nothing below the root is a directory.
    - ``os.path.realpath``: identity for paths under the share. That is what
      ntpath.realpath returns for an absolute path with no symlinks. POSIX's
      realpath does not see a leading ``\\\\`` as absolute and rewrites the
      path onto the CWD, which turns it into a local, non-UNC path.
    - ``os.stat``: never reaches the network for a path under the share. The
      root of a mounted share is a directory. Every other path raises
      :func:`windows_oserror` for ``stat_winerror``, which defaults to
      ERROR_FILE_NOT_FOUND on a mounted share and ERROR_BAD_NETPATH on an
      unmounted one. Both are FileNotFoundError. Pass a code from
      ``NETWORK_EINVAL_WINERRORS`` to model the answer a runner gets when
      its SMB lookup fails with a network error instead.

    Paths are matched after ``os.fsdecode``, so str, bytes and PathLike
    arguments are all intercepted, and the way Windows matches them: case-
    insensitively, with either slash. File descriptors are not intercepted.

    Scope: every fake is installed on the shared ``os``/``os.path`` modules,
    so it is process-wide for the duration of the test, and monkeypatch
    restores the originals at teardown. It cannot be narrowed to
    ``quantized.desktop_source_probe``: that module calls ``os.stat`` through
    the ``os`` module object, and ``os.stat`` is the same function object for
    every importer. Each fake intercepts only paths under ``share_root`` and
    delegates everything else to the real function it captured, so code that
    touches other paths during the test (``tmp_path``, the consent store,
    pytest itself) sees unchanged behaviour. Under pytest-xdist each worker
    is a separate process running one test at a time, so no other test can
    observe the patch.
    """
    real_splitdrive = os.path.splitdrive
    real_isdir = os.path.isdir
    real_realpath = os.path.realpath
    real_stat = os.stat
    if stat_winerror is None:
        stat_winerror = ERROR_FILE_NOT_FOUND if mounted else ERROR_BAD_NETPATH

    def fake_splitdrive(p: Any) -> tuple[Any, Any]:
        split = _split_share(p, share_root)
        if split is None:
            return real_splitdrive(p)
        if isinstance(os.fspath(p), bytes):
            return (os.fsencode(split[0]), os.fsencode(split[1]))
        return split

    def fake_isdir(p: Any) -> bool:
        if _is_share_root(p, share_root):
            return mounted
        if _under_share(p, share_root):
            return False
        return real_isdir(p)

    def fake_realpath(p: Any, *a: Any, **kw: Any) -> Any:
        if _under_share(p, share_root):
            return os.fspath(p)
        return real_realpath(p, *a, **kw)

    def fake_stat(p: Any, *a: Any, **kw: Any) -> os.stat_result:
        if not _under_share(p, share_root):
            return real_stat(p, *a, **kw)
        if mounted and _is_share_root(p, share_root):
            return os.stat_result((stat.S_IFDIR | 0o755, 0, 0, 1, 0, 0, 0, 0, 0, 0))
        raise windows_oserror(stat_winerror, os.fsdecode(p))

    monkeypatch.setattr(os, "stat", fake_stat)
    monkeypatch.setattr(os.path, "splitdrive", fake_splitdrive)
    monkeypatch.setattr(os.path, "isdir", fake_isdir)
    monkeypatch.setattr(os.path, "realpath", fake_realpath)


def unmounted_volume_path(monkeypatch: pytest.MonkeyPatch) -> str:
    """A path on a volume that is definitely not mounted, with no network I/O.

    Windows: a file on a UNC share that :func:`install_unc_fakes` reports as
    unmounted. Before the fakes this was a real ``\\\\no-such-server`` path,
    and its answer depended on the runner's network.

    POSIX: a path under an absent mount point below ``/mnt`` (``/Volumes`` on
    macOS). ``volume_present``'s mount-prefix branch answers from the local
    filesystem, so nothing is faked and that real branch stays covered. The
    UNC branch is covered on every host by ``test_desktop_bridge_path_shapes``.
    """
    if os.name == "nt":
        share = unc_share("no-such-server")
        install_unc_fakes(monkeypatch, share, mounted=False)
        return unc_file(share, "run.dat")
    base = "/Volumes" if sys.platform == "darwin" else "/mnt"
    return f"{base}/qz-no-such-volume/run.dat"

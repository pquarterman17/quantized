"""Source-path reachability + fingerprint probing (P1.7 box 4: "distinguish
missing / offline / changed / permission-denied source states").

Split out of :mod:`quantized.desktop_bridge` the same way
``desktop_project_file.py`` already was (see that module's own doc): this is
the cohesive, non-``self``-dependent half — neither function below touches the
pywebview window object, so both are testable completely on their own, and
keeping them here is what leaves ``desktop_bridge.py`` room under the repo's
500-line god-module ceiling.

``volume_present`` is lifted VERBATIM from ``desktop_bridge.py``'s prior
private copy (byte-identical logic, only its module changed) so
``DesktopApi.path_status`` (P1.1's existing missing-vs-offline probe, frozen
and NOT touched by this slice) and the new, richer ``probe_source_path``
below share the exact same "is the file's volume even attached" judgment —
two separately-drifting copies of that call is exactly the kind of split
this repo's decomposition discipline exists to prevent.

## The consent ruling this module's caller applies (documented fully in
``desktop_bridge.py``'s module doc; summarized here since it drives this
module's one parameter): computing a CHECKSUM means reading a file's full
bytes, which is a strictly bigger ask than the reachability check
``path_status`` already makes with no consent at all. So `probe_source_path`
takes an explicit `compute_checksum` flag — the CALLER decides whether this
path is trusted enough to read, this module never guesses.
"""

from __future__ import annotations

import errno
import hashlib
import os
import stat
from typing import Any

__all__ = ["probe_source_path", "volume_present"]

# Where POSIX mounts removable and network volumes — verbatim copy of
# desktop_bridge.py's prior private constant (see this module's own doc for
# why it moved here rather than staying duplicated).
_POSIX_VOLUME_PREFIXES = ("/Volumes", "/media", "/mnt", "/net", "/run/media")


def volume_present(resolved: str) -> bool:
    """Is the VOLUME holding ``resolved`` currently attached?

    Windows gives a directly checkable answer: every path carries a drive
    letter or a UNC share root, and if that root is not a directory the
    volume is gone.

    POSIX has no such thing — ``splitdrive`` returns nothing and the anchor is
    always ``/``, which always exists. So the check is the mount point
    instead: for a path under a standard volume prefix, the component just
    below that prefix IS the mount point, and its absence means the volume is
    not mounted.

    Outside those prefixes POSIX genuinely cannot distinguish "unmounted
    share" from "path that never existed", so this returns True and the
    caller reports ``missing``. That is the deliberate, documented limit
    rather than a guess: over-reporting ``offline`` would suppress a real
    "your file is gone", which is the more useful of the two messages to get
    right.
    """
    drive = os.path.splitdrive(resolved)[0]
    if drive:  # Windows drive letter or UNC \\server\share
        try:
            return os.path.isdir(drive + os.sep) or os.path.isdir(drive)
        except OSError:
            return False
    for prefix in _POSIX_VOLUME_PREFIXES:
        if not resolved.startswith(prefix + "/"):
            continue
        rest = resolved[len(prefix) + 1 :].split("/", 1)[0]
        if not rest:
            continue
        try:
            return os.path.isdir(os.path.join(prefix, rest))
        except OSError:
            return False
    return True  # not on a recognizable volume — cannot tell, so do not claim offline


# Windows error codes a stat can return when the network or the share
# session, not the path, is at fault. CPython maps every one of them to EINVAL
# (PC/errmap.h has no case for them, so they fall through to its `default`),
# the same errno a genuinely malformed name gets, so only `winerror` tells the
# two apart. Codes that also mean "you typed it wrong" or "wrong password"
# (ERROR_NO_NET_OR_BAD_PATH 1203, ERROR_LOGON_FAILURE 1326, ERROR_BAD_DEV_TYPE
# 66) are left out: `offline` promises the source comes back on its own, and
# hides relink. On a UNC path they still read `offline` through the UNC rule.
_WINDOWS_NETWORK_ERRORS = frozenset(
    {
        51,  # ERROR_REM_NOT_LIST
        54,  # ERROR_NETWORK_BUSY
        55,  # ERROR_DEV_NOT_EXIST
        59,  # ERROR_UNEXP_NET_ERR
        64,  # ERROR_NETNAME_DELETED
        70,  # ERROR_SHARING_PAUSED
        71,  # ERROR_REQ_NOT_ACCEP
        121,  # ERROR_SEM_TIMEOUT
        1167,  # ERROR_DEVICE_NOT_CONNECTED
        1222,  # ERROR_NO_NETWORK
        1225,  # ERROR_CONNECTION_REFUSED
        1231,  # ERROR_NETWORK_UNREACHABLE
        1232,  # ERROR_HOST_UNREACHABLE
        1236,  # ERROR_CONNECTION_ABORTED
        1244,  # ERROR_NOT_AUTHENTICATED (a lapsed share session)
        1311,  # ERROR_NO_LOGON_SERVERS
        2250,  # ERROR_NOT_CONNECTED
    }
)

# The two network codes CPython maps to ENOENT (so they arrive as
# FileNotFoundError): the server or the share name was not found. A file that
# is merely absent from a live share is ERROR_FILE_NOT_FOUND or
# ERROR_PATH_NOT_FOUND instead, so these are `offline` even when the drive's
# root still answers from a cached connection.
_WINDOWS_ENOENT_NETWORK_ERRORS = frozenset(
    {
        53,  # ERROR_BAD_NETPATH
        67,  # ERROR_BAD_NET_NAME
    }
)

# Windows error codes that say the NAME is bad, on any volume. Both map to
# EINVAL, so they have to be singled out before the UNC rule below would call
# them offline. ERROR_INVALID_PARAMETER (87) is deliberately NOT here: SMB
# redirectors and NAS firmware return it for transient server-side faults too.
_WINDOWS_MALFORMED_PATH_ERRORS = frozenset(
    {
        123,  # ERROR_INVALID_NAME ("syntax is incorrect")
        1921,  # ERROR_CANT_RESOLVE_FILENAME (a reparse-point loop)
    }
)


def _errnos(*names: str) -> frozenset[int]:
    """The named errno values this platform defines. `getattr`, because not
    every platform's errno module has all of them."""
    return frozenset(
        code for code in (getattr(errno, name, None) for name in names) if code is not None
    )


# What a dead network or FUSE mount gives a stat on POSIX.
_POSIX_NETWORK_ERRNOS = _errnos(
    "ESTALE",
    "ETIMEDOUT",
    "EHOSTDOWN",
    "EHOSTUNREACH",
    "ENETDOWN",
    "ENETUNREACH",
    "ECONNREFUSED",
    "ECONNRESET",
    "ECONNABORTED",
    "ENOTCONN",
)

# EIO is ambiguous: a Linux CIFS or soft NFS mount returns it when the server
# goes away, and so does a yanked USB drive, but a failing local disk returns
# it too, and that disk will not "come back". It counts as `offline` only
# under the removable/network mount prefixes.
def _under_volume_prefix(resolved: str) -> bool:
    return any(resolved.startswith(prefix + "/") for prefix in _POSIX_VOLUME_PREFIXES)


# Errnos that describe the path's own shape, whatever volume it is on.
_MALFORMED_PATH_ERRNOS = _errnos("ELOOP", "ENAMETOOLONG", "ENOTDIR")


def _on_network_share(resolved: str) -> bool:
    """Is ``resolved`` a UNC path (``\\\\server\\share\\...``, or its
    ``\\\\?\\UNC\\...`` / ``\\\\.\\UNC\\...`` device spellings)?

    Decided from ``os.path.splitdrive`` alone, so it never touches the
    network. POSIX's splitdrive never returns a drive, so this is always
    False there. A mapped drive letter (``Z:``) is not detectable without a
    Win32 call, which is why the ``winerror`` check below does not depend on
    this."""
    drive = os.path.splitdrive(resolved)[0].replace("/", "\\")
    if drive.startswith(("\\\\?\\", "\\\\.\\")):
        # ntpath returns `\\?\UNC\server\share` as the drive, but only
        # `\\.\UNC` for the `\\.\` spelling.
        prefix = drive[4:].upper()
        return prefix == "UNC" or prefix.startswith("UNC\\")
    return drive.startswith("\\\\")


def _classify_stat_oserror(resolved: str, exc: OSError) -> str:
    """State for an ``os.stat`` OSError that is neither ENOENT nor EACCES.

    A plain OSError is ambiguous: EINVAL is both "malformed name" and, on
    Windows, every network failure CPython has no errno for (a runner whose
    SMB lookup times out gets ERROR_SEM_TIMEOUT -> EINVAL). Treating the
    second as `invalid` offers relink or cleanup for a file whose share is
    only flaky, so the order is:

    1. A malformed-name code (Windows ``winerror``, or an errno such as
       ELOOP/ENOTDIR): the path is bad wherever it points, so the
       pre-existing rule in step 4 applies even on a UNC path.
    2. A network error code (Windows ``winerror`` or POSIX errno, plus EIO
       under a removable/network mount prefix): the file's volume is
       unreachable right now, so `offline`, even if the share root still
       answered ``isdir`` a moment ago.
    3. Any other error on a UNC path: `offline`. Everything between this
       process and the file there is network, so an unrecognised failure is
       far more likely the link than the name.
    4. Otherwise the pre-existing rule: `invalid` on a present volume,
       `offline` on an absent one.

    ``winerror`` is read with ``getattr`` because only Windows' OSError has
    the attribute."""
    winerror = getattr(exc, "winerror", None)
    malformed = winerror in _WINDOWS_MALFORMED_PATH_ERRORS or exc.errno in _MALFORMED_PATH_ERRNOS
    if not malformed:
        if winerror in _WINDOWS_NETWORK_ERRORS or exc.errno in _POSIX_NETWORK_ERRNOS:
            return "offline"
        if exc.errno == errno.EIO and _under_volume_prefix(resolved):
            return "offline"
        if _on_network_share(resolved):
            return "offline"
    return _fallback_state(resolved)


def _fallback_state(resolved: str) -> str:
    """The pre-existing rule for a stat error that names no cause: a bad path
    on a present volume, an unreachable one on an absent volume."""
    return "invalid" if volume_present(resolved) else "offline"


# Chunked so memory stays bounded regardless of file size — a project's own
# declared source is routinely a multi-hundred-MB Origin project or a large
# 2D map (L0.32's own "large 2D payloads" caveat), and this reads the WHOLE
# file to fingerprint it.
_CHECKSUM_CHUNK_BYTES = 1 << 20  # 1 MiB


def _sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(_CHECKSUM_CHUNK_BYTES), b""):
            digest.update(chunk)
    return digest.hexdigest()


def probe_source_path(resolved: str, *, compute_checksum: bool) -> dict[str, Any]:
    """Reachability + (optionally) content fingerprint of an ALREADY-resolved
    (``os.path.realpath``-normalized) path.

    Returns a dict always carrying ``state`` — one of ``ok`` / ``missing`` /
    ``offline`` / ``invalid`` / ``permission_denied`` — plus, for ``ok``,
    ``size``, ``mtime``, ``dev``, and ``ino`` (always populated: the same
    risk level as the existing consent-free ``path_status``, just four more
    stat fields) and, only when `compute_checksum` is true AND the read
    itself succeeds, a ``"sha256:<hex>"`` ``checksum``.

    ``dev``/``ino`` are ``st.st_dev``/``st.st_ino`` verbatim (``int``) — the
    filesystem-identity pair a caller (e.g.
    :mod:`quantized.portable.manifest`'s dry-run manifest builder) uses to
    prove two DIFFERENT path spellings name the SAME physical file, never to
    build a filesystem path itself. Python populates both on every platform
    this project supports, Windows included: for a regular file, ``st_dev``
    is the volume serial number and ``st_ino`` the file index, the same pair
    ``fsutil file queryfileid``/NTFS itself uses as a file's identity. A
    caller must treat ``0`` on EITHER field as "unknown identity" (never a
    real device/inode 0) and refuse to collapse on it — some platforms or
    edge-case filesystems report a zero rather than raising, and this
    function does not raise for that case, it just passes the stat result
    through as-is.

    Never raises — every failure mode below
    (permission, a vanished volume, a race where the file disappears between
    the stat and the read) degrades to a reported state, matching every other
    bridge method's "report, don't raise into JS" rule.

    ``ValueError`` is caught alongside ``OSError`` at both syscalls
    below (CI-found, Windows-only — this class is invisible on Linux/macOS,
    which degrade the same input through ``OSError`` instead): a malformed
    path (an embedded null byte, the concrete case; also a path over
    Windows' ``MAX_PATH``) makes ``os.path.realpath`` at the call site
    below succeed silently on Windows — it does no OS-level validation for
    a not-yet-resolved path — while the ACTUAL syscalls here
    (``os.stat``, then ``open`` for the checksum) DO validate, and raise
    ``ValueError: embedded null character in path`` rather than any
    ``OSError`` subtype. The realpath call itself is guarded the identical
    way at its own two call sites (``desktop_bridge.py``'s ``probe_source``/
    ``grant_source_paths``) — this docstring calls it out so the SAME
    malformed-path failure mode is provably degraded at every syscall a
    caller-supplied path reaches in this module, not just the first one.

    The two are caught together but classified differently. A ``ValueError``
    from ``os.stat`` is always a malformed path: ``invalid`` on a present
    volume, ``offline`` on an absent one. An ``OSError`` other than ENOENT or
    EACCES goes through :func:`_classify_stat_oserror`, which reads its error
    code, because on Windows a network failure and a malformed name both
    arrive as EINVAL.
    """
    try:
        st = os.stat(resolved)
    except PermissionError:
        return {"state": "permission_denied", "path": resolved}
    except FileNotFoundError as exc:
        if getattr(exc, "winerror", None) in _WINDOWS_ENOENT_NETWORK_ERRORS:
            return {"state": "offline", "path": resolved}
        return {
            "state": "missing" if volume_present(resolved) else "offline",
            "path": resolved,
        }
    except OSError as exc:
        return {"state": _classify_stat_oserror(resolved, exc), "path": resolved}
    except ValueError:
        # A malformed path (see the docstring). It never reaches
        # _classify_stat_oserror: there is no error code to read, and the
        # network cannot raise ValueError.
        return {"state": _fallback_state(resolved), "path": resolved}
    # From the stat already in hand, not os.path.isfile: a second stat is one
    # more SMB round trip, and on a flaky share its failure would come back
    # as False and be reported `invalid`.
    if not stat.S_ISREG(st.st_mode):
        return {"state": "invalid", "path": resolved}
    out: dict[str, Any] = {
        "state": "ok",
        "path": resolved,
        "size": st.st_size,
        "mtime": st.st_mtime,
        "dev": st.st_dev,
        "ino": st.st_ino,
    }
    if compute_checksum:
        try:
            out["checksum"] = f"sha256:{_sha256_file(resolved)}"
        except PermissionError:
            # Reachable via stat but not readable (an ACL that allows
            # metadata but not content, or consent lapsed between the stat
            # and the open) — report what IS known rather than failing the
            # whole probe; the caller still learns size/mtime.
            out["state"] = "permission_denied"
        except (OSError, ValueError) as exc:
            out["checksum_error"] = str(exc)
    return out

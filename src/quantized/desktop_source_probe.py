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

import hashlib
import os
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
    ``size`` and ``mtime`` (always populated: the same risk level as the
    existing consent-free ``path_status``, just two more stat fields) and,
    only when `compute_checksum` is true AND the read itself succeeds, a
    ``"sha256:<hex>"`` ``checksum``. Never raises — every failure mode below
    (permission, a vanished volume, a race where the file disappears between
    the stat and the read) degrades to a reported state, matching every other
    bridge method's "report, don't raise into JS" rule.

    ``ValueError`` is caught right alongside ``OSError`` at both syscalls
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
    """
    try:
        st = os.stat(resolved)
    except PermissionError:
        return {"state": "permission_denied", "path": resolved}
    except FileNotFoundError:
        return {
            "state": "missing" if volume_present(resolved) else "offline",
            "path": resolved,
        }
    except (OSError, ValueError):
        return {"state": "invalid", "path": resolved}
    if not os.path.isfile(resolved):
        return {"state": "invalid", "path": resolved}
    out: dict[str, Any] = {
        "state": "ok",
        "path": resolved,
        "size": st.st_size,
        "mtime": st.st_mtime,
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

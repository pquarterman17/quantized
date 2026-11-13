"""Container completeness check for Origin projects -- a DIAGNOSTIC only.

A truncated ``.opj`` (an interrupted copy or download) still parses: the
block walker stops at the first framing break, so the books and columns
before the cut import normally and the rest silently vanish (audit 2026-11:
the first third of a 4-book file imported as 3 books with partial columns,
HTTP 200, no warning). This module never changes what the reader decodes; it
only says whether the file is as long as its own header says it should be,
so the import can say "this file appears incomplete" instead of nothing.

Format fact (``docs/origin_re/validation_log.md``, "File-header block"): in
CPYA v4.3380 projects the 123-byte file-header (fh) block carries the exact
file size as a little-endian u32 at payload offset 115 -- measured on the
corpus, and the field the native writer patches
(``writer_blocks.fh_size_offset``). v4.3227 headers do not carry it, and no
size field is known for ``.opju`` (CPYUA), so those report ``checked: False``
rather than guessing. The windows/folder tree that would let us compare
"windows found vs declared" lives in the file's TAIL, which is exactly what a
truncation removes, so the recorded size is the one usable signal.

Pure ``io`` layer: bytes in, a plain dict out.
"""

from __future__ import annotations

import re
import struct
from typing import TYPE_CHECKING, Literal, TypedDict

if TYPE_CHECKING:
    from quantized.io.origin_project.fidelity import OriginFidelityManifest

__all__ = ["ContainerIntegrity", "apply_container_integrity", "container_integrity"]

_FH_LEN = 123
_FH_SIZE_OFFSET = 115
_MIN_SIZED_VERSION = 4.338  # v4.3380 measured; v4.3227 has no size field
_VERSION_RE = re.compile(rb"^CPYA (\d+\.\d+)")


class ContainerIntegrity(TypedDict):
    checked: bool
    complete: bool | None
    file_bytes: int
    declared_bytes: int | None
    detail: str


def _result(
    n: int, *, checked: bool, complete: bool | None, declared: int | None, detail: str
) -> ContainerIntegrity:
    return {
        "checked": checked,
        "complete": complete,
        "file_bytes": n,
        "declared_bytes": declared,
        "detail": detail,
    }


def container_integrity(raw: bytes, container: Literal["opj", "opju"]) -> ContainerIntegrity:
    """Compare the file's length with the size its header records."""
    n = len(raw)
    if container != "opj":
        return _result(n, checked=False, complete=None, declared=None,
                       detail="no recorded file size is known for .opju")
    m = _VERSION_RE.match(raw)
    nl = raw.find(b"\n")
    if m is None or nl < 0:
        return _result(n, checked=False, complete=None, declared=None,
                       detail="not a CPYA header")
    if float(m.group(1)) < _MIN_SIZED_VERSION:
        return _result(n, checked=False, complete=None, declared=None,
                       detail=f"CPYA {m.group(1).decode()} headers record no file size")
    fh = nl + 1
    if fh + 5 > n:
        return _result(n, checked=True, complete=False, declared=None,
                       detail="file ends inside its header")
    size = struct.unpack_from("<I", raw, fh)[0]
    if size != _FH_LEN or raw[fh + 4] != 0x0A:
        return _result(n, checked=False, complete=None, declared=None,
                       detail="unrecognized file-header block")
    if fh + 5 + _FH_SIZE_OFFSET + 4 > n:
        return _result(n, checked=True, complete=False, declared=None,
                       detail="file ends inside its header")
    declared = struct.unpack_from("<I", raw, fh + 5 + _FH_SIZE_OFFSET)[0]
    if declared == n:
        return _result(n, checked=True, complete=True, declared=declared,
                       detail="file length matches its header")
    if declared > n:
        return _result(n, checked=True, complete=False, declared=declared,
                       detail=f"file is {n} bytes but its header records {declared}")
    # Longer than recorded: data past the recorded end is not a truncation,
    # and we cannot say what it is -- report it unverified, never "complete".
    return _result(n, checked=True, complete=None, declared=declared,
                   detail=f"file is {n} bytes, longer than the {declared} its header records")


def apply_container_integrity(
    manifest: OriginFidelityManifest, raw: bytes, container: Literal["opj", "opju"]
) -> OriginFidelityManifest:
    """Return ``manifest`` (an Origin fidelity manifest dict) with a
    ``container_integrity`` entry; a file shorter than its header records
    adds the ``file_truncated`` omission and marks the import ``unresolved``
    (fail closed: books and columns past the cut are missing)."""
    integrity = container_integrity(raw, container)
    out: OriginFidelityManifest = {**manifest, "container_integrity": integrity}
    if integrity["checked"] and integrity["complete"] is False:
        out["omissions"] = sorted({*manifest["omissions"], "file_truncated"})
        out["status"] = "unresolved"
    return out

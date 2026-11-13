"""Container completeness check for Origin projects -- a DIAGNOSTIC only.

A truncated ``.opj`` (an interrupted copy or download) still parses: the
block walker stops at the first framing break, so the books and columns
before the cut import normally and the rest silently vanish (audit 2026-11:
the first third of a 4-book file imported as 3 books with partial columns,
HTTP 200, no warning). This module never changes what the reader decodes; it
only says whether the file is as long as its own header says it should be,
so the import can say "this file appears incomplete" instead of nothing.

Format fact (``docs/origin_re/validation_log.md``, "File-header block"): the
file-header (fh) block carries the exact file size as a little-endian u32 at
payload offset 115 -- the field the native writer patches
(``writer_blocks.fh_size_offset``).

**Gated to what was measured.** The check runs only for the CPYA header
versions in ``_MEASURED`` and only when the fh block has the length measured
for that version. Measured 2026-11 over every ``.opj`` in the local corpus
(``../test-data/origin``, 64 files; ``tests/test_io_origin_integrity.py``'s
``realdata`` test re-measures it and fails on any false "truncated"):

==========  =========  =====  ======================================
version     fh length  files  u32 @115 == file length
==========  =========  =====  ======================================
4.3295      123        1      1/1
4.3380      123        28     28/28
4.3386      123        1      1/1
4.3445      124        11     11/11
4.3478      124        2      2/2
4.3522      132        1      1/1
4.3551      132        6      6/6
4.3778      146        2      2/2
4.2673      39         1      no field (block shorter than 119 B)
4.2946      107        2      no field
4.3116      111        1      no field
==========  =========  =====  ======================================

(8 further ``.opj``-named files are not CPYA at all.) 52/52 files that carry
the field match exactly; zero mismatches in either direction. Of the 64
files 46 parse with the reader, and the 42 of those in a gated version all
read "complete" -- zero false "truncated" verdicts. Three versions
rest on a single file each. Any other version -- older, newer, or in between
-- reports ``checked: False`` rather than extrapolating, as does ``.opju``
(CPYUA), for which no size field is known. The windows/folder tree that
would let us compare "windows found vs declared" lives in the file's TAIL,
which is exactly what a truncation removes, so the recorded size is the one
usable signal.

Pure ``io`` layer: bytes in, a plain dict out.
"""

from __future__ import annotations

import re
import struct
from typing import TYPE_CHECKING, Literal, TypedDict

if TYPE_CHECKING:
    from quantized.io.origin_project.fidelity import OriginFidelityManifest

__all__ = ["ContainerIntegrity", "apply_container_integrity", "container_integrity"]

_FH_SIZE_OFFSET = 115
# CPYA header version -> its measured fh block length (module docstring).
_MEASURED: dict[str, int] = {
    "4.3295": 123,
    "4.3380": 123,
    "4.3386": 123,
    "4.3445": 124,
    "4.3478": 124,
    "4.3522": 132,
    "4.3551": 132,
    "4.3778": 146,
}
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
    version = m.group(1).decode()
    fh_len = _MEASURED.get(version)
    if fh_len is None:
        return _result(n, checked=False, complete=None, declared=None,
                       detail=f"no measured file-size field for CPYA {version} headers")
    fh = nl + 1
    if fh + 5 > n:
        return _result(n, checked=True, complete=False, declared=None,
                       detail="file ends inside its header")
    size = struct.unpack_from("<I", raw, fh)[0]
    if size != fh_len or raw[fh + 4] != 0x0A:
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

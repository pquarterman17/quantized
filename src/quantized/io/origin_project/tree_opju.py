"""``.opju`` (CPYUA) Project Explorer folder tree decode.

Split out of ``tree.py`` (the ``.opj`` decoder) to stay under the module
ceiling; it reuses that module's shared ``_FolderNode`` + ``_flatten``.

SOLVED for both known container sub-versions (4.3811, what OriginPro 2026b
writes, and the older 4.3380 corpus). The CPYUA tail reuses ``.opj``'s
name-block framing but its own everything-else: each folder record is
``<name-block> <attrs/storage> <2*nwin> [00] {window-entry} <2*nsub>
{SEP <16 date bytes> subfolder}``, where a window entry is ``80 01 85 00``
(ordinal 0) or ``80 04 81 <len> <ordinal LE> 80 00`` (ordinal >= 1), and the
0-based window-stream ordinal indexes the windows (Origin writes headers
grouped by folder, so members precede root-level ones). The two versions
differ only in *where* the count sits (4.3811: right after the ``0A 02 75 62
0A`` "ub" attrs; 4.3380: after a ``<OriginStorage/>`` block) and the SEP bytes
(``80 12 8d 10`` / ``80 16 03 00 00 01 8a 10``), so one parser handles both: it
locates the count by scanning for ``0A <2*nwin> [00] <entries>`` validated by a
clean entry run, matches either SEP, and enumerates windows by the ``0A``-framed
page header ``0A [00] 80 <type> <namelen+2> 00 00 <name> <hi>`` — the leading
``0A`` separates a true page header from a dataset-curve record (a graph's
``FitLine``), ``namelen >= 2`` rejects 1-byte coincidental matches, and the type
byte is NOT used (unstable across files). The tree is rebuilt from *preorder +
per-folder child count* (a structural invariant: arbitrary depth, empty folders,
duplicate/unicode/spaced names). Validated byte-exact vs live COM on all 5
corpus files (incl. the 39-book ``Hc2 data`` with report-table windows and
nested folders) plus 11 controlled 4.3811 specimens. Fail-closed: an ordinal
past the window list, an inconsistent child count, or any framing mismatch
returns ``{}`` (flat import). Ordinals are read as 1 byte (>255 windows degrades
to flat); a 4.3380 empty *leaf* folder is recovered only via its introducing
SEP.
"""

from __future__ import annotations

import re
import struct

from quantized.io.origin_project.tree import _flatten, _FolderNode

__all__ = ["opju_folder_paths"]

# The subfolder separator precedes every child folder record: 4.3811 uses the
# short form, 4.3380 the long one. Either shape also marks "leaf" when it lands
# immediately after a folder's window entries (see _opju_peek_nsub).
_OPJU_SEPS = (b"\x80\x12\x8d\x10", b"\x80\x16\x03\x00\x00\x01\x8a\x10")
# Window/page header: 0A [00] 80 <type> <namelen+2> 00 00 <name> <hi-bit byte>.
# The leading 0A is the record framing that tells a true page header apart from
# a dataset-curve record (a graph's "FitLine" fit result lacks it). The name
# span is driven by the <namelen+2> length prefix itself — NOT by a regex
# length window (the old {1,39} bound was a corpus maximum: a >40-char or
# 1-char window name was silently skipped, and a skipped page header doesn't
# just lose that window — every column record inside its span is attributed
# to the PREVIOUS page, i.e. the wrong book; 2026-07-06 genericity audit).
# The name charset + the trailing hi-bit byte remain the validity gates.
# Order = the 0-based ordinal the folder tree references (Origin writes
# headers grouped by folder, depth-first).
_OPJU_WIN_HEAD_RE = re.compile(rb"\x0a\x00?\x80.(.)\x00\x00", re.DOTALL)
_OPJU_WIN_NAME_RE = re.compile(rb"[A-Za-z0-9][A-Za-z0-9_-]*\Z")


def iter_opju_windows(b: bytes) -> list[tuple[int, str]]:
    """Every page header as ``(match_offset, name)``, file-stream order,
    first occurrence per name. Shared by the folder tree (ordinal order)
    and ``opju_figure_curves.opju_pages`` (span scoping)."""
    out: list[tuple[int, str]] = []
    seen: set[str] = set()
    for m in _OPJU_WIN_HEAD_RE.finditer(b):
        nlen = m.group(1)[0] - 2
        if nlen < 1:
            continue
        raw = b[m.end() : m.end() + nlen]
        if len(raw) < nlen or not _OPJU_WIN_NAME_RE.fullmatch(raw):
            continue
        trail = b[m.end() + nlen : m.end() + nlen + 1]
        if not trail or trail[0] < 0x80:
            continue
        name = raw.decode("latin1")
        if name not in seen:
            seen.add(name)
            out.append((m.start(), name))
    return out


def _enumerate_opju_windows(b: bytes) -> list[str]:
    """Window (worksheet/graph/table) names in file-stream = ordinal order."""
    return [name for _pos, name in iter_opju_windows(b)]


def _opju_read_entries(b: bytes, q: int, nwin: int, hi: int) -> tuple[list[int] | None, int]:
    """Parse ``nwin`` window entries at ``q``; ``(None, q)`` on the first byte
    that isn't a valid entry — so a candidate count position whose bytes don't
    form a clean entry run is rejected rather than mis-read."""
    ords: list[int] = []
    n = len(b)
    for k in range(nwin):
        if b[q : q + 3] == b"\x80\x01\x85":  # ordinal 0 (short form)
            ords.append(0)
            q += 4
        elif b[q : q + 3] == b"\x80\x04\x81":  # ordinal >= 1 (1-byte tagged value)
            ln = b[q + 3]
            ords.append(int.from_bytes(b[q + 4 : q + 4 + ln], "little"))
            q += 4 + ln + 2
        else:
            return None, q
        if k < nwin - 1 and q < n and b[q] == 0x00:  # inter-entry separator
            q += 1
        if q > hi:
            return None, q
    return ords, q


def _opju_peek_nsub(b: bytes, p: int) -> tuple[int, bool]:
    """Subfolder count at ``p``: a separator here => leaf (0, it's an
    ancestor's); ``<2*nsub>`` then a separator => that many children. The bool
    reports whether a separator was seen (used to accept a 0-window count)."""
    for sep in _OPJU_SEPS:
        if b[p : p + len(sep)] == sep:
            return 0, True
    for sep in _OPJU_SEPS:
        if p < len(b) and b[p] % 2 == 0 and b[p + 1 : p + 1 + len(sep)] == sep:
            return b[p] // 2, True
    return 0, False


def _parse_opju_folder_seq(b: bytes) -> list[tuple[str, list[int], int]]:
    """Preorder ``(name, [ordinals], subfolder_count)`` per folder record.

    Each folder's window count is found by scanning for ``0A <2*nwin> [00]
    <entries>`` validated by a clean entry run — 4.3811 puts it just after the
    "ub" attrs, 4.3380 after a ``<OriginStorage/>`` block, so no fixed anchor
    works. A folder with no entries is accepted only when a subfolder separator
    precedes its name block (a real empty folder is always introduced by one),
    which keeps stray data that looks like a name block from becoming a phantom
    folder. Returns ``[]`` when nothing parses (caller degrades to flat).
    """
    blocks: list[tuple[int, int, str]] = []
    n = len(b)
    i = 0
    while i < n - 8:
        size = int.from_bytes(b[i : i + 4], "little")
        if (
            1 <= size <= 64
            and b[i + 4] == 0x0A
            and b[i + 4 + size] == 0x00
            and b[i + 5 + size] == 0x0A
        ):
            blocks.append((i, i + 5 + size + 1, b[i + 5 : i + 4 + size].decode("latin1")))
            i = i + 5 + size
            continue
        i += 1
    seq: list[tuple[str, list[int], int]] = []
    for bi, (start, name_end, name) in enumerate(blocks):
        hi = blocks[bi + 1][0] if bi + 1 < len(blocks) else n
        found: tuple[str, list[int], int] | None = None
        p = name_end
        while p < hi - 1:
            if b[p] == 0x0A and b[p + 1] % 2 == 0:
                nwin = b[p + 1] // 2
                q = p + 2
                if q < n and b[q] == 0x00:  # optional separator before entries
                    q += 1
                ords, qend = _opju_read_entries(b, q, nwin, hi)
                if ords is not None:
                    nsub, has_sep = _opju_peek_nsub(b, qend)
                    if nwin > 0 or has_sep:
                        found = (name, ords, nsub)
                        break
            p += 1
        if found is None and any(sep in b[max(0, start - 28) : start] for sep in _OPJU_SEPS):
            found = (name, [], 0)  # SEP-introduced empty folder
        if found is not None:
            seq.append(found)
    return seq


def _reconstruct_opju(seq: list[tuple[str, list[int], int]]) -> _FolderNode | None:
    """Rebuild the folder tree from the preorder + per-folder child counts.

    Returns ``None`` if the sequence isn't a consistent tree (every non-root
    folder must be exactly one folder's child) — fail-closed, never a guess.
    """
    if sum(nsub for _n, _o, nsub in seq) != len(seq) - 1:
        return None
    nodes = [_FolderNode(name=nm, windows=list(ords)) for nm, ords, _ns in seq]
    stack: list[list[int]] = [[0, seq[0][2]]]
    idx = 1
    while idx < len(seq) and stack:
        frame = stack[-1]
        if frame[1] <= 0:
            stack.pop()
            continue
        frame[1] -= 1
        nodes[frame[0]].subfolders.append(nodes[idx])
        stack.append([idx, seq[idx][2]])
        idx += 1
    if idx != len(seq):
        return None
    return nodes[0]


def opju_folder_paths(b: bytes) -> dict[str, list[str]]:
    """Map every ``.opju`` window's short name to its Project Explorer path.

    Root-exclusive, same contract as :func:`quantized.io.origin_project.tree.
    opj_folder_paths` (a book in the project root maps to ``[]``; strays are
    absent). Decodes the CPYUA folder tree for both container sub-versions
    (4.3811 and 4.3380 — see the module docstring); other/newer containers and
    any framing or consistency mismatch return ``{}`` so the import degrades to
    a flat project folder rather than a guess. Never raises.
    """
    try:
        seq = _parse_opju_folder_seq(b)
        if not seq:
            return {}
        root = _reconstruct_opju(seq)
        if root is None:
            return {}
        names = _enumerate_opju_windows(b)
        max_ord = max((o for _n, ords, _ns in seq for o in ords), default=-1)
        # every referenced ordinal must resolve — otherwise the window
        # enumeration is incomplete and any mapping would be wrong.
        if max_ord >= len(names):
            return {}
        out: dict[str, list[str]] = {}
        _flatten(root, names, (), out)
        return out
    except (IndexError, UnicodeDecodeError, struct.error, ValueError, RecursionError):
        return {}

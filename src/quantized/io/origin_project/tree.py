"""Origin *Project Explorer* folder tree — which folder each window lives in.

``.opj`` (CPYA) — SOLVED and validated general (not sample-tuned): the tail
of the file (after the datasets+windows block stream) is::

    <params: name\\n f64 \\n, repeated, terminated by a lone 0x00>
    NULL-block, <project-record block (size varies)>
    <notes: name-block + content-block, repeated, terminated by a NULL block>
    <blk4 scalar> <blk16 ids>
    <folder>                      -- the root folder, recursively

    folder := <hdr32: 32-byte block, zeros + 2 f64 dates>
              NULL
              <name-block: NUL-terminated folder name, any bytes/length>
              <bare u32 LE == 2><0x0A>          -- fixed marker, no payload
              <attrs block>  <storage block>    -- sizes vary; skipped as-is
              <nwin: u32>
              {NULL <8-byte (u32 flags, u32 ordinal)> NULL} * nwin
              <nsub: u32>
              {folder} * nsub                   -- recursion; no root closer

Windows are referenced by their **0-based ordinal into the file's window-
header stream order** (every worksheet AND graph window counts, in the
order their header block appears) — not by name, not by offset. This is a
real recursive parse: nesting depth, per-folder window/subfolder counts,
and folder names are never hard-coded, only the block *shapes* are (and
those are self-describing — each block carries its own byte length).
Validated byte-exact (0 mismatches) against the full window->folder-path
mapping COM reports for 7 structurally diverse real projects (611 windows
total): trivial (``SuperlatticeFits``, 6 sibling folders), root-level
windows mixed with folders (``MnN_Diffusion_PNR``), 4-5 levels of nesting
with duplicate folder names at different parents and empty intermediate
folders (``PNR``, ``XMCD``), and both container sub-versions (CPYA
4.3227 ``XRD``/4.3380 ``Moke``).

Window-name enumeration is its own small hazard: a window's short name can
legitimately start with a digit (e.g. ``"30nmADPNR"``), and a purely
byte-shape-based scan can also collide with an ordinary 10-byte-record data
block that happens to start ``00 00`` and look printable for a few bytes.
Requiring the extracted name to fully match a plain identifier charset
(``[A-Za-z0-9][A-Za-z0-9_-]*``) resolves both: real Origin window names use
only that charset (verified across every project in the corpus), while the
rare data-block collisions always contain a space or punctuation the regex
rejects. This was found and fixed against ``MnN_Diffusion_PNR.opj`` (6
digit-led graph names were silently dropped by an alpha-only heuristic,
shifting every later ordinal by an accumulating offset) and ``hc2convert.opj``
/``XMCD.opj`` (single-character false-positive collisions inside the
datasets section).

``.opju`` (CPYUA) — SOLVED for the current container sub-version (4.3811,
what OriginPro 2026b writes); see :func:`opju_folder_paths`. The CPYUA tail
reuses ``.opj``'s name-block framing (``<u32 size><0x0A><NUL-terminated
name><0x0A>``) but everything else differs: each folder record is
``<name-block> <fixed attrs ending 0A 02 75 62 0A ("ub")> <2*nwin>
[00] {window-entry} <2*nsub> {SEP <16 date bytes> subfolder}``, where a
window entry is ``80 01 85 00`` for ordinal 0 or ``80 04 81 <len> <ordinal
LE> 80 00`` for ordinal >= 1, ``SEP`` is ``80 12 8d 10``, and the same
0-based window-stream ordinal indexes the windows (Origin writes headers
grouped by folder, so members precede root-level windows). The tree is
rebuilt from the *preorder + per-folder child count* (a structural
invariant — arbitrary depth, empty folders, and duplicate/unicode/spaced
names all parse), validated byte-exact against live COM on 11 controlled
specimens (flat, sibling, nested, 3-level, skipped/reordered ordinals, a
graph inside a folder, an empty folder). The **older 4.3380 CPYUA**
container (the current sample corpus) stores folder membership *outside* the
binary folder record — its folder record lacks the ``ub`` window list
entirely — and is NOT yet decoded; such files degrade cleanly to a flat
import (every book ``origin_folder_path: []``) because the 4.3811 grammar's
anchors are simply absent, never mis-parsed. This is fail-closed by
construction: any framing/consistency mismatch returns ``{}``, never a
guess.
"""

from __future__ import annotations

import re
import struct
from dataclasses import dataclass, field

from quantized.io.origin_project.container import walk_blocks

__all__ = ["opj_folder_paths", "opju_folder_paths"]

# A plain Origin window (page) short name: verified against every window name
# in a 12-file corpus (.opj + .opju) via live COM enumeration — always
# `[A-Za-z0-9_-]`, never a space or other punctuation (folder names, unlike
# window names, CAN have spaces/parens/unicode — see `_read_cstring`).
_WINDOW_NAME_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{1,39}")


class _TailParseError(ValueError):
    """The tail doesn't match the expected grammar at this byte position.

    Always caught at the top level (:func:`_parse_opj_tree`) — a folder-tree
    parse failure must never crash the caller or fall back to a guess, only
    to an empty mapping (every book then defaults to ``origin_folder_path:
    []``, same as a project that never used folders at all).
    """


@dataclass
class _FolderNode:
    name: str
    windows: list[int] = field(default_factory=list)
    subfolders: list[_FolderNode] = field(default_factory=list)


def _enumerate_window_names(b: bytes) -> list[str]:
    """Every window (worksheet or graph) header name, in file stream order.

    A window header block is >=150 bytes, starts ``00 00``, and carries a
    NUL-terminated name at offset 2 (see ``windows.py``'s ``_is_window_header``
    for the ``.opj`` reader's own, looser version of this check — this is a
    stricter, purpose-built variant: see the module docstring for why).
    """
    names: list[str] = []
    for size, payload in walk_blocks(b):
        if size == 0 or len(payload) < 150 or payload[0] or payload[1]:
            continue
        end = payload.find(b"\x00", 2, 34)
        if end <= 2:
            continue
        raw = payload[2:end]
        if not all(0x20 <= c < 0x7F for c in raw):
            continue
        name = raw.decode("latin1")
        if _WINDOW_NAME_RE.fullmatch(name):
            names.append(name)
    return names


def _read_block(b: bytes, p: int) -> tuple[int, bytes, int]:
    """One ``<u32 size LE><0x0A><payload><0x0A>`` block (or a 5-byte ``size==0``
    spacer); returns ``(size, payload, next_pos)``. Raises on any framing
    mismatch or out-of-bounds read — the caller always treats that as "stop,
    don't guess"."""
    if p + 5 > len(b):
        raise _TailParseError(f"truncated at {p}")
    size = int.from_bytes(b[p : p + 4], "little")
    if b[p + 4] != 0x0A:
        raise _TailParseError(f"bad block framing at {p}")
    if size == 0:
        return 0, b"", p + 5
    end = p + 5 + size
    if end >= len(b) or b[end] != 0x0A:
        raise _TailParseError(f"bad block closing framing at {p} (size={size})")
    return size, b[p + 5 : end], end + 1


def _find_tail_start(b: bytes) -> int:
    """Byte position right after the datasets+windows block stream ends.

    ``walk_blocks`` already stops the instant the ``<u32><0x0A>`` framing
    breaks (see ``container.py``) — that first break is exactly where the
    free-text "Parameters" section begins (plan-item 34's stream model).
    """
    nl = b.find(b"\n")
    if nl < 0:
        raise _TailParseError("no header line")
    pos = nl + 1
    for size, _payload in walk_blocks(b):
        pos += 5 if size == 0 else 5 + size + 1
    return pos


def _skip_params(b: bytes, p: int) -> int:
    """The free-text ``<name>\\n<f64:8 bytes>\\n`` run (any count, including
    zero), terminated by a lone non-printable byte (a bare ``0x00``) whose
    line is consumed through its own trailing newline."""
    n = len(b)
    while True:
        e = b.find(b"\n", p)
        if e < 0:
            raise _TailParseError("params section never terminates")
        line = b[p:e]
        if not line or not all(0x20 <= c < 0x7F for c in line):
            return e + 1
        p = e + 1 + 8
        if p >= n or b[p] != 0x0A:
            raise _TailParseError(f"expected newline after param value at {p}")
        p += 1


def _skip_project_record(b: bytes, p: int) -> int:
    """A NULL block, then one opaque "project record" block (size varies —
    88 bytes is the common case, but not asserted; see the module docstring:
    only the *shape*, never a specific byte count, is trusted)."""
    size, _payload, p = _read_block(b, p)
    if size != 0:
        raise _TailParseError("expected NULL block before the project record")
    _size, _payload, p = _read_block(b, p)
    return p


def _skip_notes(b: bytes, p: int) -> int:
    """Zero or more ``name-block + content-block`` note pairs, terminated by
    a NULL block (the count is never hard-coded — real projects range from
    zero notes to one ``ResultsLog``; the loop reads however many there
    are)."""
    while True:
        size, _payload, p2 = _read_block(b, p)
        if size == 0:
            return p2
        p = p2
        _size2, _content, p2 = _read_block(b, p)
        p = p2


def _read_cstring_block(b: bytes, p: int) -> tuple[str, int]:
    """A folder name-block's text, decoded latin1 (byte-preserving, like every
    other name decode in this reader family -- ``windows.py``'s ``_cstring``).
    Any byte value round-trips exactly; genuine multi-byte Unicode (CJK,
    emoji) folder names are not specially handled and may come back as
    mojibake rather than crash or being guessed at -- an inherited
    limitation, not one introduced here."""
    size, payload, p = _read_block(b, p)
    if size == 0:
        raise _TailParseError("expected a name block, got NULL")
    return payload.rstrip(b"\x00").decode("latin1", errors="replace"), p


def _parse_folder(b: bytes, p: int) -> tuple[_FolderNode, int]:
    """One ``folder`` record (module docstring), recursing into ``nsub``
    children. Depth and per-folder window/subfolder counts are read from the
    file, not assumed — this is what makes the parse general rather than a
    scan tuned to any one sample's shape."""
    size, _payload, p = _read_block(b, p)
    if size != 32:
        raise _TailParseError(f"expected the 32-byte folder header at {p}")
    size, _payload, p = _read_block(b, p)
    if size != 0:
        raise _TailParseError("expected NULL after the folder header")
    name, p = _read_cstring_block(b, p)

    if p + 5 > len(b):
        raise _TailParseError(f"truncated bare-u32 marker at {p}")
    marker = int.from_bytes(b[p : p + 4], "little")
    if marker != 2 or b[p + 4] != 0x0A:
        raise _TailParseError(f"expected the bare u32==2 marker at {p}")
    p += 5

    _size, _payload, p = _read_block(b, p)  # attrs block (size varies)
    _size, _payload, p = _read_block(b, p)  # storage block (size varies)

    size, payload, p = _read_block(b, p)
    if size != 4:
        raise _TailParseError(f"expected the window-count scalar at {p}")
    nwin = int.from_bytes(payload, "little")

    ordinals: list[int] = []
    for _ in range(nwin):
        s0, _p0, p = _read_block(b, p)
        if s0 != 0:
            raise _TailParseError("expected NULL before a window entry")
        s1, payload1, p = _read_block(b, p)
        if s1 != 8:
            raise _TailParseError(f"expected an 8-byte window entry at {p}")
        _flags, ordinal = struct.unpack("<II", payload1)
        ordinals.append(ordinal)
        s2, _p2, p = _read_block(b, p)
        if s2 != 0:
            raise _TailParseError("expected NULL after a window entry")

    size, payload, p = _read_block(b, p)
    if size != 4:
        raise _TailParseError(f"expected the subfolder-count scalar at {p}")
    nsub = int.from_bytes(payload, "little")

    subfolders: list[_FolderNode] = []
    for _ in range(nsub):
        child, p = _parse_folder(b, p)
        subfolders.append(child)

    return _FolderNode(name=name, windows=ordinals, subfolders=subfolders), p


def _parse_opj_tree(b: bytes) -> _FolderNode | None:
    try:
        p = _find_tail_start(b)
        p = _skip_params(b, p)
        p = _skip_project_record(b, p)
        p = _skip_notes(b, p)
        _size, _payload, p = _read_block(b, p)  # leading scalar (unused)
        _size, _payload, p = _read_block(b, p)  # id blob (unused)
        root, _p = _parse_folder(b, p)
        return root
    except (_TailParseError, UnicodeDecodeError, struct.error):
        return None


def _flatten(
    node: _FolderNode,
    names: list[str],
    path: tuple[str, ...],
    out: dict[str, list[str]],
) -> None:
    for ordinal in node.windows:
        if 0 <= ordinal < len(names):
            out.setdefault(names[ordinal], list(path))
    for sub in node.subfolders:
        _flatten(sub, names, path + (sub.name,), out)


def opj_folder_paths(b: bytes) -> dict[str, list[str]]:
    """Map every window's short name to its Project Explorer folder path.

    The path is root-exclusive (a window sitting directly in the project's
    root folder maps to ``[]``) and lists ancestor folder names from the
    root down. A window that never appears in any folder's window list (a
    "stray" window some real projects have, e.g. an auto-generated report
    table never dragged into a folder) is simply absent from the returned
    mapping — the caller treats that the same as "no folder tree at all":
    default to ``[]``, never guess. Returns ``{}`` when the tail can't be
    parsed (older/corrupt/unexpected containers) — never raises.
    """
    root = _parse_opj_tree(b)
    if root is None:
        return {}
    names = _enumerate_window_names(b)
    out: dict[str, list[str]] = {}
    _flatten(root, names, (), out)
    return out


# --- CPYUA (.opju) 4.3811 folder tree ---------------------------------------
_OPJU_UB = b"\x0a\x02\x75\x62\x0a"  # fixed attrs terminator, right before 2*nwin
_OPJU_SEP = b"\x80\x12\x8d\x10"  # subfolder separator (precedes each child)
# window header: 0A 00 80 <type> <n> 00 00 <name> <byte with high bit set>.
# same identifier-charset rule as the .opj side keeps data blocks that happen
# to start 00 00 from masquerading as window names (see module docstring).
_OPJU_WIN_RE = re.compile(
    rb"\x0a\x00\x80[\x00-\xff][\x00-\xff]\x00\x00"
    rb"([A-Za-z0-9][A-Za-z0-9_-]{0,39})[\x80-\xff]"
)


def _enumerate_opju_windows(b: bytes) -> list[str]:
    """Window (worksheet/graph) short names in file-stream order for CPYUA.

    The order is exactly the 0-based ordinal the folder tree references:
    Origin writes window headers grouped by folder (depth-first), so a
    folder's members precede root-level windows.
    """
    return [m.group(1).decode("latin1") for m in _OPJU_WIN_RE.finditer(b)]


def _parse_opju_folder_seq(b: bytes) -> list[tuple[str, list[int], int]]:
    """Preorder ``(name, [window ordinals], subfolder_count)`` per folder.

    Empty when the file carries no 4.3811-style tree (older CPYUA containers
    store folder membership elsewhere; their folder records lack the ``ub``
    anchor, so nothing matches and the caller degrades to a flat import).
    Raises no exceptions the caller doesn't already trap.
    """
    seq: list[tuple[str, list[int], int]] = []
    n = len(b)
    i = 0
    while i < n - 8:
        size = int.from_bytes(b[i : i + 4], "little")
        # folder name block: <u32 size><0A><name (size bytes, NUL-terminated)><0A>
        if not (
            1 <= size <= 64
            and b[i + 4] == 0x0A
            and b[i + 4 + size] == 0x00
            and b[i + 5 + size] == 0x0A
        ):
            i += 1
            continue
        name = b[i + 5 : i + 4 + size].decode("latin1")
        # the fixed "ub" attrs anchor must follow within the folder header
        ub = b.find(_OPJU_UB, i + 5 + size, i + 5 + size + 64)
        if ub == -1:
            i += 1
            continue
        p = ub + len(_OPJU_UB)
        nwin = b[p] // 2
        p += 1
        if b[p] == 0x00:  # separator before the first window entry
            p += 1
        ords: list[int] = []
        ok = True
        for k in range(nwin):
            if b[p : p + 3] == b"\x80\x01\x85":  # ordinal 0 (short form)
                ords.append(0)
                p += 4
            elif b[p : p + 3] == b"\x80\x04\x81":  # ordinal >= 1 (tagged LE value)
                ln = b[p + 3]
                ords.append(int.from_bytes(b[p + 4 : p + 4 + ln], "little"))
                p += 4 + ln + 2
            else:
                ok = False
                break
            if k < nwin - 1 and b[p] == 0x00:  # inter-entry separator
                p += 1
        if not ok:
            i += 1
            continue
        # subfolder count: SEP right here => leaf (SEP is an ancestor's);
        # <2*nsub> then SEP => that many direct children.
        if b[p : p + 4] == _OPJU_SEP:
            nsub = 0
        elif b[p] % 2 == 0 and b[p + 1 : p + 5] == _OPJU_SEP:
            nsub = b[p] // 2
        else:
            nsub = 0
        seq.append((name, ords, nsub))
        i = i + 5 + size
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

    Root-exclusive, same contract as :func:`opj_folder_paths` (a book in the
    project root maps to ``[]``; strays are absent). Decodes the CPYUA 4.3811
    tree (see the module docstring); older/other CPYUA containers and any
    framing or consistency mismatch return ``{}`` so the import degrades to a
    flat project folder rather than a guess. Never raises.
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
    except (IndexError, UnicodeDecodeError, struct.error, ValueError):
        return {}

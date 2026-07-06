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

The ``.opju`` (CPYUA) folder tree — which reuses this module's shared
``_FolderNode`` + ``_flatten`` — lives in the sibling ``tree_opju.py``
(:func:`~quantized.io.origin_project.tree_opju.opju_folder_paths`), split out
to keep each module under the size ceiling.
"""

from __future__ import annotations

import re
import struct
from dataclasses import dataclass, field

from quantized.io.origin_project.container import walk_blocks

__all__ = ["opj_folder_paths"]

# A plain Origin window (page) short name: verified against every window name
# in a 12-file corpus (.opj + .opju) via live COM enumeration — always
# `[A-Za-z0-9_-]`, never a space or other punctuation (folder names, unlike
# window names, CAN have spaces/parens/unicode — see `_read_cstring`).
# Length 1+ (a window renamed to a single letter is legal in Origin; a
# 2-char minimum would skip it and shift every later window's ordinal — the
# same accumulating-offset bug class the digit-led fix addressed).
_WINDOW_NAME_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,62}")


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
        end = payload.find(b"\x00", 2, 66)
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
    except (_TailParseError, UnicodeDecodeError, struct.error, RecursionError):
        # RecursionError: a pathologically deep folder chain — degrade to flat.
        return None


def _flatten(
    node: _FolderNode,
    names: list[str],
    path: tuple[str, ...],
    out: dict[str, list[str]],
) -> None:
    # Iterative pre-order (explicit stack) so a pathologically deep chain can't
    # hit the recursion limit and break the callers' never-raises contract.
    # Push reversed → siblings pop left-to-right (keeps first-write-wins order).
    stack: list[tuple[_FolderNode, tuple[str, ...]]] = [(node, path)]
    while stack:
        cur, cur_path = stack.pop()
        for ordinal in cur.windows:
            if 0 <= ordinal < len(names):
                out.setdefault(names[ordinal], list(cur_path))
        for sub in reversed(cur.subfolders):
            stack.append((sub, cur_path + (sub.name,)))


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
    # Fail-closed cross-check: the tree's ordinals index into the enumerated
    # name list positionally, so an ordinal past the end PROVES the name
    # enumeration missed at least one window header — every later name would
    # be attributed to the wrong window. Degrade to "no tree" rather than
    # ship misattributed folder paths.
    max_ordinal = max(
        (o for node in _iter_nodes(root) for o in node.windows), default=-1
    )
    if max_ordinal >= len(names):
        return {}
    out: dict[str, list[str]] = {}
    _flatten(root, names, (), out)
    return out


def _iter_nodes(root: _FolderNode) -> list[_FolderNode]:
    """Every folder node, iteratively (same no-recursion rationale as
    ``_flatten``)."""
    out: list[_FolderNode] = []
    stack: list[_FolderNode] = [root]
    while stack:
        cur = stack.pop()
        out.append(cur)
        stack.extend(cur.subfolders)
    return out


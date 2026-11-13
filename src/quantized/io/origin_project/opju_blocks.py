"""CPYUA (``.opju``) dataset *headers*: the run-length block codec and the
147-byte column-storage header it carries.

Derived clean-room from byte evidence only (no GPL reader code was consulted;
the third-party readers' *test assertions* and their paired ``.opj``/``.opju``
specimens served as the value oracle — see ``docs/origin_project_format.md``
§3.5). The controlled specimen is the pairing itself: the same project saved
in both containers stores the SAME 147-byte column header, verbatim in
``.opj`` and run-length-coded in ``.opju``, so the ``.opju`` token stream can
be decoded and checked byte-for-byte against the ``.opj`` header.

Block framing::

    80 <clen:varint> <clen bytes of tokens>

Token stream (each token is one byte, optionally followed by payload):

* ``t < 0x80``  — ``t`` literal bytes follow;
* ``0x80 | k``  — a run of ``k + 3`` zero bytes (``k`` in 0..63);
* ``0xC0 | k``  — a run of ``k + 3`` copies of the ONE fill byte that follows.

A dataset header always expands to exactly 147 bytes (the ``.opj`` header
length) with the NUL-terminated dataset name at offset ``0x58``; that pair of
facts is the validity gate — a random ``80 xx`` byte pair inside compressed
column data essentially never satisfies both.

Header fields used (offsets into the expanded 147 bytes, all little-endian;
each one read off the paired specimens and cross-checked against the test
oracle's per-column expectations):

======  =====  ==============================================================
offset  width  meaning
======  =====  ==============================================================
0x17    1      storage-class bits: ``&0x01`` Text&Numeric cells, ``&0x02``
               complex, ``&0x08`` integer; the high nibble follows the plot
               designation and is not used here
0x19    4      allocated row count (equals the record's own row varint)
0x21    4      used-row extent — one past the last filled row
0x3D    1      element width in bytes (10 = Text&Numeric cell, 8 double,
               4 float32/int32, 2 int16, 1 int8, 16 complex; other widths
               are fixed-width Text columns or report-sheet records)
0x3F    1      ``&0x08`` unsigned (integer storage classes only)
0x58    ..     dataset name, NUL-terminated (``Book_Col[@sheet]`` for a
               worksheet column, a bare book name for a matrix object)
======  =====  ==============================================================
"""

from __future__ import annotations

import re
from dataclasses import dataclass

__all__ = ["HEADER_LEN", "DatasetHeader", "find_headers", "lz4_block", "rle_expand"]

HEADER_LEN = 147  # identical to the `.opj` column-storage header length
_NAME_OFF = 0x58
# Block lead: 0x80 then the token-stream length as a LEB128 varint. A dataset
# header's token stream is never shorter than its own name literal + the
# fixed fields (>= 0x10), and never longer than 147 literal bytes plus their
# two count tokens (149), so the length is one byte (0x10..0x7f) or the
# two-byte form 128..255 (``[80-ff] 01``). The public corpus only exercises
# the one-byte form (its longest header stream is 78 bytes); the two-byte
# form is the same varint the rest of the format uses, and an acceptance
# still has to pass the 147-byte + name gate below.
_LEAD = re.compile(rb"\x80(?:[\x10-\x7f]|[\x80-\xff]\x01)")
_DATASET_NAME = re.compile(rb"[A-Za-z][\w ]{0,62}(?:_[A-Za-z0-9]{1,16})?(?:@\d{1,3})?")


def rle_expand(b: bytes, p: int, clen: int, limit: int | None = None) -> bytes | None:
    """Expand the ``clen``-byte token stream at ``p``; None if malformed.

    The stream must be consumed EXACTLY (a token whose payload would cross
    ``p + clen`` rejects the block) and a zero literal count is not a token.
    With ``limit``, an expansion that grows past it stops early (None): the
    header scan only wants 147-byte expansions.
    """
    end = p + clen
    if end > len(b):
        return None
    out = bytearray()
    while p < end:
        if limit is not None and len(out) > limit:
            return None
        t = b[p]
        p += 1
        if t & 0x80:
            if t & 0x40:
                if p >= end:
                    return None
                out += bytes((b[p],)) * ((t & 0x3F) + 3)
                p += 1
            else:
                out += bytes((t & 0x7F) + 3)
        else:
            if t == 0 or p + t > end:
                return None
            out += b[p : p + t]
            p += t
    return bytes(out)


def lz4_block(src: bytes, expected: int) -> bytes | None:
    """Decode one raw LZ4 *block* (the published LZ4 block format: token =
    literal-length nibble | match-length nibble, 255-extension bytes, a
    2-byte little-endian match offset, minimum match 4). Returns None unless
    the block is well-formed and expands to exactly ``expected`` bytes.

    Origin stores a Text&Numeric column's string heap this way (the
    ``#_MSER_STRINGS_PSET`` attachment — see ``opju_strings``).
    """
    out = bytearray()
    p, n = 0, len(src)
    while p < n:
        token = src[p]
        p += 1
        lit = token >> 4
        if lit == 15:
            while True:
                if p >= n:
                    return None
                ext = src[p]
                p += 1
                lit += ext
                if ext != 255:
                    break
        if p + lit > n:
            return None
        out += src[p : p + lit]
        p += lit
        if len(out) > expected:
            return None
        if p >= n:  # the last sequence is literals only
            break
        if p + 2 > n:
            return None
        offset = src[p] | (src[p + 1] << 8)
        p += 2
        if offset == 0 or offset > len(out):
            return None
        mlen = token & 0x0F
        if mlen == 15:
            while True:
                if p >= n:
                    return None
                ext = src[p]
                p += 1
                mlen += ext
                if ext != 255:
                    break
        mlen += 4
        if len(out) + mlen > expected:
            return None
        start = len(out) - offset
        if offset >= mlen:
            out += out[start : start + mlen]
        else:  # an overlapping match repeats the last `offset` bytes
            out += (out[start:] * (mlen // offset + 1))[:mlen]
    return bytes(out) if len(out) == expected else None


@dataclass(frozen=True)
class DatasetHeader:
    """One decoded column-storage header and where its record begins."""

    name: str
    start: int  # offset of the block's 0x80 lead byte
    end: int  # offset just past the token stream (the record follows)
    kind_bits: int  # header byte 0x17
    total_rows: int
    used_rows: int
    value_size: int
    flags: int  # header byte 0x3F

    @property
    def is_column(self) -> bool:
        """A worksheet column (``Book_Col``) rather than a matrix object or
        another loose dataset (a bare name with no column suffix)."""
        return "_" in self.name

    @property
    def unsigned(self) -> bool:
        return bool(self.flags & 0x08)


def find_headers(
    b: bytes, unread: list[tuple[str, int]] | None = None
) -> list[DatasetHeader]:
    """Every dataset header in ``b``, in file order.

    Walks ``80 <clen>`` candidates forward; each accepted header jumps the
    cursor past its own token stream (headers never nest). The 147-byte +
    name-at-0x58 gate does the validation, so no assumption is made about
    what precedes a header.

    ``unread``, when given, collects ``(name, end)`` for each block that
    expands to a 147-byte header whose NUL-terminated name is printable but
    not a dataset name this reader knows (the public corpus has one such
    family, ``Book1_B.Y2``: a dataset attached to a column, not a column),
    so the caller can report it instead of skipping it silently. They are
    never decoded, and they do not move the cursor.
    """
    out: list[DatasetHeader] = []
    cursor = 0
    for m in _LEAD.finditer(b):
        s = m.start()
        if s < cursor:
            continue
        tokens = m.end()
        clen = b[s + 1] if tokens == s + 2 else (b[s + 1] & 0x7F) | (b[s + 2] << 7)
        raw = rle_expand(b, tokens, clen, HEADER_LEN)
        if raw is None or len(raw) != HEADER_LEN:
            continue
        nul = raw.find(b"\x00", _NAME_OFF)
        name = raw[_NAME_OFF:nul] if nul > _NAME_OFF else b""
        if _DATASET_NAME.fullmatch(name) is None:
            if unread is not None and name and all(0x20 <= c < 0x7F for c in name):
                unread.append((name.decode("ascii"), tokens + clen))
            continue
        end = tokens + clen
        out.append(
            DatasetHeader(
                name=name.decode("latin1"),
                start=s,
                end=end,
                kind_bits=raw[0x17],
                total_rows=int.from_bytes(raw[0x19:0x1D], "little"),
                used_rows=int.from_bytes(raw[0x21:0x25], "little"),
                value_size=raw[0x3D],
                flags=raw[0x3F],
            )
        )
        cursor = end
    return out

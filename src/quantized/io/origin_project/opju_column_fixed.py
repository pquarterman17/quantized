"""``.opju`` column records read at their FIXED offsets (any column format).

A worksheet column's windows-section record (the id record
``opju_figure_curves.column_id_table`` reads) is the ``.opj`` column
property block written in CPYUA's zero-eliding sparse grammar
(``curve_style_color``: ``<0x80+k> <len> <len literals>`` skips ``k + 3``
zeros; ``<0xc0+k> <b>`` repeats; ``<len < 0x80> <literals>`` continues).
Expanded from the record's first chunk, the fields sit at fixed offsets:

```
 4  u16  column id
17  u8   designation code   0 Y  1 disregard  2 Y-error  3 X
                            4 label  5 Z  6 X-error  (7, 8: LabTalk types 8, 9)
18  ...  short name, NUL-terminated
30  u8   display format     0 numeric  1 text  3 date  9 text & numeric
35  u16  associated column id (a Y's X; an error/Z/label column's Y)
37  u8   flags  0x01 X/Y-like, 0x10 error column, 0x20 text-capable format
38  u8   0x40 disregard, 0x50 X, 0x60 every other code; 0x01 text & numeric
```

**Why this exists.** The field walk ``opju_figure_curves`` shipped with
requires a ``<tag> 01 09`` field right after the name and a ``21 51`` /
``21 61`` / ``30 61`` designation marker: that is offset 30 = 9 and the
0x20/0x01 format flags, i.e. it reads only **Text & Numeric** columns --
Origin's default for a column typed in the GUI, but not for a column whose
format is Numeric (``01 50`` / ``01 60`` / ``10 60``, no ``09``), which is
what a book filled over COM or LabTalk gets. All 231 plot-corpus specimens
(``tools/plot_corpus``) are Numeric, so their id table came back empty;
the real corpus holds 617 such records in 50 files.

**Evidence (Origin 2026b Student COM, 2026-11-15).** A matched pair -- the
same 8-column book (LabTalk types 4 1 3 7 6 5 2 1) saved once with every
column ``format = 1`` and once ``format = 9`` -- differs only at offsets 30,
37 bit 0x20 and 38 bit 0x01; offset 17 reads 3 0 2 6 5 4 1 0 in both, and
``wks.col.type`` of ``designations.opju`` and Altaxo
``WksDifferentDiagramAssoc.opju`` (36 columns, 4 formats) agrees with the
code table above on every column. Codes 1, 4, 5, 6 are disregard, label,
Z and X-error -- NOT the label / Z / X-error the marker reader in
``windows_opju`` assumes for ``21 41`` / ``20 61`` (booked, not changed
here: those columns are never in the id table).

Only Y, Y-error and X records are returned (the designations the field walk
admits), and only when the code, the 0x11 bits of offset 37 and the high
nibble of offset 38 agree -- three independent checks standing in for the
marker the field walk anchors on. Everything else is ``None``: fail closed.
"""

from __future__ import annotations

import re

__all__ = ["DESIGNATION_CODES", "fixed_column_record", "record_name", "record_prefix"]

_PREFIX = 39  # through offset 38
DESIGNATION_CODES = {
    0: "Y",
    1: "disregard",
    2: "Y-error",
    3: "X",
    4: "label",
    5: "Z",
    6: "X-error",
}
_ADMITTED = {0: "Y", 2: "Y-error", 3: "X"}
# code -> (offset 37 & 0x11, offset 38 & 0xf0)
_FLAGS = {
    0: (0x01, 0x60),
    1: (0x01, 0x40),
    2: (0x10, 0x60),
    3: (0x01, 0x50),
    4: (0x00, 0x60),
    5: (0x00, 0x60),
    6: (0x10, 0x60),
}
_NAME_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_]*\Z")


def record_prefix(
    b: bytes, off: int, length: int = _PREFIX, *, partial: bool = False
) -> tuple[bytes, bytes] | None:
    """Expand the sparse record whose first chunk is at ``off``: ``(bytes,
    literal mask)`` for offsets ``[0, length)``, or ``None`` when the stream
    ends or meets an unknown escape first (``partial``: what was expanded up
    to that point, its mask marking only the literals actually read)."""
    buf = bytearray(length)
    lit = bytearray(length)
    pos, p, n = 0, off, len(b)
    while pos < length:
        if p >= n:
            return (bytes(buf), bytes(lit)) if partial else None
        t = b[p]
        if 0x80 <= t <= 0xBF:
            if p + 2 > n or p + 2 + b[p + 1] > n:
                return (bytes(buf), bytes(lit)) if partial else None
            ln = b[p + 1]
            pos += t - 0x80 + 3
            chunk, p = b[p + 2 : p + 2 + ln], p + 2 + ln
        elif 0xC0 <= t <= 0xC3:
            if p + 2 > n:
                return (bytes(buf), bytes(lit)) if partial else None
            chunk, p = bytes([b[p + 1]]) * (t - 0xC0 + 3), p + 2
        elif 0 < t < 0x80:
            if p + 1 + t > n:
                return (bytes(buf), bytes(lit)) if partial else None
            chunk, p = b[p + 1 : p + 1 + t], p + 1 + t
        else:
            return (bytes(buf), bytes(lit)) if partial else None
        for i, v in enumerate(chunk):
            if pos + i < length:
                buf[pos + i] = v
                lit[pos + i] = 1
        pos += len(chunk)
    return bytes(buf), bytes(lit)


def record_name(buf: bytes, lit: bytes) -> str | None:
    """The short name at offsets 18..28 of an expanded column record, or
    ``None``. The field holds 11 characters and a NUL: Origin cuts a longer
    name there (``Wavelengthnm.`` is stored ``Wavelengthn``; COM, 2026b), so
    an 11-character name may be a cut one and is not read -- fail closed."""
    end = buf.find(b"\x00", 18, 29)
    if end <= 18 or not all(lit[18:end]) or any(buf[end:30]):
        return None
    try:
        name = buf[18:end].decode("ascii")
    except UnicodeDecodeError:
        return None
    return name if _NAME_RE.match(name) else None


def fixed_column_record(b: bytes, off: int) -> tuple[str, str, int | None] | None:
    """``(short name, designation, associated id)`` of the column record
    whose first chunk is at ``off``, or ``None`` (module docstring). The
    associated id is returned for a Y column only (its X partner), as the
    field walk does."""
    got = record_prefix(b, off)
    if got is None:
        return None
    buf, lit = got
    code = buf[17]
    if code not in _ADMITTED or (buf[37] & 0x11, buf[38] & 0xF0) != _FLAGS[code]:
        return None
    if buf[37] & ~0x31 or buf[38] & 0x0E:
        return None
    name = record_name(buf, lit)
    if name is None:
        return None
    partner = int.from_bytes(buf[35:37], "little") if code == 0 else None
    return name, _ADMITTED[code], partner or None

"""The designation behind each ``windows_opju`` marker, read from its column record.

``windows_opju`` counts a book's columns by the two marker bytes every Text
& Numeric column record carries -- record offsets 37-38
(``opju_column_fixed``). The marker alone does not name the designation:
offset 38's high nibble is 5 for X, 4 for disregard and 6 for every other
code, and offset 37's ``0x10`` bit marks an error column, so

* ``21 51`` is X,
* ``21 61`` is Y (or a Group / Subject column),
* ``30 61`` is Y-error **or X-error**,
* ``20 61`` is label **or Z**,
* ``21 41`` is disregard.

The designation itself is the record's offset 17 code (``DESIGNATION_CODES``).
This module expands every column record of the stream
(``opju_curve_token.column_id_records``) and maps the stream position of its
offset-37 byte to that code, so the marker scan reads the code instead of
guessing from the marker. A record is used only when its offsets 37 and 38
are adjacent literals that hold a known marker, its short name decodes, and
the marker's flag bits agree with the code (``opju_column_fixed._FLAGS``);
two records claiming one marker with different codes claim none.

**Evidence (Origin 2026b Student COM, 2026-11-15; decode-plan item 72).**
``wks.col.type`` of specimen books holding every designation (LabTalk types
1-9) saved Numeric, Text & Numeric and mixed, of ``designations.opju`` and
of every real-corpus column whose designation this changes (46 files). The
marker-only reading this replaces took ``21 41`` for label, ``20 61`` for Z
or (by a mis-tabled code byte) X-error, and ``30 61`` for Y-error only.
"""

from __future__ import annotations

from quantized.io.origin_project.opju_column_fixed import (
    _FLAGS,
    DESIGNATION_CODES,
    expand_record,
    record_name,
)
from quantized.io.origin_project.opju_curve_token import column_id_records

__all__ = ["MARKER_DESIGNATIONS", "marker_designations"]

# The designations each marker can carry (the flag bits it encodes).
MARKER_DESIGNATIONS = {
    b"\x21\x51": frozenset({"X"}),
    b"\x21\x61": frozenset({"Y", "group", "subject"}),
    b"\x30\x61": frozenset({"Y-error", "X-error"}),
    b"\x20\x61": frozenset({"label", "Z"}),
    b"\x21\x41": frozenset({"disregard"}),
}
_FLAGS_7_8 = (0x01, 0x60)  # Group / Subject: Y-like (Altaxo WksDifferentDiagramAssoc)


def marker_designations(b: bytes, start: int) -> dict[int, str]:
    """Stream position of a column record's marker (offset 37) -> its
    designation, for every record in ``b[start:]`` that proves it (module
    docstring). A marker missing from the map is not proven."""
    found: dict[int, str] = {}
    clash: set[int] = set()
    for off, _cid, _fields in column_id_records(b, start, len(b)):
        got = expand_record(b, off)
        if got is None:
            continue
        buf, lit, src = got
        code = buf[17]
        desig = DESIGNATION_CODES.get(code)
        pos = src[37]
        if desig is None or pos < 0 or src[38] != pos + 1:
            continue
        if desig not in MARKER_DESIGNATIONS.get(b[pos : pos + 2], frozenset()):
            continue
        if (buf[37] & 0x11, buf[38] & 0xF0) != _FLAGS.get(code, _FLAGS_7_8):
            continue
        if record_name(buf, lit) is None:
            continue
        if found.get(pos, desig) != desig:
            clash.add(pos)
        found[pos] = desig
    for pos in clash:
        del found[pos]
    return found

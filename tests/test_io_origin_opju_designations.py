"""``.opju`` column designations read from the column record (decode-plan
item 72): the marker bytes ``windows_opju`` counts columns by do not name the
designation (``30 61`` is Y-error or X-error, ``20 61`` label or Z, ``21 41``
disregard); record offset 17 does (``opju_marker_designations``).

Synthetic bytes only (invented names). The Origin-checked anchor is
``designations.opju`` in ``test_io_origin_fuzz`` (COM ``wks.col.type``).
"""

from __future__ import annotations

from quantized.io.origin_project.opju_figure_curves import column_id_table, opju_pages
from quantized.io.origin_project.opju_marker_designations import marker_designations
from quantized.io.origin_project.windows_opju import opju_window_metadata
from test_io_origin_figures_opju import _opju_page_header
from test_io_origin_opju_numeric_columns import _MAGIC, _label, _numeric_record

# (id, short name, code, associated id, label): every designation Origin has
_COLS = [
    (1, "A", 3, 0, "time\r\ns"),
    (2, "B", 0, 1, "volts\r\nV"),
    (3, "C", 2, 2, "dV"),
    (4, "D", 6, 2, "dt"),
    (5, "E", 4, 2, "tag"),
    (6, "F", 5, 2, "depth"),
    (7, "G", 1, 0, "unused"),
]
_WANT = {
    "A": "X",
    "B": "Y",
    "C": "Y-error",
    "D": "X-error",
    "E": "label",
    "F": "Z",
    "G": "disregard",
}


def _tn_book(name: str, cols: list[tuple[int, str, int, int, str]]) -> bytes:
    """A Text & Numeric book: records whose offsets 37-38 are the markers."""
    body = b"".join(
        _numeric_record(cid, nm, code, assoc, fmt=9) + _label(lab)
        for cid, nm, code, assoc, lab in cols
    )
    return _opju_page_header(name) + b"\x00" * 64 + body + b"\x00" * 64


def test_every_marker_reads_its_record_code() -> None:
    b = _MAGIC + _tn_book("Des", _COLS)
    proven = marker_designations(b, 0)
    assert sorted(proven.values()) == sorted(_WANT.values())
    # Y-error and X-error share the marker: only the record tells them apart
    assert {bytes(b[p : p + 2]) for p, d in proven.items() if d in ("Y-error", "X-error")} == {
        b"\x30\x61"
    }
    meta = opju_window_metadata(b, {"Des": list(_WANT)})
    got = {c: m.designation for c, m in meta["Des"].columns.items()}
    assert got == _WANT
    assert meta["Des"].columns["D"].long_name == "dt"


def test_unproven_ambiguous_marker_has_no_designation() -> None:
    # a `20 61` column whose record does not decode (its name is not one):
    # still counted (the run keeps its labels), never guessed Z or label
    cols = [(1, "A", 3, 0, "time\r\ns"), (2, "B", 0, 1, "volts\r\nV")]
    bad = _numeric_record(3, "?", 5, 2, fmt=9)
    b = _MAGIC + _tn_book("Des", cols)[:-64] + bad + _label("depth") + b"\x00" * 64
    meta = opju_window_metadata(b, {"Des": ["A", "B", "C"]})
    got = {c: (m.designation, m.long_name) for c, m in meta["Des"].columns.items()}
    assert got == {"A": ("X", "time"), "B": ("Y", "volts"), "C": ("", "depth")}


def test_disregard_marker_alone_reads_disregard() -> None:
    bad = _numeric_record(3, "?", 1, 0, fmt=9)  # no record: the marker alone
    b = _MAGIC + _tn_book("Des", _COLS[:2])[:-64] + bad + _label("u") + b"\x00" * 64
    meta = opju_window_metadata(b, {"Des": ["A", "B", "C"]})
    assert meta["Des"].columns["C"].designation == "disregard"


def test_record_contradicting_its_marker_proves_nothing() -> None:
    # code 6 (X-error) behind a Y marker: the flag bits disagree, fail closed
    rec = bytearray(_numeric_record(4, "D", 6, 2, fmt=9))
    rec[rec.index(b"\x30\x61")] = 0x21
    b = _MAGIC + _opju_page_header("Des") + b"\x00" * 64 + bytes(rec) + b"\x00" * 64
    assert marker_designations(b, 0) == {}


def test_id_table_reads_x_error_not_y_error() -> None:
    b = _MAGIC + _tn_book("Des", _COLS[:4])
    b += _opju_page_header("Graph1") + b"\x00" * 32
    table = column_id_table(b, opju_pages(b))
    assert table.yerr_ids == {3}  # D (code 6) shares C's `30 61` marker

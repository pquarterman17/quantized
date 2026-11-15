"""``.opju`` columns whose format is not Text & Numeric (plan items 5-7 of
``ORIGIN_PLOT_TYPE_PARITY_PLAN``): their id records, labels and designations,
plus the step / page-template gates the newly bound curves exposed.

Synthetic bytes only (invented names) for the shapes. The ``realdata``
anchors check the decode against Origin 2026b Student COM (``wks.col.type``,
``lname$``, ``%Z`` / ``xof``; 2026-11-15) and auto-skip without the corpus.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from quantized.io.origin_project.opju_column_fixed import (
    DESIGNATION_CODES,
    fixed_column_record,
    record_prefix,
)
from quantized.io.origin_project.opju_figure_curves import column_id_table, opju_pages
from quantized.io.origin_project.opju_layer_kind import (
    LAYER_KIND_NOT_DECODED,
    MARKER_ENCODING_NOT_DECODED,
    apply_layer_kinds,
    page_layer_kind,
)
from quantized.io.origin_project.opju_plot_gates import withhold_step_style
from quantized.io.origin_project.opju_record_meta import record_column_metadata
from test_io_origin_figures_opju import _opju_page_header

_MAGIC = b"CPYUA 4.3811 222\n"

# offset 37 & 0x11 / offset 38 high nibble per designation code (COM pair)
_FLAG = {
    0: (0x01, 0x60),
    2: (0x10, 0x60),
    3: (0x01, 0x50),
    4: (0x00, 0x60),
    5: (0x00, 0x60),
    6: (0x10, 0x60),
    1: (0x01, 0x40),
}


def _numeric_record(cid: int, name: str, code: int, assoc: int = 0, fmt: int = 0) -> bytes:
    """A form-B column record at its fixed offsets (``opju_column_fixed``):
    designation ``code`` at 17, name at 18, format ``fmt`` at 30 (0 =
    Numeric: no ``09`` separator and no 0x20/0x01 format flags)."""
    nm = name.encode("ascii")
    b37, b38 = _FLAG[code]
    if fmt == 9:
        b37, b38 = b37 | 0x20, b38 | 0x01
    out = b"\x07\x10\x01\x00\x00" + cid.to_bytes(2, "little") + b"\x0b"  # offsets 0..6
    out += b"\x81\x01\x32"  # skip 7..10, offset 11 (row count)
    head = (bytes([code]) if code else b"") + nm
    start = 17 if code else 18
    out += bytes([0x80 + start - 12 - 3, len(head)]) + head  # skip 12..start-1
    pos = start + len(head)
    tail = bytes([fmt]) if fmt else b""
    if tail:
        out += bytes([0x80 + 30 - pos - 3, 1]) + tail
        pos = 31
    lits = assoc.to_bytes(2, "little") + bytes([b37, b38])  # offsets 35..38
    out += bytes([0x80 + 35 - pos - 3, len(lits)]) + lits
    return b"\x0a\x00\x80\x2e" + out + b"\x89\x01\x01\x9a\x00"


def _label(text: str) -> bytes:
    data = text.encode("utf-8") + b"\x00"
    return bytes([len(data) + 1, len(data)]) + data


def _book(name: str, cols: list[tuple[int, str, int, int, str]]) -> bytes:
    body = b"".join(
        _numeric_record(cid, nm, code, assoc) + _label(lab) for cid, nm, code, assoc, lab in cols
    )
    return _opju_page_header(name) + b"\x00" * 64 + body + b"\x00" * 64


def test_fixed_record_reads_a_numeric_column() -> None:
    rec = _numeric_record(7, "A", 3)
    got = record_prefix(rec, 4)
    assert got is not None and got[0][4] == 7 and got[0][17] == 3
    assert fixed_column_record(rec, 4) == ("A", "X", None)
    assert fixed_column_record(_numeric_record(8, "B", 0, assoc=7), 4) == ("B", "Y", 7)
    assert fixed_column_record(_numeric_record(9, "dY2", 2, assoc=8), 4) == ("dY2", "Y-error", None)


def test_fixed_record_fails_closed() -> None:
    # a designation the field walk never admitted: no id-table entry
    for code in (1, 4, 5, 6):
        assert fixed_column_record(_numeric_record(7, "C", code), 4) is None
    # code says X but the flags say Y: the three checks disagree
    bad = bytearray(_numeric_record(7, "A", 3))
    bad[bad.index(b"\x01\x50")] = 0x10
    assert fixed_column_record(bytes(bad), 4) is None
    assert fixed_column_record(_numeric_record(7, "A", 3)[:20], 4) is None  # truncated


def test_codes_match_labtalk_types() -> None:
    # wks.col.type 4 1 3 7 6 5 2 -> offset 17 3 0 2 6 5 4 1 (COM matched pair)
    assert [DESIGNATION_CODES[c] for c in (3, 0, 2, 6, 5, 4, 1)] == [
        "X",
        "Y",
        "Y-error",
        "X-error",
        "Z",
        "label",
        "disregard",
    ]


def test_id_table_adds_numeric_columns() -> None:
    b = _MAGIC + _book("Num", [(1, "A", 3, 0, "x"), (2, "B", 0, 1, "y"), (3, "C", 2, 2, "dy")])
    b += _opju_page_header("Graph1") + b"\x00" * 32
    table = column_id_table(b, opju_pages(b))
    assert table.ids == {1: ("Num", "A"), 2: ("Num", "B"), 3: ("Num", "C")}
    assert table.x_partner == {2: 1} and table.book_x == {"Num": "A"}
    assert table.yerr_ids == {3}


def test_record_metadata_labels_every_column() -> None:
    cols = [(1, "A", 3, 0, "time\r\ns"), (2, "B", 0, 1, "volts\r\nV"), (3, "C", 6, 2, "dx")]
    b = _MAGIC + _book("Num", cols)
    pages = opju_pages(b)
    table = column_id_table(b, pages)
    meta = record_column_metadata(b, pages, table, {}, {"Num": ["A", "B", "C"]})
    got = {c: (m.designation, m.long_name, m.unit) for c, m in meta["Num"].columns.items()}
    assert got == {"A": ("X", "time", "s"), "B": ("Y", "volts", "V"), "C": ("X-error", "dx", "")}
    # a column the records do not cover: the whole sheet stays unlabelled
    assert record_column_metadata(b, pages, table, {}, {"Num": ["A", "D"]}) == {}
    # a disregard column (code 1, COM-proven: decode-plan item 72) is labelled
    b2 = _MAGIC + _book("Num", [(1, "A", 3, 0, "x"), (2, "B", 1, 1, "y")])
    p2 = opju_pages(b2)
    got2 = record_column_metadata(b2, p2, column_id_table(b2, p2), {}, {"Num": ["A", "B"]})
    assert {c: m.designation for c, m in got2["Num"].columns.items()} == {
        "A": "X",
        "B": "disregard",
    }
    # an unknown code (9): the sheet stays unlabelled, never guessed
    b3 = bytearray(b2)
    b3[b3.index(b"\x01B")] = 9  # B's code literal (offset 17), just before its name
    p3 = opju_pages(bytes(b3))
    t3 = column_id_table(bytes(b3), p3)
    assert record_column_metadata(bytes(b3), p3, t3, {}, {"Num": ["A", "B"]}) == {}


def test_step_connect_withholds_the_line_style() -> None:
    rec = bytearray(519)
    rec[17] = 11
    curve: dict[str, str | float] = {"style": "line", "color": "#FF0000"}
    withhold_step_style(curve, bytes(rec))
    assert curve == {"color": "#FF0000"}
    rec[17] = 1  # straight
    curve = {"style": "line"}
    withhold_step_style(curve, bytes(rec))
    assert curve == {"style": "line"}


def _graph_page(name: str, template: str) -> bytes:
    """A graph page header whose sparse record carries ``template`` at
    record offset 61 (the shape of every 2026b-saved page)."""
    rec = b"\x90\x0c" + b"\x2e\x00\x2e\x00\xfe\x02\x49\x02\x20\x19\xd0\x11"  # 19..30
    rec += b"\x84\x0a" + b"\x14\x00\x14\x00\x10\x00\x80\x00\x00\x20"  # 38..47
    rec += b"\x82\x04\x20\x19\xd0\x11"  # 53..56
    t = template.encode("ascii")
    rec += bytes([0x81, len(t)]) + t + b"\x83\x02\xb8\x0b"  # 61..
    return _opju_page_header(name)[:-1] + rec + b"\x00" * 32


def test_page_template_names_the_layer_kind() -> None:
    for tmpl, kind in (
        ("Polar", "polar"),
        ("OffsetSta", "offset_stack"),
        ("bubble", "bubble"),
        ("colormapp", "color_mapped"),
        ("Line", None),
    ):
        b = _MAGIC + _graph_page("Graph1", tmpl)
        ((off, name),) = opju_pages(b)
        assert page_layer_kind(b, off, name) == kind


def test_layer_kinds_omit_or_note() -> None:
    curves = [{"book": "B", "x": "A", "y": "B"}, {"book": "B@2", "x": "A", "y": "C"}]
    figs = [
        {"name": "Graph1", "curves": curves, "legend_labels": ["one", "two"]},
        {"name": "Graph2", "curves": curves[:1]},
    ]
    b = _MAGIC + _graph_page("Graph1", "Polar") + _graph_page("Graph2", "bubble")
    out = apply_layer_kinds(figs, b)
    assert out[0]["curves"] == [] and out[0]["legend_labels"] == []
    assert [o["reason"] for o in out[0]["curve_sheet_omitted"]] == [LAYER_KIND_NOT_DECODED] * 2
    assert out[0]["curve_sheet_omitted"][1]["book"] == "B"
    assert out[1]["curves"] == curves[:1] and out[1][MARKER_ENCODING_NOT_DECODED] == "bubble"


# ── realdata anchors (Origin 2026b COM, 2026-11-15) ───────────────────────────

_ALTAXO = (
    "origin/public/gh_Altaxo_LibOriginCSharp/LibOriginCSharpTests/Serialization/Origin/TestFiles/"
)


def _path(corpus_dir: Path, rel: str) -> Path:
    path = corpus_dir / rel
    if not path.is_file():
        pytest.skip(f"{rel} not present")
    return path


@pytest.mark.realdata
def test_realdata_numeric_book_designations(corpus_dir: Path) -> None:
    """``wks.col.type`` of Altaxo ``WksDifferentDiagramAssoc`` book Numbers
    (every column Numeric): A 4 X, B 1 Y, E 3 Y-error -- the id table now
    holds them; C/D/F/G (Z, X-error, label, disregard) stay out of it."""
    b = _path(corpus_dir, _ALTAXO + "WksDifferentDiagramAssoc.opju").read_bytes()
    table = column_id_table(b, opju_pages(b))
    numbers = {name for book, name in table.ids.values() if book == "Numbers"}
    assert {"A", "B", "E"} <= numbers and not numbers & {"C", "D", "F", "G"}
    assert table.book_x["Numbers"] == "A"


@pytest.mark.realdata
def test_realdata_numeric_book_labels(corpus_dir: Path) -> None:
    """``lname$`` / ``wks.col.type`` over COM for ``fig01_line_ci_fmri``
    Book2 (Numeric columns): X ``timepoint``, Y ``Stimulus``."""
    from quantized.io.origin_project.opju import read_opju_books

    rel = "origin/public/TJCSGAO_origin-publication-figures/assets/opju/fig01_line_ci_fmri.opju"
    books = {b.metadata.get("origin_book"): b for b in read_opju_books(_path(corpus_dir, rel))}
    md = books["Book2"].metadata
    assert md["x_column_long"] == "timepoint"
    assert md["column_designations"]["A"] == "X"
    assert books["Book2"].labels[0] == "Stimulus"


def test_error_bar_plot_is_not_a_curve() -> None:
    from quantized.io.origin_project.opju_plot_gates import error_bar_reason

    rec = bytearray(519)
    for byte, want in ((0xE7, "error_bar_plot"), (0xE9, "error_bar_plot"), (0xC8, "")):
        rec[76] = byte
        assert error_bar_reason(bytes(rec)) == want
    assert error_bar_reason(None) == ""


_BET = (
    "origin/public/zhichaojin357-ctrl_ResearchDataOriginPipeline/templates/"
    "origin_styles/reference_opju/BET.opju"
)


@pytest.mark.realdata
def test_realdata_error_bar_plots_are_omitted(corpus_dir: Path) -> None:
    """Origin (``GetPlotType``): Graph1 plots ``Isotherm_A`` and
    ``Isotherm_C`` as Y-error bars (231) and B, D, F, H, J, L as lines."""
    from quantized.io.origin_project.figures_opju import extract_figures_opju

    b = _path(corpus_dir, _BET).read_bytes()
    fig = next(f for f in extract_figures_opju(b) if f["name"] == "Graph1")
    assert {c["y"] for c in fig["curves"]} == {"B", "D", "F", "H", "J", "L"}
    omitted = {(n["y"], n["reason"]) for n in fig["curve_sheet_omitted"]}
    assert omitted == {("A", "error_bar_plot"), ("C", "error_bar_plot")}

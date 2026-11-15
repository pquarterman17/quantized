"""Zero-low-byte column ids (``opju_zero_low_ids``) and the window sheet-list
signal S (``opju_sheet_segments``), plan items 67-68.

A column id whose low byte is 0 (256, 512, ...) is written ``81 02 <hi>``
(one more elided zero) in both its column record and its curve tokens; the
id table and the token reader now read that form. Signal S: the column
records a book's window section writes after one ``82 02 50 64`` sheet
header and before the next are one sheet's, so an id unproven by rank / H /
P takes the sheet the proven ids of its segment agree on.

Synthetic bytes only (invented names) except the ``realdata`` anchors, whose
expected values Origin 2026b reported over COM on 2026-11-15
(``%(i,@D)`` / ``%(iX,@D)`` and ``sum()`` count/min/max of those datasets).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
import pytest

from opju_fixture import block, header
from quantized.io.origin_project import drop_empty_library_books, read_origin_project_all
from quantized.io.origin_project.figures_opju import extract_figures_opju
from quantized.io.origin_project.opju_curve_sheets import off_sheet_ids, unbound_rebinds
from quantized.io.origin_project.opju_figure_curves import column_id_table, opju_pages
from quantized.io.origin_project.opju_sheet_segments import record_segments, resolve_by_segments
from quantized.io.origin_project.opju_zero_low_ids import zero_low_id_chunk
from test_io_origin_figures_opju import (
    _column_id_record,
    _id_curve_token,
    _layer_bytes,
    _opju_page_header,
)


def _ds(name: str) -> bytes:
    return b"\x00" + block(header(name, kind=0x10, total=3, used=3, size=8))


def _zero_low_record(cid: int, name: str, desig: str, partner: int | None = None) -> bytes:
    """A form-A column record whose id's low byte is 0: ``81 02 <hi>``."""
    assert cid % 256 == 0
    rec = _column_id_record(cid, name, desig, partner)
    wide = b"\x01\x10\x80\x03" + cid.to_bytes(2, "little")
    return rec.replace(wide, b"\x01\x10\x81\x02" + bytes([cid >> 8]), 1)


def _zero_low_token(flag: int, cid: int) -> bytes:
    return bytes([flag, 1, 1, 1, 0x81, 0x02, cid >> 8, 0x09])


_SHEET = b"\x0a\x00\x16\x82\x02\x50\x64\xa2\x0f"  # a sheet header's "Pd" chunk
_LAYER = _layer_bytes(0.0, 9.0, 0.0, 1000.0, 200.0, 0x03, r"\l(1) %(1)")


def _blob(datasets: bytes, records: bytes, *tokens: bytes) -> bytes:
    return (
        b"CPYUA 4.3811 222\n"
        + datasets
        + _opju_page_header("WBook")
        + records
        + _opju_page_header("Graph1")
        + _LAYER
        + b"".join(tokens)
    )


def _curves(figs: list[dict[str, object]]) -> list[tuple[object, object, object]]:
    return [(c["book"], c["x"], c["y"]) for c in figs[0]["curves"]]  # type: ignore[index]


# ---- zero-low-byte ids ----


def test_zero_low_column_record_enters_the_id_table() -> None:
    records = _column_id_record(1, "A", "X") + _zero_low_record(512, "B", "Y", partner=1)
    b = _blob(_ds("WBook_A") + _ds("WBook_B"), records)
    table = column_id_table(b, opju_pages(b))
    assert table.ids[512] == ("WBook", "B")
    assert table.x_partner[512] == 1


def test_zero_low_curve_token_is_decoded() -> None:
    records = _column_id_record(1, "A", "X") + _zero_low_record(512, "B", "Y", partner=1)
    b = _blob(_ds("WBook_A") + _ds("WBook_B"), records, _zero_low_token(0xBA, 512))
    assert _curves(extract_figures_opju(b)) == [("WBook", "A", "B")]


def test_zero_low_id_chunk_forms() -> None:
    """``81 02 <hi> <x>`` (4 bytes) and ``81 01 <hi>`` (3 bytes, <x> zero
    too); any other chunk is not this form."""
    assert zero_low_id_chunk(b"\x81\x02\x16\x09", 0) == (0x1600, 4)
    assert zero_low_id_chunk(b"\x81\x01\x11\x82", 0) == (0x1100, 3)
    assert zero_low_id_chunk(b"\x80\x03\x00\x02\x09", 0) is None
    assert zero_low_id_chunk(b"\x81\x02\x16", 0) is None  # truncated


def test_zero_low_short_curve_token_is_decoded() -> None:
    records = _column_id_record(1, "A", "X") + _zero_low_record(512, "B", "Y", partner=1)
    token = bytes([0xBA, 1, 1, 1, 0x81, 0x01, 0x02])
    b = _blob(_ds("WBook_A") + _ds("WBook_B"), records, token)
    assert _curves(extract_figures_opju(b)) == [("WBook", "A", "B")]


def test_zero_low_record_restores_the_rank_alignment() -> None:
    """Two ``B`` datasets; without id 512 one id faces two datasets and no
    ``B`` is proven, with it the second id is sheet 2's."""
    records = (
        _column_id_record(1, "A", "X")
        + _column_id_record(2, "B", "Y", partner=1)
        + _column_id_record(3, "A", "X")
        + _zero_low_record(512, "B", "Y", partner=3)
    )
    data = _ds("WBook_A") + _ds("WBook_B") + _ds("WBook_A@2") + _ds("WBook_B@2")
    b = _blob(data, records)
    assert off_sheet_ids(b, column_id_table(b, opju_pages(b)).ids) == {3: "WBook@2", 512: "WBook@2"}


def test_zero_low_lead_without_a_record_resolves_nothing() -> None:
    records = _column_id_record(1, "A", "X") + b"\x80\x32\x01\x10\x81\x02\x02\x0b\x00\x00"
    b = _blob(_ds("WBook_A"), records)
    assert 512 not in column_id_table(b, opju_pages(b)).ids


# ---- signal S: the window's sheet list ----

# Sheet 1 (A=1 X, B=2), a report sheet storing B@2 with no record, sheet 3
# (A=5 X, B=6). A aligns by rank (2 ids, 2 datasets); B does not (2 ids, 3
# datasets) and no B has a partner or a header reference.
_DATA = _ds("WBook_A") + _ds("WBook_B") + _ds("WBook_B@2") + _ds("WBook_A@3") + _ds("WBook_B@3")


def _segmented(*segments: bytes) -> bytes:
    return b"".join(_SHEET + s for s in segments)


def test_segment_anchor_places_its_unproven_ids() -> None:
    records = _segmented(
        _column_id_record(1, "A", "X") + _column_id_record(2, "B", "Y"),
        b"",
        _column_id_record(5, "A", "X") + _column_id_record(6, "B", "Y"),
    )
    b = _blob(_DATA, records, _id_curve_token(0xBA, cid=6), _id_curve_token(0xBB, cid=2))
    table = column_id_table(b, opju_pages(b))
    rank = off_sheet_ids(b, table.ids)
    assert rank == {5: "WBook@3", 2: "", 6: ""}
    assert resolve_by_segments(b, table.ids, rank) == {5: "WBook@3", 2: "WBook", 6: "WBook@3"}
    assert _curves(extract_figures_opju(b)) == [("WBook@3", "A", "B"), ("WBook", "A", "B")]


def test_segment_whose_proven_ids_disagree_proves_nothing() -> None:
    records = _segmented(
        _column_id_record(1, "A", "X")
        + _column_id_record(2, "B", "Y")
        + _column_id_record(5, "A", "X")
        + _column_id_record(6, "B", "Y"),
    )
    b = _blob(_DATA, records, _id_curve_token(0xBA, cid=6))
    table = column_id_table(b, opju_pages(b))
    assert resolve_by_segments(b, table.ids, off_sheet_ids(b, table.ids))[6] == ""
    figs = extract_figures_opju(b)
    assert figs[0]["curves"] == []
    assert figs[0]["curve_sheet_omitted"][0]["reason"] == "sheet_unknown"


def test_sheet_claimed_by_two_segments_proves_nothing() -> None:
    records = _segmented(
        _column_id_record(1, "A", "X") + _column_id_record(2, "B", "Y"),
        _column_id_record(5, "A", "X") + _column_id_record(6, "B", "Y"),
        _column_id_record(7, "C", "Y", partner=5),  # rank-proven @3 too
    )
    data = _DATA + _ds("WBook_C@3")
    b = _blob(data, records)
    table = column_id_table(b, opju_pages(b))
    got = resolve_by_segments(b, table.ids, off_sheet_ids(b, table.ids))
    assert got[2] == "WBook"  # segment 0 is still sound
    assert got[6] == ""


def test_record_before_the_first_sheet_header_disables_segmenting() -> None:
    records = _column_id_record(1, "A", "X") + _segmented(
        _column_id_record(2, "B", "Y"),
        _column_id_record(5, "A", "X") + _column_id_record(6, "B", "Y"),
    )
    b = _blob(_DATA, records)
    table = column_id_table(b, opju_pages(b))
    assert record_segments(b, table.ids) == {}


def test_segment_placing_a_column_without_that_dataset_proves_nothing() -> None:
    """Segment 2 is anchored on sheet 3, but no ``WBook_B@3`` is stored."""
    data = _ds("WBook_A") + _ds("WBook_B") + _ds("WBook_B@2") + _ds("WBook_A@3") + _ds("WBook_B@7")
    records = _segmented(
        _column_id_record(1, "A", "X") + _column_id_record(2, "B", "Y"),
        _column_id_record(5, "A", "X") + _column_id_record(6, "B", "Y"),
    )
    b = _blob(data, records)
    table = column_id_table(b, opju_pages(b))
    assert resolve_by_segments(b, table.ids, off_sheet_ids(b, table.ids))[6] == ""


def test_repeated_plot_of_a_segment_placed_column_is_withheld() -> None:
    """Two tokens plotting id 6 (Origin's row-range parts are not decoded)."""
    records = _segmented(
        _column_id_record(1, "A", "X") + _column_id_record(2, "B", "Y"),
        b"",
        _column_id_record(5, "A", "X") + _column_id_record(6, "B", "Y"),
    )
    b = _blob(_DATA, records, _id_curve_token(0xBA, cid=6), _id_curve_token(0xBB, cid=6))
    figs = extract_figures_opju(b)
    assert figs[0]["curves"] == []
    assert figs[0]["curve_sheet_omitted"][0]["reason"] == "plotted_twice"


# ---- realdata anchors (values: Origin 2026b COM, 2026-11-15) ----

_RISK = (
    "origin/public/he-xiaolin_Online-perceived-risk-study/Fig3_ExtFig5/"
    "PerceivedRiskandPrediction.opju"
)
_SOP = "origin/public/Techboyjohnny-98_SOP_measurement_SHAP/OriginPro file/SOP_meas.opju"


def _import(corpus_dir: Path, rel: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    project = corpus_dir / rel
    if not project.is_file():
        pytest.skip(f"{rel} not present")
    _primary, books = read_origin_project_all(project)
    kept = drop_empty_library_books(books)
    figs = unbound_rebinds(extract_figures_opju(project.read_bytes()), kept)
    return figs, {str(b.metadata.get("origin_book")): b for b in kept}


def _layer(figs: list[dict[str, Any]], name: str, layer: int) -> dict[str, Any]:
    (f,) = [f for f in figs if (f["name"], f["layer"]) == (name, layer)]
    return f


def _drawn(books: dict[str, Any], book: str, y: str) -> tuple[Any, Any]:
    ds = books[book]
    names = list(ds.metadata["origin_column_names"])
    yv = np.asarray(ds.values, dtype=float)[:, names.index(y)]
    xv = np.asarray(ds.time, dtype=float)
    ok = np.isfinite(yv) & np.isfinite(xv)
    return xv[ok], yv[ok]


@pytest.mark.realdata
def test_realdata_zero_low_id_restores_book1d_sheet_27(corpus_dir: Path) -> None:
    """``Book1D``'s sheet-23 ``D`` has id 512 (``81 02 02``); with it the 27
    ``D`` ids align with the 27 datasets. Origin plots Book1D_D@27 (n 301,
    1.01245543614787..2.08069367088931) against Book1D_A@27 (0..30)."""
    figs, books = _import(corpus_dir, _RISK)
    (c,) = [c for c in _layer(figs, "Graph59", 1)["curves"] if c["y"] == "D"]
    assert (c["book"], c["x"]) == ("Book1D@27", "A")
    x, y = _drawn(books, "Book1D@27", "D")
    assert y.size == 301
    assert (y.min(), y.max()) == pytest.approx((1.01245543614787, 2.08069367088931), rel=1e-12)
    assert (x.min(), x.max()) == pytest.approx((0.0, 30.0))


@pytest.mark.realdata
def test_realdata_zero_low_token_draws_graph10b(corpus_dir: Path) -> None:
    """Graph10B's ``Book1B_D@10`` token names id 3072 as ``81 02 0c``: an
    Origin plot the decoder never saw (plan item 68). Origin: n 301,
    1..1.99977098579975, against Book1B_A@10."""
    figs, books = _import(corpus_dir, _RISK)
    curves = _layer(figs, "Graph10B", 1)["curves"]
    assert ("Book1B@10", "A", "D") in [(c["book"], c["x"], c["y"]) for c in curves]
    _x, y = _drawn(books, "Book1B@10", "D")
    assert y.size == 301
    assert (y.min(), y.max()) == pytest.approx((1.0, 1.99977098579975), rel=1e-12)


@pytest.mark.realdata
def test_realdata_segments_place_sop_sheets_1_and_5(corpus_dir: Path) -> None:
    """``figSOPvsR`` has 4 ids per name against 7 datasets (sheets 2/4/6 are
    fit reports, which store no id records). Signal S places Graph26 layer 2
    on the sheets Origin plots: figSOPvsR_H vs _G (n 15) and figSOPvsR_B@5
    vs _A@5 (n 1000, 20.338439552959876..43.87379595660517)."""
    figs, books = _import(corpus_dir, _SOP)
    got = {(c["book"], c["x"], c["y"]) for c in _layer(figs, "Graph26", 2)["curves"]}
    assert {("figSOPvsR", "G", "H"), ("figSOPvsR@5", "A", "B")} <= got
    _x, y = _drawn(books, "figSOPvsR@5", "B")
    assert y.size == 1000
    assert (y.min(), y.max()) == pytest.approx((20.338439552959876, 43.87379595660517), rel=1e-12)


@pytest.mark.realdata
def test_realdata_repeated_plot_of_a_placed_column_is_withheld(corpus_dir: Path) -> None:
    """Graph12 plots ``figSOPvsR_E`` three times (Origin's first plot holds 4
    of its 15 rows): the row ranges are not decoded, so it is omitted."""
    figs, _books = _import(corpus_dir, _SOP)
    f = _layer(figs, "Graph12", 1)
    assert "E" not in [c["y"] for c in f["curves"]]
    assert ("E", "plotted_twice") in [(n["y"], n["reason"]) for n in f["curve_sheet_omitted"]]

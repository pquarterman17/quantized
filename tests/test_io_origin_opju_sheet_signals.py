"""The second ``.opju`` sheet signal (``opju_sheet_signals``) and the u8 id
column-record forms (``opju_figure_curves`` A1/B1), plan items 67-68.

When the rank alignment cannot prove a column id's sheet (its name has a
different number of ids and datasets), signal H (a dataset header's column
reference at ``0x52``) or P (the id's stored X partner's sheet) may; the
result must name a stored dataset and collide with no other id of the name,
else the curve stays omitted. A newly proven X column plotted as a curve's
own Y stays omitted (``y_is_x_column``).

Synthetic bytes only (invented names) except the ``realdata`` anchors, whose
expected values Origin 2026b reported over COM on 2026-11-15
(``%(i,@D)`` / ``%(iX,@D)`` and ``sum()`` count/min/max of those datasets).
"""

from __future__ import annotations

from pathlib import Path

import pytest

from opju_fixture import block, header
from quantized.io.origin_project import drop_empty_library_books, read_origin_project_all
from quantized.io.origin_project.figures_opju import extract_figures_opju
from quantized.io.origin_project.opju_curve_sheets import off_sheet_ids, unbound_rebinds
from quantized.io.origin_project.opju_figure_curves import column_id_table, opju_pages
from quantized.io.origin_project.opju_sheet_signals import (
    header_column_refs,
    resolve_unknown_sheets,
)
from test_io_origin_figures_opju import (
    _column_id_record,
    _id_curve_token,
    _layer_bytes,
    _opju_page_header,
)


def _ds(name: str, ref: int = 0) -> bytes:
    """A dataset storage header whose ``0x52`` column reference is ``ref``."""
    h = bytearray(header(name, kind=0x10, total=3, used=3, size=8))
    h[0x52:0x54] = ref.to_bytes(2, "little")
    return b"\x00" + block(bytes(h))


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


# Sheet 1: A=1 (X), B=2 (Y of 1); sheet 2: A=3 (X), B=4 (Y of 3). Three ``B``
# datasets (a third sheet's B whose record is gone), so ``B`` cannot be
# rank-aligned; ``A`` (two ids, two datasets) is.
_RECORDS = (
    _column_id_record(1, "A", "X")
    + _column_id_record(2, "B", "Y", partner=1)
    + _column_id_record(3, "A", "X")
    + _column_id_record(4, "B", "Y", partner=3)
)
_DATA = _ds("WBook_A") + _ds("WBook_B") + _ds("WBook_A@2") + _ds("WBook_B@2") + _ds("WBook_B@5")


def _curves(figs: list[dict[str, object]]) -> list[tuple[object, object, object]]:
    return [(c["book"], c["x"], c["y"]) for c in figs[0]["curves"]]  # type: ignore[index]


def test_header_refs_name_the_referencing_sheet() -> None:
    refs, names = header_column_refs(_ds("WBook_B@2", ref=3) + _ds("WBook_A"))
    assert refs == {3: {("WBook", "WBook@2")}}
    assert names == {("WBook", "B", "2"), ("WBook", "A", "")}


def test_partner_signal_binds_an_unaligned_column() -> None:
    """P: id 4's partner 3 is rank-proven on sheet 2, so id 4 is too."""
    figs = extract_figures_opju(_blob(_DATA, _RECORDS, _id_curve_token(0xBA, cid=4)))
    assert _curves(figs) == [("WBook@2", "A", "B")]
    assert "curve_sheet_omitted" not in figs[0]


def test_both_unaligned_ids_bind_their_own_sheets() -> None:
    figs = extract_figures_opju(
        _blob(_DATA, _RECORDS, _id_curve_token(0xBA, cid=2), _id_curve_token(0xBB, cid=4))
    )
    assert _curves(figs) == [("WBook", "A", "B"), ("WBook@2", "A", "B")]


def test_header_signal_binds_a_column_with_no_partner() -> None:
    """H: no stored partner, but ``WBook_B@2``'s header names id 4."""
    records = (
        _column_id_record(1, "A", "X")
        + _column_id_record(2, "B", "Y", partner=1)
        + _column_id_record(3, "A", "X")
        + _column_id_record(4, "B", "Y")
    )
    data = (
        _ds("WBook_A") + _ds("WBook_B") + _ds("WBook_A@2") + _ds("WBook_B@2", 4) + _ds("WBook_B@5")
    )
    figs = extract_figures_opju(_blob(data, records, _id_curve_token(0xBA, cid=4)))
    assert _curves(figs) == [("WBook@2", "A", "B")]  # X: sheet 2's own first X


def test_disagreeing_signals_prove_nothing() -> None:
    """H says sheet 1 (``WBook_B`` names id 4), P says sheet 2: omitted."""
    data = (
        _ds("WBook_A") + _ds("WBook_B", 4) + _ds("WBook_A@2") + _ds("WBook_B@2") + _ds("WBook_B@5")
    )
    figs = extract_figures_opju(_blob(data, _RECORDS, _id_curve_token(0xBA, cid=4)))
    assert figs[0]["curves"] == []
    assert [n["reason"] for n in figs[0]["curve_sheet_omitted"]] == ["sheet_unknown"]


def test_signal_naming_a_sheet_without_that_dataset_proves_nothing() -> None:
    """P says sheet 2, but the file stores no ``WBook_B@2``."""
    data = _ds("WBook_A") + _ds("WBook_B") + _ds("WBook_A@2") + _ds("WBook_B@5") + _ds("WBook_B@7")
    figs = extract_figures_opju(_blob(data, _RECORDS, _id_curve_token(0xBA, cid=4)))
    assert figs[0]["curves"] == []
    assert figs[0]["curve_sheet_omitted"][0]["reason"] == "sheet_unknown"


def test_two_ids_proven_onto_one_sheet_void_each_other() -> None:
    """Ids 4 and 5 both have partner 3 (sheet 2): a name occurs once per
    sheet, so neither is proven."""
    records = _RECORDS + _column_id_record(5, "B", "Y", partner=3)
    data = _DATA + _ds("WBook_B@6")
    b = _blob(data, records)
    table = column_id_table(b, opju_pages(b))
    rank = off_sheet_ids(b, table.ids)
    assert rank == {3: "WBook@2", 2: "", 4: "", 5: ""}
    got = resolve_unknown_sheets(b, table.ids, table.x_partner, rank)
    assert got == {3: "WBook@2", 2: "WBook", 4: "", 5: ""}


def test_newly_proven_x_column_plotted_as_y_stays_omitted() -> None:
    """Three ``A`` datasets, two ids: ``A`` is unaligned; ``WBook_B@2``'s
    header proves id 3 on sheet 2. Id 4 (Y of 3) binds; a curve plotting
    id 3 itself is withheld (its X is token-stored, plan item 70)."""
    data = (
        _ds("WBook_A") + _ds("WBook_B") + _ds("WBook_A@2") + _ds("WBook_B@2", 3) + _ds("WBook_A@5")
    )
    figs = extract_figures_opju(
        _blob(data, _RECORDS, _id_curve_token(0xBA, cid=4), _id_curve_token(0xBB, cid=3))
    )
    assert _curves(figs) == [("WBook@2", "A", "B")]
    assert [(n["recorded"], n["y"], n["reason"]) for n in figs[0]["curve_sheet_omitted"]] == [
        ("WBook@2", "A", "y_is_x_column")
    ]


def _stored_x(ref: int) -> bytes:
    """A curve token record's own X reference: ``<id:u16> 21 61``."""
    return b"\x81\x04" + ref.to_bytes(2, "little") + b"\x21\x61"


def test_newly_placed_curve_whose_token_stores_another_x_is_omitted() -> None:
    """Id 4 is placed by signal P with X ``A``; its token stores column B
    (id 2) as its X, which the decoder does not use: omitted, not drawn
    against A (2x glass Epoxy Graph1, Catchment Graph6 over COM)."""
    figs = extract_figures_opju(_blob(_DATA, _RECORDS, _id_curve_token(0xBA, cid=4) + _stored_x(2)))
    assert figs[0]["curves"] == []
    assert [(n["recorded"], n["y"], n["reason"]) for n in figs[0]["curve_sheet_omitted"]] == [
        ("WBook@2", "B", "x_token_differs")
    ]


def test_newly_placed_curve_whose_token_stores_its_own_x_is_drawn() -> None:
    figs = extract_figures_opju(_blob(_DATA, _RECORDS, _id_curve_token(0xBA, cid=4) + _stored_x(3)))
    assert _curves(figs) == [("WBook@2", "A", "B")]


def test_newly_placed_curve_is_omitted_when_another_token_stores_another_x() -> None:
    """Its own token names no X, but the layer's other token does (2x glass
    Epoxy Graph2 O/Q, drawn by Origin against the N@2 another token names)."""
    figs = extract_figures_opju(
        _blob(
            _DATA,
            _RECORDS,
            _id_curve_token(0xBA, cid=4),
            _id_curve_token(0xBB, cid=1) + _stored_x(2),
        )
    )
    assert ("WBook@2", "B", "x_token_differs") in [
        (n["recorded"], n["y"], n["reason"]) for n in figs[0]["curve_sheet_omitted"]
    ]


def test_newly_placed_histogram_is_omitted() -> None:
    """A plot-type tag Origin draws as a histogram (219 = ``0xdb``): the
    decoder would draw Y against its designated X, Origin bins Y."""
    figs = extract_figures_opju(
        _blob(_DATA, _RECORDS, _id_curve_token(0xBA, cid=4) + b"\x8f\x01\xdb\x83")
    )
    assert figs[0]["curves"] == []
    assert figs[0]["curve_sheet_omitted"][0]["reason"] == "plot_type_not_drawn"


def test_newly_placed_line_plot_type_is_drawn() -> None:
    figs = extract_figures_opju(
        _blob(_DATA, _RECORDS, _id_curve_token(0xBA, cid=4) + b"\x8f\x01\xc8\x83")
    )
    assert _curves(figs) == [("WBook@2", "A", "B")]


def test_every_curve_of_a_filtered_book_is_omitted() -> None:
    """A book page storing a worksheet data filter (``__STGCOLFILTER``):
    Origin plots only the rows the undecoded condition keeps, so no curve of
    that book is drawn -- rank-proven ones included."""
    records = _RECORDS + b"\x9a\x01\x1b__STGCOLFILTER\x04\x01"
    figs = extract_figures_opju(
        _blob(_DATA, records, _id_curve_token(0xBA, cid=4), _id_curve_token(0xBB, cid=1))
    )
    assert figs[0]["curves"] == []
    assert {n["reason"] for n in figs[0]["curve_sheet_omitted"]} == {"worksheet_filter"}


def _narrow_record(cid: int, name: str, partner: int, form: str) -> bytes:
    """A u8-id column record, form A1 or B1 (no ``<pb>`` byte)."""
    lead = b"\x01\x10\x80\x01" if form == "A1" else b"\x05\x10\x01\x00\x00"
    nm = name.encode("latin1")
    return (
        b"\x80\x32"
        + lead
        + bytes([cid])
        + b"\x83\x01\x65"
        + bytes([0x83, len(nm)])
        + nm
        + b"\x88\x01\x09"
        + b"\x81\x04"
        + partner.to_bytes(2, "little")
        + b"\x21\x61"
    )


@pytest.mark.parametrize("form", ["A1", "B1"])
def test_u8_id_record_forms_resolve(form: str) -> None:
    records = _column_id_record(1, "A", "X") + _narrow_record(2, "B", 1, form)
    b = _blob(_ds("WBook_A") + _ds("WBook_B"), records, _id_curve_token(0xBA, cid=2, width=1))
    table = column_id_table(b, opju_pages(b))
    assert table.ids[2] == ("WBook", "B")
    assert table.x_partner[2] == 1
    assert _curves(extract_figures_opju(b)) == [("WBook", "A", "B")]


def test_u8_lead_bytes_without_a_record_resolve_nothing() -> None:
    """The lead bytes alone (no name + ``09`` separator + marker) are not a record."""
    records = _column_id_record(1, "A", "X") + b"\x80\x32\x01\x10\x80\x01\x02\x83\x01\x65\x00"
    b = _blob(_ds("WBook_A"), records)
    assert 2 not in column_id_table(b, opju_pages(b)).ids


# ---- realdata anchors (values: Origin 2026b COM, 2026-11-15) ----

_PEDOT = "origin/public/ericmuckley_intelligent-characterization/data/pedotpss_IV_2019-08-01.opju"
_RISK = (
    "origin/public/he-xiaolin_Online-perceived-risk-study/Fig3_ExtFig5/"
    "PerceivedRiskandPrediction.opju"
)


def _import(corpus_dir: Path, rel: str) -> tuple[list[dict[str, object]], dict[str, object]]:
    project = corpus_dir / rel
    if not project.is_file():
        pytest.skip(f"{rel} not present")
    _primary, books = read_origin_project_all(project)
    kept = drop_empty_library_books(books)
    figs = unbound_rebinds(extract_figures_opju(project.read_bytes()), kept)
    return figs, {str(b.metadata.get("origin_book")): b for b in kept}


@pytest.mark.realdata
def test_realdata_pedotpss_graph7_binds_every_plotted_column(corpus_dir: Path) -> None:
    """Origin plots Book1_B@2 ... Book1_AU@2 (46 curves) against Book1_A@2;
    before the u8 id forms only AC..AU (19) were decoded."""
    import numpy as np

    figs, books = _import(corpus_dir, _PEDOT)
    (f,) = [f for f in figs if (f["name"], f["layer"]) == ("Graph7", 1)]
    curves = f["curves"]  # type: ignore[index]
    assert len(curves) == 46
    assert {c["book"] for c in curves} == {"Book1@2"}
    assert [c["y"] for c in curves][:3] == ["B", "C", "D"]
    ds = books["Book1@2"]
    names = list(ds.metadata["origin_column_names"])  # type: ignore[attr-defined]
    y = np.asarray(ds.values, dtype=float)[:, names.index("K")]  # type: ignore[attr-defined]
    y = y[np.isfinite(y)]
    assert y.size == 101  # Book1_K@2: n 101, max 0.064608764
    assert y.max() == pytest.approx(0.064608764, rel=1e-9)


@pytest.mark.realdata
def test_realdata_perceived_risk_graph50_binds_sheet_18(corpus_dir: Path) -> None:
    """``Book1D`` has more ``D`` datasets than ``D`` ids, so the rank
    alignment proves no ``D``; its stored X partner (``A@18``) does.
    Book1D_D@18 (n 301, 1.04696788288531..1.8825768813079) is in Graph50 as
    a Y-error-bar plot (COM ``GetPlotType`` 231, 2026-11-15) on
    ``Book1D_C@18``: left out as a curve, on its proven sheet."""
    import numpy as np

    figs, books = _import(corpus_dir, _RISK)
    (f,) = [f for f in figs if (f["name"], f["layer"]) == ("Graph50", 1)]
    notes = f["curve_sheet_omitted"]
    (n,) = [n for n in notes if n["y"] == "D"]  # type: ignore[union-attr,index]
    assert (n["recorded"], n["reason"]) == ("Book1D@18", "error_bar_plot")  # type: ignore[index]
    ds = books["Book1D@18"]
    names = list(ds.metadata["origin_column_names"])  # type: ignore[attr-defined]
    y = np.asarray(ds.values, dtype=float)[:, names.index("D")]  # type: ignore[attr-defined]
    x = np.asarray(ds.time, dtype=float)  # type: ignore[attr-defined]
    y, x = y[np.isfinite(y)], x[np.isfinite(x)]
    assert y.size == 301 and x.size == 301
    assert (y.min(), y.max()) == pytest.approx((1.04696788288531, 1.8825768813079), rel=1e-12)
    assert (x.min(), x.max()) == pytest.approx((0.0, 30.0))


_LIKELIHOOD = (
    "origin/public/pdalcastel_IAV_Infection_CC3D_MaBoSS_2026/results_and_plots/"
    "likelihood_profile.opju"
)


@pytest.mark.realdata
def test_realdata_filtered_books_are_not_drawn(corpus_dir: Path) -> None:
    """Graph2 plots B of Book1-7. Origin's own row counts (COM 2026-11-15):
    the 5 books with a worksheet data filter plot 48/2/5/16/290 rows, not
    the 3000/1000/1010/1000/1000 stored; Book4 (no filter) plots all 1000
    and stays drawn."""
    figs, _books = _import(corpus_dir, _LIKELIHOOD)
    (f,) = [f for f in figs if (f["name"], f["layer"]) == ("Graph2", 1)]
    assert [c["book"] for c in f["curves"]] == ["Book4"]  # type: ignore[union-attr]
    notes = f["curve_sheet_omitted"]
    filtered = {n["book"] for n in notes if n["reason"] == "worksheet_filter"}  # type: ignore[union-attr]
    assert {"Book1", "Book2", "Book3", "Book6", "Book7"} <= filtered

"""``.opju`` curve sheets (``opju_curve_sheets``): a curve on sheet N binds to
the importer's ``Book@N`` pseudo-book; a curve whose sheet (or whose X
column's sheet) is not proven, or whose ``Book@N`` columns were not imported,
is omitted and diagnosed, never drawn from the wrong sheet.

Synthetic bytes only (invented names) except the ``realdata`` anchors, whose
expected values were read from Origin 2026b over COM on 2026-11-15: plotted
dataset names (``%Z``, ``%(i,@D)``, ``%(iX,@D)``) and those datasets' values
(``sum()`` count/min/max).
"""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from opju_fixture import block, header
from quantized.datastruct import DataStruct
from quantized.io.origin_project import drop_empty_library_books, read_origin_project_all
from quantized.io.origin_project.fidelity import assess_origin_figures
from quantized.io.origin_project.figures_opju import extract_figures_opju
from quantized.io.origin_project.opju_curve_sheets import (
    curve_sheet,
    dataset_sheet_order,
    off_sheet_ids,
    sheet_x_names,
    unbound_rebinds,
    without_captions,
    without_positions,
)
from test_io_origin_figures_opju import (
    _column_id_record,
    _id_curve_token,
    _layer_bytes,
    _opju_page_header,
)


def _name(text: str) -> bytes:
    """A dataset's 147-byte storage header (no record body: only its name and
    file position matter to the sheet order)."""
    return b"\x00" + block(header(text, kind=0x10, total=3, used=3, size=8))


# Two sheets, both with columns A (X) and B (Y): ids 1/2 on sheet 1, 3/4 on
# sheet 2 -- all four id records sit in the one WBook page span.
_RECORDS = (
    _column_id_record(1, "A", "X")
    + _column_id_record(2, "B", "Y", partner=1)
    + _column_id_record(3, "A", "X")
    + _column_id_record(4, "B", "Y", partner=3)
)
_LAYER = _layer_bytes(0.0, 9.0, 0.0, 1000.0, 200.0, 0x03, r"\l(1) %(1)")


def _blob(datasets: list[str], *tokens: bytes, records: bytes = _RECORDS) -> bytes:
    data = b"".join(_name(d) for d in datasets)
    return (
        b"CPYUA 4.3811 222\n"
        + data
        + _opju_page_header("WBook")
        + records
        + _opju_page_header("Graph1")
        + _LAYER
        + b"".join(tokens)
    )


_TWO_SHEETS = ["WBook_A", "WBook_B", "WBook_A@2", "WBook_B@2"]


def test_dataset_sheet_order_is_first_occurrence_file_order() -> None:
    b = _name("Bk_B@3") + _name("Bk_B") + _name("Bk_B@3") + _name("Bk_C")
    assert dataset_sheet_order(b) == {("Bk", "B"): ["3", ""], ("Bk", "C"): [""]}


def test_dataset_sheet_order_ignores_name_shaped_bytes() -> None:
    """A length-prefixed name outside any storage header does not count."""
    b = b"\x06Bk_B@2" + _name("Bk_B") + _name("Bk_B@2")
    assert dataset_sheet_order(b) == {("Bk", "B"): ["", "2"]}


def test_without_positions() -> None:
    """A dense legend loses exactly the omitted curves' captions."""
    assert without_positions(["a", "b", "c", "d"], {0, 2}) == ["b", "d"]


def test_off_sheet_ids_rank_alignment() -> None:
    ids = {1: ("Bk", "A"), 2: ("Bk", "B"), 7: ("Bk", "B"), 9: ("Bk", "C")}
    # B: id 2 was created first and its dataset is the @4 one; C has one id
    # and no suffixed dataset (plain); A has one id but a suffixed dataset
    # as well, so the counts differ and nothing is proven.
    b = _name("Bk_A") + _name("Bk_B@4") + _name("Bk_A@4") + _name("Bk_B") + _name("Bk_C")
    assert off_sheet_ids(b, ids) == {1: "", 2: "Bk@4"}


@pytest.mark.parametrize(
    ("cid", "partner", "want"),
    [
        (2, 1, ("Bk", "")),  # sheet 1: unchanged binding
        (4, 3, ("Bk@2", "")),  # sheet 2, X partner on sheet 2
        (4, None, ("Bk@2", "")),  # sheet 2, no partner: sheet_x_names decides X
        (4, 1, ("Bk@2", "x_sheet_unproven")),  # X partner on sheet 1
        (4, 5, ("Bk@2", "x_sheet_unproven")),  # X partner's sheet unknown
        (6, 3, ("", "sheet_unknown")),
        (2, 3, ("Bk", "x_sheet_unproven")),  # sheet-1 Y, X proven on sheet 2
        (2, 5, ("Bk", "")),  # sheet-1 Y, X sheet unknown: as shipped before
    ],
)
def test_curve_sheet(cid: int, partner: int | None, want: tuple[str, str]) -> None:
    off = {3: "Bk@2", 4: "Bk@2", 5: "", 6: ""}
    assert curve_sheet(cid, "Bk", partner, off) == want


def test_curve_on_a_later_sheet_binds_its_pseudo_book() -> None:
    figs = extract_figures_opju(_blob(_TWO_SHEETS, _id_curve_token(0xBA, cid=4)))
    assert len(figs) == 1
    assert figs[0]["curves"] == [{"book": "WBook@2", "x": "A", "y": "B"}]
    assert "curve_sheet_omitted" not in figs[0]


def test_later_sheet_curve_with_x_partner_on_sheet_one_is_omitted() -> None:
    """Y on sheet 2 whose stored X partner is sheet 1's A: the X column
    cannot be named in ``WBook@2``, so nothing is drawn."""
    records = (
        _column_id_record(1, "A", "X")
        + _column_id_record(2, "B", "Y", partner=1)
        + _column_id_record(3, "A", "X")
        + _column_id_record(4, "B", "Y", partner=1)
    )
    figs = extract_figures_opju(_blob(_TWO_SHEETS, _id_curve_token(0xBA, cid=4), records=records))
    assert figs[0]["curves"] == []
    assert figs[0]["curve_sheet_omitted"] == [
        {"book": "WBook", "x": "A", "y": "B", "recorded": "WBook@2", "reason": "x_sheet_unproven"}
    ]


def test_curve_on_the_plain_sheet_of_a_multi_sheet_book_is_kept() -> None:
    figs = extract_figures_opju(_blob(_TWO_SHEETS, _id_curve_token(0xBA, cid=2)))
    assert figs[0]["curves"] == [{"book": "WBook", "x": "A", "y": "B"}]
    assert "curve_sheet_omitted" not in figs[0]


def test_dataset_order_follows_creation_not_sheet_number() -> None:
    """Sheet 2's ``B`` created before sheet 1's: id 2 is ``B@2``, id 4 plain."""
    order = ["WBook_A", "WBook_B@2", "WBook_A@2", "WBook_B"]
    records = (
        _column_id_record(1, "A", "X")
        + _column_id_record(2, "B", "Y")
        + _column_id_record(3, "A", "X")
        + _column_id_record(4, "B", "Y")
    )
    lower = extract_figures_opju(_blob(order, _id_curve_token(0xBA, cid=2), records=records))[0]
    assert [(c["book"], c["y"]) for c in lower["curves"]] == [("WBook@2", "B")]
    higher = extract_figures_opju(_blob(order, _id_curve_token(0xBA, cid=4), records=records))[0]
    assert [(c["book"], c["y"]) for c in higher["curves"]] == [("WBook", "B")]


def test_sheet_x_names_is_each_sheets_first_x() -> None:
    ids = {1: ("Bk", "A"), 3: ("Bk", "T"), 5: ("Bk", "U"), 7: ("Bk", "A")}
    off = {3: "Bk@2", 5: "Bk@2", 7: ""}
    assert sheet_x_names(ids, [1, 3, 5, 7], off) == {"Bk@2": "T"}


def test_later_sheet_curve_without_partner_takes_its_sheets_x() -> None:
    """No stored partner: sheet 2's own X (``T``), not sheet 1's ``A``."""
    records = (
        _column_id_record(1, "A", "X")
        + _column_id_record(2, "B", "Y")
        + _column_id_record(3, "T", "X")
        + _column_id_record(4, "B", "Y")
    )
    names = ["WBook_A", "WBook_B", "WBook_T@2", "WBook_B@2"]
    figs = extract_figures_opju(_blob(names, _id_curve_token(0xBA, cid=4), records=records))
    assert figs[0]["curves"] == [{"book": "WBook@2", "x": "T", "y": "B"}]


def test_later_sheet_curve_without_any_x_on_its_sheet_is_omitted() -> None:
    records = (
        _column_id_record(1, "A", "X")
        + _column_id_record(2, "B", "Y")
        + _column_id_record(4, "B", "Y")
    )
    names = ["WBook_A", "WBook_B", "WBook_B@2"]
    figs = extract_figures_opju(_blob(names, _id_curve_token(0xBA, cid=4), records=records))
    assert figs[0]["curves"] == []
    assert figs[0]["curve_sheet_omitted"][0]["reason"] == "x_sheet_unproven"


@pytest.mark.parametrize(
    ("labels", "gone", "want"),
    [
        (["a", "b", "c"], {1}, ["a", "c"]),
        (["%(1)", "%(2)", "%(3)"], {0}, ["%(1)", "%(2)"]),
        (["x", "%(4)", "", "%(7,@LG)"], {0, 2}, ["%(2)", "%(5,@LG)"]),
        ([r"\l(2) %(2)", "%(1) vs %(3)", "z"], {0}, ["", "z"]),
    ],
)
def test_without_captions_renumbers_curve_references(
    labels: list[str], gone: set[int], want: list[str]
) -> None:
    """A reference to a later curve follows it to its new number; one to an
    omitted curve leaves no caption rather than another curve's name."""
    assert without_captions(labels, gone) == want


def test_unalignable_sheet_fails_closed_with_unknown_sheet() -> None:
    """Two ``B`` ids but one ``B`` dataset: the rank alignment proves neither.
    Id 4's X partner (A, id 3) is on sheet 2, which stores no ``WBook_B@2``,
    so the second signal (``opju_sheet_signals``) proves nothing either."""
    figs = extract_figures_opju(
        _blob(["WBook_A", "WBook_B", "WBook_A@2"], _id_curve_token(0xBA, cid=4))
    )
    assert figs[0]["curves"] == []
    assert figs[0]["curve_sheet_omitted"] == [
        {"book": "WBook", "x": "A", "y": "B", "recorded": "", "reason": "sheet_unknown"}
    ]


def test_same_column_of_two_sheets_keeps_both() -> None:
    """The later-sheet token comes first; neither dedups the other away."""
    figs = extract_figures_opju(
        _blob(_TWO_SHEETS, _id_curve_token(0xBA, cid=4), _id_curve_token(0xBB, cid=2))
    )
    assert [(c["book"], c["y"]) for c in figs[0]["curves"]] == [("WBook@2", "B"), ("WBook", "B")]
    assert "curve_sheet_omitted" not in figs[0]


def test_single_sheet_book_is_untouched() -> None:
    records = _column_id_record(1, "A", "X") + _column_id_record(2, "B", "Y", partner=1)
    figs = extract_figures_opju(
        _blob(["WBook_A", "WBook_B"], _id_curve_token(0xBA, cid=2), records=records)
    )
    assert figs[0]["curves"] == [{"book": "WBook", "x": "A", "y": "B"}]
    assert "curve_sheet_omitted" not in figs[0]


# ── import-time check: the re-bound sheet's columns must exist ───────────────


def _book(key: str, x: str, names: list[str]) -> DataStruct:
    n = len(names)
    return DataStruct(
        time=np.arange(3.0),
        values=np.ones((3, n)),
        labels=tuple(names),
        units=("",) * n,
        metadata={"origin_book": key, "x_column_name": x, "origin_column_names": names},
    )


def test_unbound_rebinds_omits_what_the_import_cannot_draw() -> None:
    curves = [
        {"book": "Bk", "x": "Z", "y": "Q"},  # sheet 1: left as decoded
        {"book": "Bk@2", "x": "A", "y": "B"},  # drawable
        {"book": "Bk@2", "x": "A", "y": "A"},  # Y is the sheet's X column
        {"book": "Bk@2", "x": "K", "y": "C"},  # X column not imported
        {"book": "Bk@3", "x": "A", "y": "B"},  # sheet not imported
    ]
    fig = {"name": "G", "layer": 1, "curves": curves, "legend_labels": ["s1", "b", "a", "c", "s3"]}
    (out,) = unbound_rebinds([fig], [_book("Bk", "A", ["B"]), _book("Bk@2", "A", ["B", "C"])])
    assert out["curves"] == curves[:2]
    assert out["legend_labels"] == ["s1", "b"]
    assert [(n["recorded"], n["y"], n["reason"]) for n in out["curve_sheet_omitted"]] == [
        ("Bk@2", "A", "y_is_sheet_x"),
        ("Bk@2", "C", "column_not_imported"),
        ("Bk@3", "B", "book_not_imported"),
    ]
    assert {n["book"] for n in out["curve_sheet_omitted"]} == {"Bk"}


def test_unbound_rebinds_leaves_a_drawable_figure_identical() -> None:
    fig = {"name": "G", "layer": 1, "curves": [{"book": "Bk@2", "x": "", "y": "B"}]}
    assert unbound_rebinds([fig], [_book("Bk@2", "A", ["B"])]) == [fig]


def _fig(**extra: object) -> dict[str, object]:
    return {"name": "Graph1", "layer": 1, "curves": [], "source_hint": "", **extra}


def test_fidelity_keeps_a_layer_whose_curves_were_all_omitted() -> None:
    """Such a layer is a real user graph, not an internal record: it stays
    actionable and its fidelity says why it has no curves."""
    note = {"book": "WBook", "x": "A", "y": "B", "recorded": "", "reason": "sheet_unknown"}
    kept = {"book": "WBook", "x": "A", "y": "C"}
    actionable, manifest = assess_origin_figures(
        [_fig(curves=[kept], curve_sheet_omitted=[note]), _fig(curve_sheet_omitted=[note])],
        container="opju",
    )
    assert len(actionable) == 2
    assert manifest["filtered_figures"] == []
    for fig in actionable:
        assert "curve_sheet_unresolved" in fig["fidelity"]["omissions"]
    assert "curve_sheet_unresolved" in manifest["omissions"]


# ── realdata anchors (Origin 2026b COM, 2026-11-15) ──────────────────────────
#
# Each anchor resolves the decoded curve the way the frontend does
# (originFigureSelection.figureBindingFor: the book whose ``origin_book`` is
# the curve's ``book``, Y and X looked up BY NAME in ``origin_column_names``,
# X = the book's own X column when it is ``x_column_name``) and checks the
# values against the numbers Origin itself reported for the plotted Y and X
# datasets over COM on 2026-11-15 (``sum(<dataset>)``: sum.n/min/max).

_SOP = "origin/public/Techboyjohnny-98_SOP_measurement_SHAP/OriginPro file/SOP_meas.opju"
_RISK = (
    "origin/public/he-xiaolin_Online-perceived-risk-study/Fig3_ExtFig5/"
    "PerceivedRiskandPrediction.opju"
)
_ABS = "origin/public/Since-Ufa_Diplom/paper/pictures/Absorption-D3.opju"


def _import(corpus_dir: Path, rel: str) -> tuple[list[dict[str, Any]], dict[str, DataStruct]]:
    project = corpus_dir / rel
    if not project.is_file():
        pytest.skip(f"{rel} not present")
    _primary, books = read_origin_project_all(project)
    kept = drop_empty_library_books(books)
    figs = unbound_rebinds(extract_figures_opju(project.read_bytes()), kept)
    return figs, {str(b.metadata.get("origin_book")): b for b in kept}


def _layer(figs: list[dict[str, Any]], page: str, layer: int) -> dict[str, Any]:
    got = [f for f in figs if (f["name"], f["layer"]) == (page, layer)]
    assert len(got) == 1
    return got[0]


def _drawn(
    books: Mapping[str, DataStruct], curve: Mapping[str, Any]
) -> tuple[np.ndarray, np.ndarray]:
    ds = books[str(curve["book"])]
    names = list(ds.metadata["origin_column_names"])
    values = np.asarray(ds.values, dtype=float)
    y = values[:, names.index(curve["y"])]
    x_name = curve.get("x") or ""
    if not x_name or x_name == ds.metadata.get("x_column_name"):
        x = np.asarray(ds.time, dtype=float)
    else:
        x = values[:, names.index(x_name)]
    return x, y


def _assert_origin(a: np.ndarray, n: int, lo: float, hi: float) -> None:
    f = a[np.isfinite(a)]
    assert f.size == n
    assert f.min() == pytest.approx(lo, rel=1e-12)
    assert f.max() == pytest.approx(hi, rel=1e-12)


@pytest.mark.realdata
def test_realdata_sop_old_layer5_binds_sheet_two(corpus_dir: Path) -> None:
    """Origin plots SOPCC25degC2_C@2 ... _AA@2 (13 curves), all on sheet 2,
    each against its own X (``%(1X,@D)`` = SOPCC25degC2_B@2 for C@2)."""
    figs, books = _import(corpus_dir, _SOP)
    f = _layer(figs, "old", 5)
    want = ["C", "E", "G", "I", "K", "M", "O", "Q", "S", "U", "W", "Y", "AA"]
    rebound = [c for c in f["curves"] if c["book"] == "SOPCC25degC2@2"]
    assert [c["y"] for c in rebound] == want
    # sheet 1's AR / AT: 2-byte id chunks (opju_curve_token); Origin plots
    # SOPCC25degC2_AR and _AT here too (COM, 2026-11-15)
    assert [c["y"] for c in f["curves"] if c["book"] == "SOPCC25degC2"] == ["AR", "AT"]
    x, y = _drawn(books, rebound[0])
    _assert_origin(y, 15, 18.215624697788, 112.75799918781)  # SOPCC25degC2_C@2
    _assert_origin(x, 15, 0.0, 2.966171615)  # SOPCC25degC2_B@2


@pytest.mark.realdata
def test_realdata_sop_graph73_binds_sheet_five(corpus_dir: Path) -> None:
    """Origin plots SOPvsHPPCA123_B@5/_C@5/_D@5 against _A@5 (COM, Origin
    2026b). Sheet 5's labels now bind to its own column records by name
    (decode-plan item 73), so A is its X and B a Y, as ``wks.col.type``
    reads them; the positional reading made B the X and dropped the B curve
    as ``y_is_sheet_x``. Graph73 decodes since the separator-flag admission
    (#681): a missing layer is a regression, so it fails here; the test
    skips only when the corpus file is absent."""
    figs, books = _import(corpus_dir, _SOP)
    f = _layer(figs, "Graph73", 1)
    assert [(c["book"], c["x"], c["y"]) for c in f["curves"]] == [
        ("SOPvsHPPCA123@5", "A", "B"),
        ("SOPvsHPPCA123@5", "A", "C"),
        ("SOPvsHPPCA123@5", "A", "D"),
    ]
    assert f.get("curve_sheet_omitted", []) == []
    x, _y = _drawn(books, f["curves"][0])
    _assert_origin(x, 9, 15.0, 95.0)  # SOPvsHPPCA123_A@5


@pytest.mark.realdata
def test_realdata_perceived_risk_graph59_binds_sheet_27(corpus_dir: Path) -> None:
    figs, books = _import(corpus_dir, _RISK)
    f = _layer(figs, "Graph59", 1)
    (c,) = [c for c in f["curves"] if c["y"] == "C"]
    assert c["book"] == "Book1D@27"
    x, y = _drawn(books, c)
    _assert_origin(y, 301, 1.2954796030871, 5.14595287092164)  # Book1D_C@27
    _assert_origin(x, 301, 0.0, 30.0)  # Book1D_A@27


@pytest.mark.realdata
def test_realdata_absorption_graph1baaa_binds_sheet_three(corpus_dir: Path) -> None:
    figs, books = _import(corpus_dir, _ABS)
    f = _layer(figs, "Graph1BAAA", 1)
    (c,) = [c for c in f["curves"] if c["book"] == "Cu5SCH34vac@3"]
    x, y = _drawn(books, c)
    _assert_origin(y, 1400, 0.00253020448729656, 0.220228051739646)  # Cu5SCH34vac_B@3
    _assert_origin(x, 1400, 201.03, 487.165471428571)  # Cu5SCH34vac_A@3


@pytest.mark.realdata
def test_realdata_plain_sheet_of_two_sheet_book_is_kept(corpus_dir: Path) -> None:
    """Origin plots unsuffixed rangeEstim_C/_E/_G; the book has a second sheet
    with its own C/E/G, and these stay on sheet 1."""
    figs, _books = _import(corpus_dir, _SOP)
    f = _layer(figs, "Graph58", 9)
    ys = {c["y"] for c in f["curves"] if c["book"] == "rangeEstim"}
    assert {"C", "E", "G"} <= ys

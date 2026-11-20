"""``.opju`` box / violin / strip and histogram graphs (plan item 6 of
``ORIGIN_PLOT_TYPE_PARITY_PLAN``): the category-axis record whose END
separator ends ``02``, the row-less curve rule and the page-template kind.

Synthetic bytes only (invented names) for the shapes. The ``realdata`` anchors
check the decode against Origin 2026b Student COM (``layer.x/y.from/to``,
``DataPlot::GetPlotType()``, ``xof``; 2026-11-15) and auto-skip without the
corpus.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from quantized.io.origin_project import drop_empty_library_books, read_origin_project_all
from quantized.io.origin_project.fidelity import assess_origin_figures
from quantized.io.origin_project.figures_opju import extract_figures_opju
from quantized.io.origin_project.import_manifest import origin_figures_and_fidelity
from quantized.io.origin_project.opju_plot_gates import PLOT_TYPE_OFF
from quantized.io.origin_project.opju_plot_kinds import (
    X_NOT_A_COLUMN,
    apply_plot_kind,
    mark_rowless,
    rowless_kind,
    stat_x_reason,
)
from quantized.io.origin_project.opju_stat_plots import (
    BOX_KIND_NOT_DECODED,
    BOX_MARKS_NOT_DECODED,
    HISTOGRAM_BINS_NOT_DECODED,
    HISTOGRAM_OF_SEVERAL_COLUMNS,
    STAT_LAYER_IN_PANELS,
    STAT_LAYER_OF_SEVERAL_BOOKS,
    apply_stat_kinds,
)
from test_io_origin_figures_opju import _real_form_tagged_and_rle
from test_io_origin_opju_numeric_columns import _MAGIC, _graph_page

# ── the category-axis end separator ``8x .. .. 00 <flag> 02`` ────────────────

_FIRST = b"\x81\x0d\x08\x00\x00\x01"
_END = b"\x81\x35\x08\x00\x00\x01"


def _record(first: bytes = _FIRST, end: bytes = _END) -> bytes:
    rec = _real_form_tagged_and_rle()
    assert _FIRST in rec and _END in rec
    return _MAGIC + rec.replace(_FIRST, first).replace(_END, end)


@pytest.mark.parametrize("lead", [0x80, 0x81])
def test_end_separator_ending_02_decodes(lead: int) -> None:
    end = bytes([lead]) + b"\x35\x08\x00\x00\x02"
    (f,) = extract_figures_opju(_record(end=end))
    assert (f["x_from"], f["x_to"]) == (pytest.approx(0.2), 2.0)
    assert (f["y_from"], f["y_to"]) == (1.0, 450000.0)


def test_02_on_the_first_separator_stays_unrecovered() -> None:
    """Only the END separator may end ``02`` (workbook-embedded graphs carry it
    on both separators and no oracle covers them): fail closed."""
    first = b"\x81\x0d\x08\x00\x00\x02"
    assert extract_figures_opju(_record(first=first)) == []
    assert extract_figures_opju(_record(first=first, end=b"\x81\x35\x08\x00\x00\x02")) == []


def test_other_end_bytes_stay_unrecovered() -> None:
    assert extract_figures_opju(_record(end=b"\x81\x35\x08\x00\x00\x03")) == []


# ── the row-less curve rule ───────────────────────────────────────────────────


def _rec(code: int) -> bytes:
    rec = bytearray(PLOT_TYPE_OFF + 8)
    rec[PLOT_TYPE_OFF] = code
    return bytes(rec)


def test_rowless_kind_is_box_or_histogram_with_no_x_column() -> None:
    assert rowless_kind(X_NOT_A_COLUMN, _rec(206)) == "box"
    assert rowless_kind(X_NOT_A_COLUMN, _rec(219)) == "histogram"
    assert rowless_kind(X_NOT_A_COLUMN, _rec(200)) is None  # a line: stays omitted
    assert rowless_kind(X_NOT_A_COLUMN, _rec(203)) is None
    assert rowless_kind("", _rec(206)) is None  # an X column: not this shape
    assert rowless_kind("x_other_book", _rec(219)) is None
    assert rowless_kind(X_NOT_A_COLUMN, None) is None
    curve: dict[str, str | float] = {"book": "B", "x": "A", "y": "C", "style": "scatter"}
    mark_rowless(curve, "box")
    assert curve == {"book": "B", "x": "", "y": "C", "plotType": "box"}


def test_stat_plot_with_an_x_is_omitted() -> None:
    """A 206 / 219 curve that is not row-less (undecodable or column X) would
    draw Origin's box as a line against that X: omitted."""
    assert stat_x_reason(None, _rec(206)) == "stat_plot_x_not_decoded"
    assert stat_x_reason(None, _rec(219)) == "stat_plot_x_not_decoded"
    assert stat_x_reason("box", _rec(206)) == ""
    assert stat_x_reason(None, _rec(200)) == ""
    assert stat_x_reason(None, None) == ""


def test_column_record_marks_the_column_plot_type() -> None:
    curve: dict[str, str | float] = {"book": "B", "x": "A", "y": "C"}
    apply_plot_kind(curve, _rec(203))
    assert curve["plotType"] == "column"
    for code in (200, 213, 215, 207):
        other: dict[str, str | float] = {"y": "C"}
        apply_plot_kind(other, _rec(code))
        assert "plotType" not in other
    boxed: dict[str, str | float] = {"x": "A", "y": "C", "style": "line"}
    apply_plot_kind(boxed, _rec(206), "box")
    assert boxed == {"x": "", "y": "C", "plotType": "box"}


def test_only_a_single_column_series_keeps_its_bars() -> None:
    col = {"book": "Bk", "x": "A", "y": "B", "plotType": "column"}
    line = {"book": "Bk", "x": "A", "y": "D", "style": "line"}
    one = [{"name": "G", "curves": [col, line]}]
    assert apply_stat_kinds(one, _MAGIC)[0]["curves"] == [col, line]
    two = [{"name": "G", "curves": [col, {**col, "y": "C"}]}]
    assert [c.get("plotType") for c in apply_stat_kinds(two, _MAGIC)[0]["curves"]] == [None, None]


# ── the page-template kind and the per-layer gates ────────────────────────────


def _box(y: str, kind: str = "box") -> dict[str, str]:
    return {"book": "Bk", "x": "", "y": y, "plotType": kind}


@pytest.mark.parametrize(
    ("template", "kind"),
    [("Box", "box"), ("BOX+DATA+", "box"), ("Violin", "violin"), ("ViolinDat", "violin"),
     ("ColumnSca", "strip")],
)
def test_box_family_kind_from_the_page_template(template: str, kind: str) -> None:
    b = _MAGIC + _graph_page("Graph1", template)
    figs = [{"name": "Graph1", "curves": [_box("B"), _box("C")], "legend_labels": ["b", "c"]}]
    (out,) = apply_stat_kinds(figs, b)
    assert [c["plotType"] for c in out["curves"]] == [kind, kind]
    assert [c["x"] for c in out["curves"]] == ["", ""]
    assert out["legend_labels"] == ["b", "c"]


@pytest.mark.parametrize("template", ["MergeGrap", "Line", "BoxViolin"])
def test_unnamed_box_kind_fails_closed(template: str) -> None:
    b = _MAGIC + _graph_page("Graph1", template)
    figs = [{"name": "Graph1", "curves": [_box("B")], "legend_labels": ["b"]}]
    (out,) = apply_stat_kinds(figs, b)
    assert out["curves"] == [] and out["legend_labels"] == []
    assert [n["reason"] for n in out["curve_sheet_omitted"]] == [BOX_KIND_NOT_DECODED]


def test_mixed_layer_omits_its_rowless_curves() -> None:
    line = {"book": "Bk", "x": "A", "y": "D", "style": "line"}
    figs = [{"name": "G", "curves": [_box("B", "histogram"), line], "legend_labels": ["h", "l"]}]
    (out,) = apply_stat_kinds(figs, _MAGIC)
    assert out["curves"] == [line] and out["legend_labels"] == ["l"]
    assert out["curve_sheet_omitted"] == [
        {"book": "Bk", "x": "", "y": "B", "recorded": "Bk", "reason": X_NOT_A_COLUMN}
    ]


def test_histogram_of_one_column_kept_of_several_omitted() -> None:
    one = [{"name": "G1", "curves": [_box("B", "histogram")]}]
    assert apply_stat_kinds(one, _MAGIC)[0]["curves"] == [_box("B", "histogram")]
    two = [{"name": "G1", "curves": [_box("B", "histogram"), _box("C", "histogram")]}]
    (out,) = apply_stat_kinds(two, _MAGIC)
    assert out["curves"] == []
    assert {n["reason"] for n in out["curve_sheet_omitted"]} == {HISTOGRAM_OF_SEVERAL_COLUMNS}


def test_multi_layer_and_unnamed_pages_omit() -> None:
    """A page with two decoded layers is applied panel by panel on the XY
    stage, and an unnamed (embedded) graph is no page: neither opens the Stat
    Stage, so their row-less curves are omitted, never drawn against X."""
    figs = [
        {"name": "G1", "layer": 1, "curves": [_box("B", "histogram")]},
        {"name": "G1", "layer": 2, "curves": [{"book": "Bk", "x": "A", "y": "C"}]},
        {"name": "", "layer": 1, "curves": [_box("D", "histogram")]},
    ]
    out = apply_stat_kinds(figs, _MAGIC)
    assert out[0]["curves"] == [] and out[2]["curves"] == []
    assert out[1] is figs[1]
    assert out[0]["curve_sheet_omitted"][0]["reason"] == STAT_LAYER_IN_PANELS


def test_drawn_stat_figures_carry_their_fidelity_note() -> None:
    """A drawn histogram says its bins are quantized's, a drawn box family
    figure that its marks are; the note reaches the figure's fidelity."""
    b = _MAGIC + _graph_page("G1", "Violin")
    figs = [
        {"name": "G1", "curves": [_box("B")]},
        {"name": "G2", "curves": [_box("C", "histogram")]},
        {"name": "G3", "curves": [{"book": "Bk", "x": "A", "y": "D", "style": "line"}]},
    ]
    out = apply_stat_kinds(figs, b)
    assert out[0][BOX_MARKS_NOT_DECODED] == "violin" and HISTOGRAM_BINS_NOT_DECODED not in out[0]
    assert out[1][HISTOGRAM_BINS_NOT_DECODED] == "histogram" and BOX_MARKS_NOT_DECODED not in out[1]
    assert out[2] is figs[2]
    base = {"x_from": 0.0, "x_to": 1.0, "y_from": 0.0, "y_to": 1.0, "x_log": False, "y_log": False}
    assessed, _ = assess_origin_figures([{**f, **base} for f in out], container="opju")
    omissions = [a["fidelity"]["omissions"] for a in assessed]
    assert BOX_MARKS_NOT_DECODED in omissions[0] and HISTOGRAM_BINS_NOT_DECODED not in omissions[0]
    assert HISTOGRAM_BINS_NOT_DECODED in omissions[1]
    assert not {BOX_MARKS_NOT_DECODED, HISTOGRAM_BINS_NOT_DECODED} & set(omissions[2])


def test_omitted_stat_layer_carries_no_drawn_note() -> None:
    (out,) = apply_stat_kinds([{"name": "G", "curves": [_box("B")]}], _MAGIC)  # no template
    assert out["curves"] == []
    assert BOX_MARKS_NOT_DECODED not in out and HISTOGRAM_BINS_NOT_DECODED not in out


def test_rowless_curves_of_several_books_omit() -> None:
    other = {**_box("B", "box"), "book": "Bk2"}
    figs = [{"name": "G", "curves": [_box("B", "box"), other]}]
    (out,) = apply_stat_kinds(figs, _MAGIC)
    assert out["curves"] == []
    assert {n["reason"] for n in out["curve_sheet_omitted"]} == {STAT_LAYER_OF_SEVERAL_BOOKS}


# ── realdata anchors (Origin 2026b COM, 2026-11-15) ───────────────────────────


def _figures(path: Path) -> list[dict[str, Any]]:
    raw = path.read_bytes()
    primary, books = read_origin_project_all(path, raw=raw)
    figs, _ = origin_figures_and_fidelity(
        raw, ".opju", drop_empty_library_books(books), primary=primary
    )
    return figs


def _path(corpus_dir: Path, rel: str) -> Path:
    path = corpus_dir / rel
    if not path.is_file():
        pytest.skip(f"{rel} not present")
    return path


def _fig(figs: list[dict[str, Any]], name: str) -> dict[str, Any]:
    return next(f for f in figs if f.get("name") == name)


@pytest.mark.realdata
def test_realdata_box_layers_decode_to_origin(corpus_dir: Path) -> None:
    """COM ``layer.x/y.from/to`` and per-plot ``GetPlotType()`` 206 / ``xof``
    ``_A``: ``Boxplot_vegC`` Graph1 boxes A..E on 0.5..5.5 x 0..425;
    ``OverallError`` Graph6 boxes A, B on 0.5..3.5 x -0.5..5."""
    rel = (
        "origin/public/joyrajbanshi91_India-Land-Use/figure_code/supplementary/"
        "Supplemetary_Fig_6/Boxplot_vegC.opju"
    )
    g = _fig(_figures(_path(corpus_dir, rel)), "Graph1")
    assert (g["x_from"], g["x_to"], g["y_from"], g["y_to"]) == (0.5, 5.5, 0.0, 425.0)
    assert [(c["x"], c["y"], c["plotType"]) for c in g["curves"]] == [
        ("", y, "box") for y in "ABCDE"
    ]
    rel = "origin/public/he-xiaolin_Online-perceived-risk-study/Fig4_ExtFig9/OverallError.opju"
    g = _fig(_figures(_path(corpus_dir, rel)), "Graph6")
    assert (g["x_from"], g["x_to"], g["y_from"], g["y_to"]) == (0.5, 3.5, -0.5, 5.0)
    assert [(c["y"], c["plotType"]) for c in g["curves"]] == [("A", "box"), ("B", "box")]


@pytest.mark.realdata
def test_realdata_single_histogram_and_unnamed_box_kind(corpus_dir: Path) -> None:
    """``SOP_meas`` Graph37: a histogram (COM 219, ``xof`` ``_A``) of
    ``SOPvsHPPC1`` T plus, since ``opju_layer_record`` decodes it, the page's
    second layer (the cumulative-percent line Origin's saved preview shows),
    so the histogram is omitted as a stat layer of a multi-layer page;
    Graph80's page template names no box kind: omitted."""
    rel = "origin/public/Techboyjohnny-98_SOP_measurement_SHAP/OriginPro file/SOP_meas.opju"
    figs = _figures(_path(corpus_dir, rel))
    layers = {f["layer"]: f for f in figs if f.get("name") == "Graph37"}
    assert sorted(layers) == [1, 2] and len(layers[2]["curves"]) == 1
    assert layers[1]["curves"] == []
    (note,) = layers[1]["curve_sheet_omitted"]
    assert (note["book"], note["x"], note["y"], note["reason"]) == (
        "SOPvsHPPC1", "", "T", STAT_LAYER_IN_PANELS
    )
    g80 = _fig(figs, "Graph80")
    assert g80["curves"] == []
    assert {o["reason"] for o in g80["curve_sheet_omitted"]} == {BOX_KIND_NOT_DECODED}

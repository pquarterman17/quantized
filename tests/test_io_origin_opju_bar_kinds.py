"""``.opju`` column / bar / stacked / pie plot types resolved per layer
(``opju_bar_kinds``) and the histogram + cumulative-percent page drawn from
Origin's own bin table (``opju_hist_cumulative``).

Synthetic figures and books only (invented names). The ``realdata`` tests run
the import on the public corpus and check, at test time, that each kind agrees
with the page's own template name (an independent field of the page header)
and that every re-bound histogram's counts are the raw column's bins; they
auto-skip without the corpus.
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import numpy as np
import pytest

from quantized.io.origin_project import opju_bar_kinds
from quantized.io.origin_project.fidelity import assess_origin_figures
from quantized.io.origin_project.opju_bar_kinds import (
    BAR_LAYOUT,
    PLOT_TYPE_NOT_DRAWN,
    apply_bar_kinds,
    book_column,
)
from quantized.io.origin_project.opju_hist_cumulative import (
    BAR_WIDTH_NOT_DECODED,
    pair_histogram_cumulative,
)
from quantized.io.origin_project.opju_plot_gates import PLOT_TYPE_OFF
from quantized.io.origin_project.opju_plot_kinds import apply_plot_kind
from quantized.io.origin_project.opju_stat_plots import apply_stat_kinds


def _book(name: str, x: list[float], cols: dict[str, list[float]], x_name: str = "A") -> Any:
    meta = {"origin_book": name, "origin_column_names": list(cols), "x_column_name": x_name}
    values = np.array(list(cols.values()), dtype=float).T
    return SimpleNamespace(metadata=meta, time=np.array(x, dtype=float), values=values)


_BOOK = _book("Bk", [1, 2, 3], {"B": [1, 2, 3], "C": [4, 5, 6], "D": [7, 8, 9]})


def _fig(kinds: list[str], name: str = "Graph1", layer: int = 1, x: str = "A") -> dict[str, Any]:
    curves = [{"book": "Bk", "x": x, "y": "BCD"[i], "plotType": k} for i, k in enumerate(kinds)]
    return {"name": name, "layer": layer, "curves": curves, "legend_labels": []}


def _apply(figs: list[dict[str, Any]], books: Any = (_BOOK,)) -> list[dict[str, Any]]:
    return apply_bar_kinds(figs, b"", list(books))


def _reasons(fig: dict[str, Any]) -> list[str]:
    return [o["reason"] for o in fig.get("curve_sheet_omitted") or []]


# ── the record byte -> provisional kind ──────────────────────────────────────


@pytest.mark.parametrize(
    ("code", "kind"),
    [
        (213, "stacked_column"),
        (214, "stacked_area"),
        (215, "bar"),
        (207, "not_drawn"),
        (216, "not_drawn"),
        (225, "not_drawn"),
        (218, "not_drawn"),
        (203, "column"),
    ],
)
def test_plot_type_byte_sets_the_provisional_kind(code: int, kind: str) -> None:
    record = bytearray(PLOT_TYPE_OFF + 300)
    record[PLOT_TYPE_OFF] = code
    curve: dict[str, Any] = {"book": "Bk", "x": "A", "y": "B"}
    apply_plot_kind(curve, bytes(record))
    assert curve["plotType"] == kind


@pytest.mark.parametrize("code", [200, 201, 202, 206, 219, 231])
def test_other_plot_types_get_no_layer_kind(code: int) -> None:
    record = bytearray(PLOT_TYPE_OFF + 300)
    record[PLOT_TYPE_OFF] = code
    curve: dict[str, Any] = {"book": "Bk", "x": "A", "y": "B"}
    apply_plot_kind(curve, bytes(record))
    assert curve.get("plotType") not in {"stacked_column", "stacked_area", "bar", "not_drawn"}


# ── one series: a stack of one is the series ─────────────────────────────────


def test_single_stacked_area_is_an_area_and_single_stack_a_column() -> None:
    (a,) = _apply([_fig(["stacked_area"])])
    assert a["curves"][0]["plotType"] == "area" and not _reasons(a)
    (c,) = _apply([_fig(["stacked_column"])])
    assert c["curves"][0]["plotType"] == "column" and BAR_LAYOUT not in c


def test_single_series_on_a_100_percent_stack_page_is_left_out(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Origin's StackColP draws one series as a flat 100 %, never its raw values
    monkeypatch.setattr(opju_bar_kinds, "opju_pages", lambda b: [])
    monkeypatch.setattr(opju_bar_kinds, "_template_kind", lambda b, p, n: "percent")
    (f,) = _apply([_fig(["stacked_column"])])
    assert f["curves"] == [] and _reasons(f) == [PLOT_TYPE_NOT_DRAWN]


def test_single_horizontal_bar_kept_only_alone_on_a_one_layer_bar_page(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(opju_bar_kinds, "opju_pages", lambda b: [])
    monkeypatch.setattr(opju_bar_kinds, "_template_kind", lambda b, p, n: None)
    (other,) = _apply([_fig(["bar"])])  # not Origin's Bar template: unproven
    assert other["curves"] == [] and _reasons(other) == [PLOT_TYPE_NOT_DRAWN]
    monkeypatch.setattr(opju_bar_kinds, "_template_kind", lambda b, p, n: "bar")
    (one,) = _apply([_fig(["bar"])])
    assert one["curves"][0]["plotType"] == "bar"
    # a column beside it is turned too (grouped horizontal): both left out
    (mixed,) = _apply([_fig(["bar", "column"])])
    assert mixed["curves"] == [] and _reasons(mixed) == [PLOT_TYPE_NOT_DRAWN] * 2
    panels = _apply([_fig(["bar"]), _fig(["bar"], layer=2)])
    assert all(f["curves"] == [] for f in panels)


def test_kinds_without_a_renderer_are_left_out_not_drawn_as_lines() -> None:
    (f,) = _apply([_fig(["not_drawn", "not_drawn"])])
    assert f["curves"] == [] and _reasons(f) == [PLOT_TYPE_NOT_DRAWN] * 2
    (g,) = _apply([_fig(["stacked_area", "stacked_area"])])
    assert g["curves"] == [] and len(_reasons(g)) == 2


def test_a_left_out_curve_takes_its_caption_and_the_rest_renumber() -> None:
    fig = _fig(["not_drawn", "column"])
    fig["legend_labels"] = ["%(1)", "%(2)"]
    (f,) = _apply([fig])
    assert [c["y"] for c in f["curves"]] == ["C"] and f["legend_labels"] == ["%(1)"]


# ── several column series: the Stat Stage bar chart ──────────────────────────


def test_several_columns_on_one_x_are_a_grouped_bar_chart() -> None:
    (f,) = _apply([_fig(["column", "column", "column"])])
    assert f[BAR_LAYOUT] == "grouped" and f["bar_marks_not_decoded"]
    # the single-column rule does not strip a grouped layer's plot types
    (g,) = apply_stat_kinds([f], b"")
    assert [c["plotType"] for c in g["curves"]] == ["column"] * 3


def test_stacked_columns_need_the_stackcolumn_template(monkeypatch: pytest.MonkeyPatch) -> None:
    for template, layout in (("stacked", "stacked"), ("percent", None), (None, None)):
        monkeypatch.setattr(opju_bar_kinds, "_template_kind", lambda b, p, n, t=template: t)
        monkeypatch.setattr(opju_bar_kinds, "opju_pages", lambda b: [])
        (f,) = _apply([_fig(["stacked_column", "stacked_column"])])
        assert f.get(BAR_LAYOUT) == layout
        if layout is None:  # 100 % stack or a user template: unproven
            assert f["curves"] == [] and _reasons(f) == [PLOT_TYPE_NOT_DRAWN] * 2


@pytest.mark.parametrize(
    "x",
    [[1, 1, 2], [1, 2, 4], [1, float("nan"), 2, 3]],
    ids=["duplicate", "uneven", "nan-row-ok"],
)
def test_grouped_needs_unique_evenly_spaced_x(x: list[float]) -> None:
    n = len(x)
    book = _book("Bk", x, {"B": [1.0] * n, "C": [2.0] * n})
    (f,) = _apply([_fig(["column", "column"])], books=[book])
    assert (f.get(BAR_LAYOUT) == "grouped") is bool(np.isnan(x).any())


def test_grouped_fails_closed() -> None:
    two_layers = _apply([_fig(["column", "column"]), _fig(["column"], layer=2)])
    assert all(BAR_LAYOUT not in f for f in two_layers)
    other_x = _fig(["column", "column"])
    other_x["curves"][1]["x"] = "D"
    with_err = _fig(["column", "column"])
    with_err["curves"][0]["yErr"] = "D"
    mixed = _fig(["column", "line"])
    for fig in (other_x, with_err, mixed):
        (f,) = _apply([fig])
        assert BAR_LAYOUT not in f
    (unknown,) = _apply([_fig(["column", "column"])], books=[])
    assert BAR_LAYOUT not in unknown
    # every curve against one X, but not the sheet's own X column: the
    # frontend draws such a layer with its own-X overlay, never the stage
    # (SOP_meas Graph75 drew four overlapping bars on one X)
    (not_book_x,) = _apply([_fig(["column", "column"], x="D")])
    assert BAR_LAYOUT not in not_book_x


def test_text_x_is_the_row_index() -> None:
    book = _book("Bk", [1, 2, 3], {"A": [np.nan] * 3, "B": [1, 2, 3]}, x_name="")
    assert book_column([book], "Bk", "A") is not None  # a named column wins
    assert list(book_column([book], "Bk", "T")) == [1, 2, 3]  # type: ignore[arg-type]
    assert book_column([book], "Other", "A") is None


def test_grouped_and_stacked_figures_carry_their_note() -> None:
    (f,) = _apply([_fig(["column", "column"])])
    figs, _ = assess_origin_figures([f], container="opju", source_names=["Bk"])
    assert "bar_marks_not_decoded" in figs[0]["fidelity"]["omissions"]


# ── histogram + cumulative percent from Origin's bin table ───────────────────

_DATA = [-3.0, 1.0, 2.0, 9.0, 11.0, 12.0, 25.0, 0.0, float("nan")]


def _hist_page(counts: list[float], frame2: Any = None) -> tuple[list[dict[str, Any]], list[Any]]:
    raw = _book("H", list(range(len(_DATA))), {"T": _DATA})
    centres = [0.0, 10.0, 20.0, 30.0]
    cum = list(np.cumsum(counts) / max(sum(counts), 1) * 100)
    table = _book("H@4", centres, {"B": counts, "C": list(np.cumsum(counts)), "D": cum})
    frame = {"left": 1, "top": 2, "right": 3, "bottom": 4}
    hist = {
        "name": "G",
        "layer": 1,
        "frame": frame,
        "x_from": -5.0,
        "x_to": 35.0,
        "curves": [{"book": "H", "x": "", "y": "T", "plotType": "histogram", "color": "#FF0000"}],
    }
    line = {
        "name": "G",
        "layer": 2,
        "frame": frame2 or frame,
        "x_from": -5.0,
        "x_to": 35.0,
        "curves": [{"book": "H@4", "x": "A", "y": "D", "style": "line"}],
    }
    return [hist, line], [raw, table]


def test_right_closed_bins_are_origins_too() -> None:
    """25 sits on an edge: (15, 25] puts it in bin 3, [25, 35) in bin 4."""
    figs, books = _hist_page([4.0, 3.0, 1.0, 0.0])
    assert pair_histogram_cumulative(figs, books)[0]["curves"][0]["y"] == "B"


def test_histogram_layer_rebinds_to_origins_bin_counts() -> None:
    figs, books = _hist_page([4.0, 3.0, 0.0, 1.0])  # [-5,5) [5,15) [15,25) [25,35)
    hist, line = pair_histogram_cumulative(figs, books)
    assert hist["curves"] == [
        {
            "book": "H@4",
            "x": "A",
            "y": "B",
            "xRecorded": True,
            "plotType": "column",
            "color": "#FF0000",
        }
    ]
    assert hist[BAR_WIDTH_NOT_DECODED] and line is figs[1]
    assert hist["histogram_source"] == {"book": "H", "y": "T"}


@pytest.mark.parametrize(
    "counts", [[4.0, 3.0, 1.0, 1.0], [8.0, 0.0, 0.0, 0.0], [4.0, 2.0, 0.0, 2.0]]
)
def test_counts_that_are_not_the_columns_bins_leave_the_page_alone(counts: list[float]) -> None:
    figs, books = _hist_page(counts)
    assert pair_histogram_cumulative(figs, books) == figs


def test_pairing_needs_the_same_frame_and_the_histograms_own_book() -> None:
    figs, books = _hist_page(
        [4.0, 3.0, 0.0, 1.0], frame2={"left": 9, "top": 2, "right": 3, "bottom": 4}
    )
    assert pair_histogram_cumulative(figs, books) == figs
    figs, books = _hist_page([4.0, 3.0, 0.0, 1.0])
    figs[1]["curves"][0]["book"] = "Other@4"
    assert pair_histogram_cumulative(figs, books) == figs
    figs, books = _hist_page([4.0, 3.0, 0.0, 1.0])
    assert pair_histogram_cumulative(figs + [{**figs[1], "layer": 3}], books)[0] == figs[0]


# ── realdata: the kinds against the page template, the bins against the column ─


def _public(corpus_dir: Path) -> Path:
    root = corpus_dir / "origin" / "public"
    if not root.is_dir():
        pytest.skip("public Origin corpus not present")
    return root


def _figures(path: Path) -> list[dict[str, Any]]:
    from quantized.io.origin_project import drop_empty_library_books, read_origin_project_all
    from quantized.io.origin_project.import_manifest import origin_figures_and_fidelity

    raw = path.read_bytes()
    primary, books = read_origin_project_all(path, raw=raw)
    figs, _ = origin_figures_and_fidelity(
        raw, ".opju", drop_empty_library_books(books), primary=primary
    )
    return figs


def _one(root: Path, pattern: str) -> Path:
    hits = sorted(root.rglob(pattern))
    if len(hits) != 1:
        pytest.skip(f"{pattern}: {len(hits)} matches")
    return hits[0]


@pytest.mark.realdata
def test_realdata_stacked_area_and_horizontal_bar_pages(corpus_dir: Path) -> None:
    """``Figure_14`` (Origin template ``StackArea``, one plot per layer): every
    page draws one area; ``LSA_fig6`` (template ``Bar``): the one-plot pages
    keep one horizontal bar, the two-plot pages (Origin's preview: two sideways
    series) draw nothing rather than vertical bars."""
    root = _public(corpus_dir)
    areas = [f for f in _figures(_one(root, "Figure_14.opju")) if f["curves"]]
    assert areas and all([c["plotType"] for c in f["curves"]] == ["area"] for f in areas)
    lsa = {f["name"]: f for f in _figures(_one(root, "LSA_fig6.opju"))}
    for name in ("Graph1", "Graph2", "Graph9"):
        assert [c["plotType"] for c in lsa[name]["curves"]] == ["bar"]
    for name in ("Graph6", "Graph8"):
        assert lsa[name]["curves"] == []
        assert PLOT_TYPE_NOT_DRAWN in _reasons(lsa[name])


@pytest.mark.realdata
def test_realdata_grouped_stacked_and_pie(corpus_dir: Path) -> None:
    """``fig_6_a`` Graph1 (template ``Column``): three column series per X ->
    grouped; Graph2 / Graph3 (``StackColP``, Origin's 100 % stack, preview
    0..100 % from raw counts) -> left out; the Etna ``origin.opju`` Graph17
    (``StackColumn``) -> stacked; ``soil deep`` Graph3 (``Pie2D``) -> left out."""
    root = _public(corpus_dir)
    fig6 = {f["name"]: f for f in _figures(_one(root, "fig_6_a.opju"))}
    assert fig6["Graph1"][BAR_LAYOUT] == "grouped" and len(fig6["Graph1"]["curves"]) == 3
    for name in ("Graph2", "Graph3"):
        assert fig6[name]["curves"] == [] and set(_reasons(fig6[name])) == {PLOT_TYPE_NOT_DRAWN}
    etna = [p for p in root.rglob("origin.opju") if "Etna" in str(p)]
    if etna:
        g17 = next(f for f in _figures(etna[0]) if f["name"] == "Graph17")
        assert g17[BAR_LAYOUT] == "stacked" and len(g17["curves"]) == 11
    soil = {f["name"]: f for f in _figures(_one(root, "soil deep.opju"))}
    assert soil["Graph3"]["curves"] == [] and _reasons(soil["Graph3"]) == [PLOT_TYPE_NOT_DRAWN]


@pytest.mark.realdata
def test_realdata_histogram_cumulative_pages_draw_origins_bins(corpus_dir: Path) -> None:
    """``SOP_meas`` Graph37 / 38 / 42 / 45 (template ``HISTPROB``): layer 1's
    bars are the bin sheet's counts, recomputed here from the raw column over
    the sheet's own bin centres; layer 2 keeps its cumulative-percent line."""
    path = _one(_public(corpus_dir), "SOP_meas.opju")
    from quantized.io.origin_project import drop_empty_library_books, read_origin_project_all

    _, books = read_origin_project_all(path)
    books = drop_empty_library_books(books)
    figs = _figures(path)
    for name in ("Graph37", "Graph38", "Graph42", "Graph45"):
        layers = {f["layer"]: f for f in figs if f["name"] == name}
        (bars,) = layers[1]["curves"]
        (line,) = layers[2]["curves"]
        assert bars["plotType"] == "column" and bars["book"] == line["book"]
        x = book_column(books, bars["book"], bars["x"])
        counts = book_column(books, bars["book"], bars["y"])
        src = layers[1]["histogram_source"]
        data = book_column(books, src["book"], src["y"])
        assert x is not None and counts is not None and data is not None
        assert line["book"].rpartition("@")[0] == src["book"]
        w = float(np.diff(x)[0])
        edges = np.append(x - w / 2, x[-1] + w / 2)
        v = data[np.isfinite(data)]
        mine = [np.histogram(v, edges)[0], np.histogram(-v, -edges[::-1])[0][::-1]]
        assert any(np.array_equal(counts, m) for m in mine) and counts.sum() == v.size

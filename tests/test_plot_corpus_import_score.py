"""The import scorer's comparison logic (tools/plot_corpus, plan item 2).

Tiny synthetic fixtures only: no corpus, no Origin. Each test pins one
verdict rule -- above all that a value quantized HAS but gets wrong is
``wrong`` (never folded into ``omitted``), and that a curve or sheet Origin
does not have is ``phantom``. The frontend mirror is pinned by the shared
``tests/fixtures/plot_corpus/frontend_view_cases.json``, which vitest asserts
against the real frontend functions too.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path
from typing import Any

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools" / "plot_corpus"))

import frontend_view  # noqa: E402
import import_compare as ic  # noqa: E402
import import_values as iv  # noqa: E402
import score_report  # noqa: E402

from quantized.io.origin_project.curve_style_color import ORIGIN_PALETTE  # noqa: E402

CASES = json.loads(
    (ROOT / "tests" / "fixtures" / "plot_corpus" / "frontend_view_cases.json").read_text("utf-8")
)


def _plot(ref: str, x: str, ptype: int = 200, **style: Any) -> dict[str, Any]:
    return {"index": 0, "plot_type": ptype, "ref": ref, "x_dataset": x, **style}


def _graph(*plots: dict[str, Any], axes: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"page": "Graph1", "layers": [{"index": 0, "axes": axes or {}, "plots": list(plots)}]}


# -- oracle parsing --------------------------------------------------------


def test_parse_ref_and_x_dataset() -> None:
    assert ic.parse_ref('[Clean]Sheet1!B"y1"') == {
        "book": "Clean", "sheet": "Sheet1", "col": "B", "long": "y1"
    }
    assert ic.parse_ref("[Mat]MSheet1!1")["col"] == "1"
    assert ic.parse_ref("junk") is None
    assert ic.parse_x_dataset("Clean_A") == "A"
    assert ic.parse_x_dataset("My_Book_C") == "C"
    assert ic.parse_x_dataset("_A") is None  # Origin's row-index X
    assert ic.parse_x_dataset(None) is None


def test_oracle_curves_flags_error_bars() -> None:
    g = _graph(_plot('[E]S!B"y"', "E_A", 201), _plot('[E]S!C"dy"', "E_B", 231))
    cs = ic.oracle_curves(g)
    got = [(c["y"], c["x"], c["error_bar"]) for c in cs]
    assert got == [("B", "A", None), ("C", "B", "Y-error")]


# -- curve classification --------------------------------------------------


def _oracle(*pairs: tuple[str, str | None]) -> list[dict[str, Any]]:
    return [
        {"layer": 0, "index": i, "book": "Bk", "sheet": "S1", "y": y, "x": x, "plot_type": 200,
         "error_bar": None, "plot": {}}
        for i, (y, x) in enumerate(pairs)
    ]


def _dec(*pairs: tuple[str, str], book: str = "Bk") -> list[dict[str, Any]]:
    return [{"book": book, "y": y, "x": x} for y, x in pairs]


def test_curves_match() -> None:
    res, ph = ic.classify_curves(
        _oracle(("B", "A"), ("C", "A")), _dec(("B", "A"), ("C", "A")), {}, "r"
    )
    assert [r["status"] for r in res] == ["match", "match"] and ph == []


def test_wrong_x_is_wrong_not_omitted() -> None:
    res, _ = ic.classify_curves(_oracle(("D", "C")), _dec(("D", "A")), {}, "r")
    assert res[0]["status"] == "wrong" and res[0]["field"] == "x"


def test_wrong_y_at_same_position_is_wrong() -> None:
    res, ph = ic.classify_curves(_oracle(("B", "A")), _dec(("E", "A")), {}, "r")
    assert res[0]["status"] == "wrong" and res[0]["field"] == "y" and ph == []


def test_missing_curve_is_omitted_with_reason_and_extra_is_phantom() -> None:
    res, ph = ic.classify_curves(_oracle(("B", "A")), [], {}, "no_bindings")
    assert res == [{"status": "omitted", "origin": {"book": "Bk", "x": "A", "y": "B"},
                    "reason": "no_bindings"}]
    res, ph = ic.classify_curves(_oracle(("B", "A")), _dec(("B", "A"), ("C", "A")), {}, "r")
    assert res[0]["status"] == "match" and [p["status"] for p in ph] == ["phantom"]


def test_no_origin_x_accepts_any_decoded_x() -> None:
    res, _ = ic.classify_curves(_oracle(("B", None)), _dec(("B", "A")), {}, "r")
    assert res[0]["status"] == "match"


def test_sheet_ids_route_the_book() -> None:
    res, _ = ic.classify_curves(
        _oracle(("B", "A")), _dec(("B", "A"), book="Bk@2"), {("Bk", "S1"): "Bk@2"}, "r"
    )
    assert res[0]["status"] == "match"
    res, _ = ic.classify_curves(_oracle(("B", "A")), _dec(("B", "A")), {("Bk", "S1"): "Bk@2"}, "r")
    assert res[0]["status"] == "wrong"  # bound to sheet 1 when Origin plots sheet 2


def test_error_bar_plots_are_not_curves() -> None:
    o = _oracle(("B", "A"), ("C", "B"))
    o[1]["error_bar"] = "Y-error"
    res, _ = ic.classify_curves(o, _dec(("B", "A")), {}, "r")
    assert len(res) == 1 and res[0]["status"] == "match"


# -- figure pairing, axes --------------------------------------------------


def test_pair_figures_by_name_then_order() -> None:
    g = {"page": "Graph1", "layers": [{"index": 0}, {"index": 1}]}
    pairs, extra = ic.pair_figures([{"name": "Graph1", "layer": 2}, {"name": ""}], g)
    assert pairs == [(0, 1, "order"), (1, 0, "name")] and extra == []
    pairs, extra = ic.pair_figures([], g)
    assert pairs == [(0, None, "missing"), (1, None, "missing")]
    _, extra = ic.pair_figures([{"name": "Graph9", "layer": 1}], {"page": "Graph1", "layers": []})
    assert extra == [0]


def test_axes() -> None:
    axes = {
        "x": {"from": 0.0, "to": 10.0, "type": 1.0},
        "y": {"from": 1.0, "to": 100.0, "type": 2.0},
    }
    fig = {"x_from": 0.0, "x_to": 10.0 + 1e-12, "x_log": False, "y_from": 1.0, "y_to": 90.0,
           "y_log": False}
    v = ic.compare_axes(axes, fig, "r")
    assert v["x_from"]["status"] == v["x_to"]["status"] == v["x_log"]["status"] == "match"
    assert v["y_to"]["status"] == "wrong" and v["y_log"]["status"] == "wrong"
    assert {x["status"] for x in ic.compare_axes(axes, None, "gone").values()} == {"omitted"}


# -- styles, plot type -----------------------------------------------------


def test_styles_score_only_planted_fields() -> None:
    plot = {"get_color": 2.0, "line_width": 2.0, "get_dash": 1.0, "symbol_kind": 2.0,
            "symbol_size": 8.0}
    req = {"c": 2, "w": 1000, "d": 1, "k": 2, "z": 8}
    dec = {
        "color": ORIGIN_PALETTE[1].lower(), "lineWidth": 2.0, "symbol": "square", "symbolSize": 8
    }
    v = ic.compare_styles(plot, req, dec, "")
    assert v["color"]["status"] == "match"  # palette index 2 = red, case-insensitive
    assert v["line_width"]["status"] == "match"
    assert v["dash"] == {"status": "omitted", "origin": 1.0, "reason": "no_field_in_OriginCurve"}
    assert v["symbol"]["status"] == "wrong"  # kind 2 is a circle
    assert v["symbol_size"]["status"] == "match"
    assert ic.compare_styles(plot, {"c": 2}, None, "gone")["color"]["reason"] == "gone"
    assert ic.compare_styles(plot, None, dec, "") == {}


def test_drawn_kind_and_plot_type() -> None:
    assert ic.drawn_kind([]) == "default"
    assert ic.drawn_kind([{"plotType": "histogram"}, {"plotType": "histogram"}]) == "histogram"
    assert ic.drawn_kind([{"plotType": "bar", "style": "line"}]) == "bar"
    assert ic.drawn_kind([{"style": "line"}, {"style": "scatter"}]) == "mixed"
    assert ic.score_plot_type("line", [200], "default")["by_default"] is True
    assert ic.score_plot_type("box", [206], "default")["status"] == "omitted"
    assert ic.score_plot_type("bar", [215], "column")["status"] == "wrong"
    assert ic.score_plot_type("histogram", [219], "histogram")["status"] == "match"
    assert ic.score_plot_type("line", [200], "none")["status"] == "omitted"
    assert set(ic.EXPECTED_KIND) >= {"line", "box", "ternary", "heatmap_matrix"}


# -- values ----------------------------------------------------------------


def _family(deleted: bool = False) -> dict[str, Any]:
    def sheet(name: str, ys: list[float | None], dead: bool = False) -> dict[str, Any]:
        return {"name": name, "deleted": dead, "columns": [
            {"short": "A", "long": "x", "units": "", "designation": "X", "values": [0.0, 1.0, 2.0]},
            {"short": "B", "long": "y", "units": "K", "designation": "Y", "values": ys},
        ]}
    sheets = [sheet("S1", [1.0, None, 3.0])]
    if deleted:
        sheets += [sheet("Gone", [7.0, 8.0, 9.0], dead=True), sheet("S3", [4.0, 5.0, 6.0])]
    return {"books": [{"name": "Bk", "sheets": sheets}], "matrices": []}


def _table(book: str, ys: list[float], **meta: Any) -> dict[str, Any]:
    m = {"origin_book": book, "origin_column_names": ["B"], "x_column_name": "A", **meta}
    return iv.table_of(m, [0.0, 1.0, 2.0], np.array(ys).reshape(-1, 1), ["B"], [""])


def test_values_match_nan_aware_and_wrong_counts_cells() -> None:
    sheets = iv.truth_sheets(_family())
    good = iv.compare_sheet(sheets[0], _table("Bk", [1.0, math.nan, 3.0]))
    assert good["A"]["values"]["status"] == good["B"]["values"]["status"] == "match"
    bad = iv.compare_sheet(sheets[0], _table("Bk", [1.0, math.nan, 3.5]))["B"]["values"]
    assert bad["status"] == "wrong" and bad["n_diff"] == 1 and bad["max_abs"] == 0.5
    gone = iv.compare_sheet(sheets[0], None)["B"]["values"]
    assert gone == {"status": "omitted", "reason": "sheet_not_imported"}


def test_column_meta_omitted_vs_wrong() -> None:
    s = iv.truth_sheets(_family())[0]
    plain = iv.compare_sheet(s, _table("Bk", [1.0, math.nan, 3.0]))["B"]
    assert plain["designation"]["status"] == "omitted"
    assert plain["long_name"]["reason"] == "label_is_short_name"
    assert plain["units"]["reason"] == "no_units_decoded"
    t = _table("Bk", [1.0, math.nan, 3.0], column_designations={"B": "Y-error"})
    t["columns"]["B"].update(label="z", units="K")
    meta = iv.compare_sheet(s, t)["B"]
    assert meta["designation"]["status"] == "wrong" and meta["long_name"]["status"] == "wrong"
    assert meta["units"]["status"] == "match"


def test_sheets_pair_by_content_and_deleted_sheet_is_phantom() -> None:
    sheets = iv.truth_sheets(_family(deleted=True))
    tables = [_table("Bk", [1.0, math.nan, 3.0]), _table("BkA@2", [7.0, 8.0, 9.0]),
              _table("Bk@3", [4.0, 5.0, 6.0])]
    ids, phantoms = iv.match_sheets(sheets, tables)
    assert ids == {("Bk", "S1"): "Bk", ("Bk", "S3"): "Bk@3"}
    assert phantoms == [{"status": "phantom", "quantized": "BkA@2",
                         "reason": "holds deleted sheet Bk!Gone"}]


def test_sheet_pairing_falls_back_to_naming_convention() -> None:
    sheets = iv.truth_sheets(_family(deleted=True))
    tables = [_table("Bk", [0.0, 0.0, 0.0]), _table("Bk@2", [0.0, 0.0, 0.0])]
    ids, phantoms = iv.match_sheets(sheets, tables)
    assert ids == {("Bk", "S1"): "Bk", ("Bk", "S3"): "Bk@2"} and phantoms == []


def test_matrix_layouts() -> None:
    m = {"values": [[1.0, 2.0], [3.0, 4.0]]}
    xyz = np.array([[0, 0, 1.0], [1, 0, 2.0], [0, 1, 3.0], [1, 1, 4.0]])
    t = {"values": xyz, "labels": ["X", "Y", "Z"]}
    assert iv.compare_matrix(m, t)["layout"] == "row_major"
    t["values"] = xyz[[0, 2, 1, 3]]
    assert iv.compare_matrix(m, t)["layout"] == "column_major"
    t["values"] = xyz * 2
    assert iv.compare_matrix(m, t)["status"] == "wrong"
    assert iv.compare_matrix(m, None)["status"] == "omitted"


# -- frontend mirror (shared cases) ---------------------------------------


def _ds(name: str) -> dict[str, Any]:
    raw = CASES["datasets"][name]
    return {
        "name": raw["metadata"]["origin_book"],
        "metadata": raw["metadata"],
        "time": [float(t) for t in raw["time"]],
        "values": [[math.nan if v is None else float(v) for v in row] for row in raw["values"]],
    }


@pytest.mark.parametrize("case", CASES["cases"], ids=lambda c: c["name"])
def test_frontend_view_mirror(case: dict[str, Any]) -> None:
    ds = _ds(case["dataset"])
    assert frontend_view.channel_selection(case["figure"], ds) == case["selection"]
    assert (frontend_view.stat_histogram_value(case["figure"], ds) is not None) is case["stat"]
    if "hidden" in case:
        view = frontend_view.default_view(ds)
        assert view["hidden"] == case["hidden"]
        assert view["ownX"] == {int(k): v for k, v in case["ownX"].items()}
    drawn = frontend_view.drawn_curves(case["figure"], [ds])
    assert drawn["via"] == case["via"] and drawn["kind"] == case["kind"]
    assert [{"x": c["x"], "y": c["y"]} for c in drawn["curves"]] == case["drawn"]


def test_resolve_dataset_by_curve_book_then_hint() -> None:
    a, b = _ds("clean"), _ds("errors")
    assert frontend_view.resolve_dataset({"curves": [{"book": "Err"}]}, [a, b]) == 1
    assert frontend_view.resolve_dataset({"source_hint": "clean"}, [a, b]) == 0
    assert frontend_view.resolve_dataset({"source_hint": ""}, [a, b]) is None
    assert frontend_view.resolve_dataset({}, []) is None


# -- report ----------------------------------------------------------------


def test_report_lists_wrong_before_omitted() -> None:
    spec = {
        "type": "line", "family": "f", "status": "scored", "n_figures": 1,
        "values": {"Bk!S1": {"B": {"values": {"status": "wrong", "n": 3, "n_diff": 1}}}},
        "phantom_sheets": [], "phantom_figures": [],
        "layers": [{"layer": 0, "curves": [{"status": "omitted", "reason": "r"}],
                    "drawn": [{"status": "phantom", "quantized": {"y": "C"}}], "styles": [],
                    "plot_type": {"status": "match"}, "axes": {}, "error_bars": []}],
    }
    assert score_report.tally(spec)["curves"] == {"omitted": 1}
    fs = score_report.findings([spec])
    assert [(f["check"], f["status"]) for f in fs] == [("drawn", "phantom"), ("values", "wrong")]
    md = score_report.to_markdown([spec, {"type": "box", "family": "g", "status": "not_built"}])
    assert md.index("Wrong and phantom") < md.index("Omission reasons")
    assert "| line | f | 1 |" in md and "not_built" in md

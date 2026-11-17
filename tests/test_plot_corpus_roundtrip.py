"""Round-trip scorer (plan item 9) on tiny fixtures; no Origin, no corpus."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools" / "plot_corpus"))

from roundtrip_compare import Tally, score_book, score_graph, score_shipped, unescape  # noqa: E402
from roundtrip_run import bodies  # noqa: E402
from score_roundtrip import score_export, summarise  # noqa: E402


def _col(
    short: str, long: str, desig: str, values: list[Any], units: str = "", **kw: Any
) -> dict[str, Any]:
    return {
        "short": short,
        "long": long,
        "designation": desig,
        "units": units,
        "fmt": kw.get("fmt", "numeric"),
        "text": kw.get("text"),
        "values": values,
    }


TRUTH = [
    _col("A", "x", "X", [0.0, 1.0, 2.0]),
    _col("B", "y", "Y", [1.0, None, 3.0], units="emu"),
    _col("C", "dy", "Y-error", [0.1, 0.1, 0.1]),
]


def _rb_col(short: str, typ: float, long: str, values: list[Any], unit: str = "") -> dict[str, Any]:
    return {
        "short": short,
        "type": typ,
        "long": long,
        "unit": unit,
        "comment": "",
        "values": values,
    }


def _book(cols: list[dict[str, Any]], title: str = "line_t") -> list[dict[str, Any]]:
    return [
        {"book": "Bk", "long_name": title, "sheets": [{"name": "S", "nrows": 3, "columns": cols}]}
    ]


def _cell(t: Tally, dim: str) -> dict[str, Any]:
    return t.to_json()[dim]


def test_exact_book_matches_every_dimension() -> None:
    t = Tally()
    score_book(
        t,
        TRUTH,
        _book(
            [
                _rb_col("A", 4, "x", [0.0, 1.0, 2.0]),
                _rb_col("B", 1, "y", [1.0, None, 3.0], "emu"),
                _rb_col("C", 3, "dy", [0.1, 0.1, 0.1]),
            ]
        ),
        "line_t",
    )
    for dim in ("values", "designation", "long_name", "unit", "book_title"):
        cell = _cell(t, dim)
        assert cell["wrong"] == cell["missing"] == cell["phantom"] == 0, dim


def test_wrong_designation_value_and_title_are_wrong_not_missing() -> None:
    t = Tally()
    score_book(
        t,
        TRUTH,
        _book(
            [
                _rb_col("A", 4, "x", [0.0, 1.0, 2.0]),
                _rb_col("B", 1, "y", [1.0, None, 3.5], "emu"),  # shifted cell
                _rb_col("C", 1, "dy", [0.1, 0.1, 0.1]),  # yErr arrived as Y
                _rb_col("D", 1, "Sample Index", [0, 1, 2]),  # not in the truth
            ],
            title="line_t@${[0|]}",
        ),
        "line_t",
    )
    assert _cell(t, "values")["wrong"] == 1
    assert _cell(t, "values")["phantom"] == 1
    assert _cell(t, "designation")["wrong"] == 1
    assert "type 1 for 3" in _cell(t, "designation")["why"]["wrong"][0]
    assert _cell(t, "book_title")["wrong"] == 1


def test_empty_long_name_is_missing_and_escape_is_the_character() -> None:
    t = Tally()
    truth = [_col("A", "2θ", "X", [0.0]), _col("B", "y", "Y", [1.0])]
    score_book(
        t,
        truth,
        _book([_rb_col("A", 4, "2\\(x03B8)", [0.0]), _rb_col("B", 1, "", [1.0])]),
        "line_t",
    )
    assert _cell(t, "long_name")["match"] == 1
    assert _cell(t, "long_name")["missing"] == 1
    assert unescape("\\(x03B8)H") == "θH"
    assert unescape("µ") == unescape("μ")  # the writer's micro sign for mu


def test_date_written_as_seconds_is_a_wrong_value() -> None:
    t = Tally()
    truth = [_col("A", "date", "X", [2461041.0], fmt="date"), _col("B", "T", "Y", [1.0])]
    score_book(
        t,
        truth,
        _book([_rb_col("A", 4, "date", [1767225600.0]), _rb_col("B", 1, "T", [1.0])]),
        "line_t",
    )
    assert _cell(t, "values")["wrong"] == 1


def test_no_workbook_is_missing() -> None:
    t = Tally()
    score_book(t, TRUTH, [], "line_t")
    assert _cell(t, "values")["missing"] == 3


def test_shipped_script_that_imports_nothing_is_wrong() -> None:
    t = Tally()
    score_shipped(t, {"run_ok": True, "rows": [0]}, 3)
    assert _cell(t, "shipped_import")["wrong"] == 1
    t = Tally()
    score_shipped(t, {"run_ok": True, "rows": [3]}, 3)
    assert _cell(t, "shipped_import")["match"] == 1


def _plot(ds: str, x: str, typ: int) -> dict[str, Any]:
    return {"dataset": ds, "x_dataset": x, "plot_type": typ}


def _graph(
    plots: list[dict[str, Any]], xtype: float = 1.0, lim: tuple[float, float] = (0.0, 2.0)
) -> dict[str, Any]:
    axes = {ax: {"from": lim[0], "to": lim[1], "type": xtype} for ax in ("x", "y")}
    return {"layers": [{"index": 0, "axes": axes, "plots": plots}]}


ORACLE_COLS = {"O": {"A": "x", "B": "y", "C": "dy"}}
GOT_COLS = {"Bk": {"A": "x", "B": "y", "C": "dy"}}


def test_graph_type_axis_and_x_binding() -> None:
    oracle = _graph([_plot("O_B", "O_A", 200), _plot("O_C", "O_A", 231)], xtype=2.0)
    got = _graph([_plot("Bk_B", "Bk_C", 201), _plot("Bk_C", "Bk_A", 231)], xtype=1.0)
    t = Tally()
    score_graph(
        t, oracle, ORACLE_COLS, [got], GOT_COLS, graph_path=True, script="layer.x.type = 1;"
    )
    assert _cell(t, "curves")["wrong"] == 1  # y against dy, Origin against x
    assert _cell(t, "plot_type")["wrong"] == 1
    assert _cell(t, "error_bars")["match"] == 1
    assert _cell(t, "axis_type")["wrong"] == 1  # x: the script set it
    assert _cell(t, "axis_type")["missing"] == 1  # y: not exported
    assert _cell(t, "styles")["missing"] == 1


def test_data_only_path_misses_the_graph() -> None:
    t = Tally()
    score_graph(t, _graph([_plot("O_B", "O_A", 200)]), ORACLE_COLS, [], GOT_COLS, graph_path=False)
    assert _cell(t, "curves") == {
        "match": 0,
        "wrong": 0,
        "missing": 1,
        "phantom": 0,
        "why": {"missing": ["path writes data only"]},
    }


def test_box_plot_without_x_column_scores_on_y() -> None:
    t = Tally()
    oracle = _graph([_plot("O_B", "_A", 206)])
    score_graph(
        t, oracle, ORACLE_COLS, [_graph([_plot("Bk_B", "Bk_A", 201)])], GOT_COLS, graph_path=True
    )
    assert _cell(t, "curves")["match"] == 1
    assert _cell(t, "plot_type")["wrong"] == 1


def test_bodies_maps_the_opj_body_onto_the_project_route() -> None:
    out = bodies({"ogs": {"a": 1}, "opj": {"b": 2}, "com": None})
    assert out == {"ogs": {"a": 1}, "opj": {"b": 2}, "project": {"b": 2}}


def test_score_export_and_summary_list_wrong_first() -> None:
    fam = {"books": [{"name": "O", "sheets": [{"columns": TRUTH, "masked_rows": {"B": [1]}}]}]}
    oracle = {"books": ["O"], "graph": _graph([_plot("O_B", "O_A", 201)])}
    rb = {
        "opened": True,
        "books": _book(
            [
                _rb_col("A", 4, "x", [0.0, 1.0, 2.0]),
                _rb_col("B", 1, "y", [1.0, None, 3.0], "emu"),
                _rb_col("C", 1, "dy", [0.1, 0.1, 0.1]),
            ],
            title="line_t",
        ),
        "graphs": [],
    }
    row = score_export("line/t", "com", rb, fam, oracle)
    assert row["dims"]["designation"]["wrong"] == 1
    assert row["dims"]["row_mask"]["missing"] == 1
    summary = summarise([row])
    assert summary["wrong"][0]["dim"] == "designation"
    assert summary["by_type"]["com|line"]["designation"] == "wrong"

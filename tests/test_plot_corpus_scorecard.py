"""Merge logic of ``tools/plot_corpus/scorecard.py`` on tiny fixtures."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools" / "plot_corpus"))

from scorecard import merge, owners_for, summarize, to_markdown, worst  # noqa: E402


def _v(status: str, **kw: object) -> dict[str, object]:
    return {"status": status, **kw}


def _spec(ptype: str, family: str, **layer: object) -> dict[str, object]:
    base: dict[str, object] = {
        "layer": 1, "curves": [_v("match")], "drawn": [], "styles": [],
        "plot_type": _v("match"), "axes": {}, "error_bars": [],
    }
    base.update(layer)
    return {"type": ptype, "family": family, "status": "scored", "layers": [base],
            "values": {"S": {"A": {"values": _v("match"), "long_name": _v("omitted")}}}}


def test_worst_orders_wrong_over_phantom_over_omitted_over_match() -> None:
    assert worst(["match", "omitted", "phantom", "wrong"]) == "wrong"
    assert worst(["match", "omitted"]) == "omitted"
    assert worst([]) == "n/a"


def test_merge_pairs_both_checks_and_assigns_owners() -> None:
    c1 = [
        _spec("bubble", "clean", plot_type=_v("wrong", origin="bubble", quantized="scatter")),
        _spec("line", "clean", axes={"x_from": _v("omitted", reason="graph_layer_not_recovered")}),
        {"type": "line", "family": "dup", "status": "not_built", "reason": "refused"},
    ]
    c2 = [
        {"key": "bubble/clean", "built": "built", "verdict": "mismatch", "why": "axes",
         "checks": {"axes": {"state": "wrong", "why": "pad"}}, "png": "a.png"},
        {"key": "line/clean", "built": "built", "verdict": "match", "checks": {}},
        {"key": "bar/clean", "built": "unbuildable", "verdict": "unbuildable", "checks": {}},
    ]
    rows = {r["key"]: r for r in merge(c1, c2)}
    assert set(rows) == {"bubble/clean", "line/clean", "line/dup", "bar/clean"}
    b = rows["bubble/clean"]
    assert b["import"]["dims"]["plot_type"]["verdict"] == "wrong"
    assert b["owners"]["import.plot_type"] == ["#7"]
    assert b["owners"]["scratch"] == ["#18"]
    assert b["scratch"]["wrong"] == {"axes": "pad"}
    ln = rows["line/clean"]
    assert ln["import"]["dims"]["axes"]["verdict"] == "omitted"
    assert ln["import"]["dims"]["labels"]["verdict"] == "omitted"
    assert ln["owners"]["import.axes"] == ["#5"] and "scratch" not in ln["owners"]
    assert rows["line/dup"]["import"]["status"] == "not_built"
    assert rows["line/dup"]["scratch"]["verdict"] == "missing"
    assert rows["bar/clean"]["owners"]["scratch"] == ["#10"]
    assert rows["bar/clean"]["import"]["status"] == "missing"


def test_drawn_wrong_is_a_curves_defect_but_drawn_omission_is_not() -> None:
    c1 = [_spec("area", "multi_x", drawn=[_v("wrong")]),
          _spec("area", "clean", drawn=[_v("omitted", reason="figure_not_drawn")])]
    rows = {r["family"]: r for r in merge(c1, [])}
    assert rows["multi_x"]["import"]["dims"]["curves"]["verdict"] == "wrong"
    assert rows["clean"]["import"]["dims"]["curves"]["verdict"] == "match"


def test_owners_and_summary_and_markdown() -> None:
    assert owners_for("box", "axes", "match", []) == []
    assert owners_for("box", "axes", "omitted", ["graph_layer_not_recovered"]) == ["#6"]
    assert owners_for("histogram", "plot_type", "omitted", []) == ["#6"]
    assert owners_for("polar", "styles", "omitted", []) == ["#7"]
    rows = merge([_spec("line", "clean")], [
        {"key": "line/clean", "built": "built", "verdict": "match", "checks": {}}])
    s = summarize(rows)["line"]
    assert s["built"] == 1 and s["match"] == 1 and s["import"]["curves"] == {"match": 1}
    md = to_markdown(rows)
    assert "| line/clean |" in md and "| **total** | 1 |" in md

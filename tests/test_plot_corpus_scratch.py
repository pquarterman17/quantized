"""Plan item 3's from-scratch scorer (tools/plot_corpus/scratch_*), without Origin.

The recipe table covers every corpus type and names only gallery tiles the
app has; each generated family's CSV imports through the app's own upload
route and every graphed column maps back to a channel; the scorer reads
Origin curves and quantized requests the way the corpus run needs.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / "tools" / "plot_corpus"
sys.path.insert(0, str(TOOLS))

import generate  # noqa: E402
import plot_types  # noqa: E402
import scratch_data  # noqa: E402
import scratch_recipes  # noqa: E402
import scratch_review  # noqa: E402
import scratch_score  # noqa: E402


def test_every_corpus_type_has_exactly_one_recipe_or_gap() -> None:
    names = {p.name for p in plot_types.PLOT_TYPES}
    assert set(scratch_recipes.RECIPES) == names
    for name, r in scratch_recipes.RECIPES.items():
        assert ("steps" in r) != ("missing" in r), name
        if "steps" in r:
            assert r["steps"], name


def test_recipes_name_only_real_gallery_tiles() -> None:
    src = (ROOT / "frontend" / "src" / "lib" / "plotTypes.ts").read_text(encoding="utf-8")
    tiles = set(re.findall(r'\{ id: "(\w+)", label:', src))
    assert "line" in tiles and "contour" in tiles
    used = {
        s["gallery"]
        for r in scratch_recipes.RECIPES.values()
        for s in r.get("steps", [])
        if "gallery" in s
    }
    assert used <= tiles, used - tiles


@pytest.fixture(scope="module")
def generated(tmp_path_factory: pytest.TempPathFactory) -> Path:
    out = tmp_path_factory.mktemp("gen")
    generate.main(["--out", str(out)])
    return out


def _upload(client: TestClient, columns: list[dict[str, Any]], name: str) -> dict[str, Any]:
    csv = scratch_data.sheet_csv(columns)
    r = client.post(
        "/api/parsers/upload", files={"file": (f"{name}.csv", csv.encode(), "text/csv")}
    )
    assert r.status_code == 200, r.text
    return dict(r.json())


def test_every_family_imports_and_every_column_maps(generated: Path, client: TestClient) -> None:
    for d in sorted(p for p in generated.iterdir() if (p / "family.json").exists()):
        fam = json.loads((d / "family.json").read_text(encoding="utf-8"))
        columns = scratch_data.graph_columns(fam)
        ds = _upload(client, columns, d.name)
        chan = scratch_data.channel_map(columns, ds)
        assert set(chan) == {c["short"] for c in columns}, d.name
        n = len(columns[0]["values"] if columns[0].get("text") is None else columns[0]["text"])
        assert len(ds["time"]) == n, d.name


def test_dates_import_as_the_planted_unix_seconds(generated: Path, client: TestClient) -> None:
    fam = json.loads((generated / "dates" / "family.json").read_text(encoding="utf-8"))
    columns = scratch_data.graph_columns(fam)
    ds = _upload(client, columns, "dates")
    want = [scratch_data.origin_day_to_unix(v) for v in columns[0]["values"]]
    assert ds["time"] == pytest.approx(want)


def test_matrix_is_written_long_form_with_its_axes(generated: Path) -> None:
    fam = json.loads((generated / "matrix" / "family.json").read_text(encoding="utf-8"))
    cols = scratch_data.graph_columns(fam)
    assert [c["designation"] for c in cols] == ["X", "Y", "Z"]
    m = fam["matrices"][0]
    assert len(cols[2]["values"]) == len(m["values"]) * len(m["values"][0])
    # row i, column j -> (x_j, y_i, z[i][j])
    assert (
        cols[0]["values"][1] > cols[0]["values"][0] and cols[1]["values"][1] == cols[1]["values"][0]
    )
    assert cols[2]["values"][1] == m["values"][0][1]


def test_prelude_replays_designations_masks_axes_and_styles() -> None:
    columns = [
        {
            "short": "A",
            "long": "x",
            "units": "",
            "designation": "X",
            "fmt": "numeric",
            "values": [1.0],
        },
        {
            "short": "B",
            "long": "y",
            "units": "",
            "designation": "Y",
            "fmt": "numeric",
            "values": [1.0],
        },
        {
            "short": "C",
            "long": "dy",
            "units": "",
            "designation": "Y-error",
            "fmt": "numeric",
            "values": [1.0],
        },
    ]
    fam = {"books": [{"sheets": [{"masked_rows": {"B": [3, 1]}}]}], "axis": {"y": "log10"}}
    oracle = {"requested_styles": [{"c": 2, "w": 1000, "d": 1, "k": 3, "z": 8}]}
    p = scratch_data.prelude(fam, columns, {"A": -1, "B": 0, "C": 1}, oracle)
    assert p["designations"] == {"1": "Y-error"}
    assert p["excluded_rows"] == [1, 3]
    assert p["axis"] == {"y": "log10"}
    assert p["styles"] == [
        {
            "color": "#ff0000",
            "width": 2.0,
            "line": "dashed",
            "markerShape": "triangle",
            "markerSize": 8.0,
        }
    ]


_ORACLE = {
    "requested_styles": [{"c": 2, "w": 1000, "d": 0}],
    "graph": {
        "layers": [
            {
                "index": 0,
                "axes": {
                    "x": {"from": 0.0, "to": 2.0, "type": 1.0},
                    "y": {"from": 0.0, "to": 4.0, "type": 1.0},
                },
                "plots": [
                    {"plot_type": 200, "ref": '[B]Sheet1!B"y"', "x_dataset": "B_A"},
                    {"plot_type": 231, "ref": '[B]Sheet1!C"dy"', "x_dataset": "B_B"},
                ],
            }
        ]
    },
}


def _ctx(ptype: str = "line") -> dict[str, Any]:
    columns = [
        {
            "short": "A",
            "long": "x",
            "units": "",
            "designation": "X",
            "fmt": "numeric",
            "values": [0.0, 1.0, 2.0],
            "text": None,
        },
        {
            "short": "B",
            "long": "y",
            "units": "",
            "designation": "Y",
            "fmt": "numeric",
            "values": [1.0, None, 4.0],
            "text": None,
        },
    ]
    return {
        "type": ptype,
        "family": "f",
        "fam": {"books": [{"sheets": [{}]}]},
        "oracle": _ORACLE,
        "columns": columns,
        "chan": {"A": -1, "B": 0},
        "recipe": scratch_recipes.RECIPES[ptype],
    }


def _figure(styles: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "route": "figure",
        "spec": {
            "dataset": {
                "time": [0.0, 1.0, 2.0],
                "values": [[1.0], [None], [4.0]],
                "labels": ["y"],
                "units": [""],
                "metadata": {"x_column_name": "x"},
            },
            "y_keys": [0],
            "series_styles": styles,
            # The oracle's 231 companion: a Y error bar on the one curve.
            "error_spans": [{"y": {"plus": [0.1, None, 0.1], "minus": [0.1, None, 0.1]}}],
        },
    }


def test_origin_curves_drop_error_companions() -> None:
    assert scratch_score.origin_curves(_ORACLE) == [{"layer": 0, "type": 200, "y": "B", "x": "A"}]


def test_a_faithful_line_matches() -> None:
    axes = {"xlim": [0.0, 2.0], "ylim": [0.0, 4.0], "xscale": "linear", "yscale": "linear"}
    row = scratch_score.score_specimen(
        _ctx(), _figure([{"color": "#FF0000", "width": 2.0}]), {"status": 200, "axes": axes}
    )
    assert row["verdict"] == "match", row
    assert {k: v["state"] for k, v in row["checks"].items()} == {
        "type": "ok",
        "curves": "ok",
        "binding": "ok",
        "values": "ok",
        "axes": "ok",
        "styles": "ok",
    }


def test_a_scatter_with_wrong_values_mismatches_on_type_and_values() -> None:
    built = _figure([{"color": "#00ff00", "line": "none", "marker": True}])
    built["spec"]["dataset"]["values"] = [[1.0], [None], [5.0]]
    row = scratch_score.score_specimen(_ctx(), built, {"status": 200})
    assert row["verdict"] == "mismatch"
    assert row["checks"]["type"]["state"] == "wrong" and row["checks"]["values"]["state"] == "wrong"
    assert row["checks"]["styles"]["state"] == "wrong"


def test_unbuildable_and_failed_recipes_are_reported_not_scored() -> None:
    assert scratch_score.score_specimen(_ctx("bar"), None, {})["verdict"] == "unbuildable"
    row = scratch_score.score_specimen(_ctx(), {"key": "k", "error": "gallery refused"}, {})
    assert row["verdict"] == "not built" and row["why"] == "gallery refused"


def test_qz_type_reads_each_renderer() -> None:
    assert scratch_score.qz_type("statplot", {"kind": "violin"}) == "violin"
    assert scratch_score.qz_type("categorical", {"stacked": True}) == "stacked_column"
    assert scratch_score.qz_type("map", {"kind": "heatmap"}) == "heatmap"
    assert scratch_score.qz_type("figure", {"polar": {}}) == "polar"
    assert (
        scratch_score.qz_type("figure", {"series_styles": [{"step": "post"}]}) == "step_horizontal"
    )
    assert scratch_score.qz_type("figure", {"series_styles": [{"fill": "under"}]}) == "area"


def test_review_page_and_table(tmp_path: Path) -> None:
    rows = [
        scratch_score.score_specimen(
            _ctx(), _figure([{"color": "#ff0000", "width": 2.0}]), {"status": 200}
        ),
        scratch_score.score_specimen(_ctx("bar"), None, {}),
    ]
    scratch_review.write_review(rows, tmp_path)
    page = (tmp_path / "index.html").read_text(encoding="utf-8")
    assert "<title>Plot corpus review</title>" in page and "unbuildable" in page
    md = (tmp_path / "scorecard.md").read_text(encoding="utf-8")
    assert "| line | 1 | 1 | 1 |" in md and "| bar | 1 | unbuildable |" in md


def test_a_curve_on_the_wrong_x_and_missing_error_bars_break_binding() -> None:
    built = _figure([{"color": "#ff0000", "width": 2.0}])
    built["spec"]["dataset"]["time"] = [5.0, 6.0, 7.0]
    del built["spec"]["error_spans"]
    row = scratch_score.score_specimen(_ctx(), built, {"status": 200})
    assert row["checks"]["values"]["state"] == "ok"
    why = row["checks"]["binding"]["why"]
    assert "not drawn against X column x" in why
    assert "error bars quantized [], Origin [231]" in why

"""Export robustness (lane EX audit): silent precision loss in the Origin CSV,
xlsx hard limits, unbounded numeric knobs that took the server down, and a
log axis that dropped points without saying so. Synthetic data only."""

from __future__ import annotations

import csv
import io
import json
import zipfile
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook

from quantized.app import app
from quantized.calc import figure_corner
from quantized.io.table_export import ExportColumn, ExportSheet, format_xlsx

client = TestClient(app)


def _ds(t: list[float], cols: list[list[float]], labels: list[str], **meta: Any) -> dict[str, Any]:
    return {
        "time": t,
        "values": [list(r) for r in zip(*cols, strict=True)],
        "labels": labels,
        "units": [""] * len(labels),
        "metadata": meta,
    }


def _origin_csv(dataset: dict[str, Any]) -> list[list[str]]:
    r = client.post("/api/export/origin", json={"dataset": dataset, "filename": "e"})
    assert r.status_code == 200, r.text
    z = zipfile.ZipFile(io.BytesIO(r.content))
    text = z.read("e_data.csv").decode("utf-8-sig")
    return list(csv.reader(io.StringIO(text)))


# ── Origin ASCII ─────────────────────────────────────────────────────────────


def test_origin_csv_keeps_subsecond_timestamps_distinct() -> None:
    """Epoch seconds at 1 ms spacing printed as ``%.10g`` collapsed to ONE
    value (1772300000 x5): the exported X column was silently wrong."""
    t = [1.772300000123e9 + i * 0.001 for i in range(5)]
    rows = _origin_csv(_ds(t, [[1.0, 2.0, 3.0, 4.0, 5.0]], ["y"], time_is_datetime=True))
    xs = [float(r[0]) for r in rows[2:]]
    assert len(set(xs)) == 5
    assert xs == pytest.approx(t, abs=1e-6)


def test_origin_csv_keeps_close_y_values_distinct() -> None:
    y = [1.00000000001, 1.00000000002, 1.00000000003]
    rows = _origin_csv(_ds([0.0, 1.0, 2.0], [y], ["y"]))
    assert [float(r[1]) for r in rows[2:]] == pytest.approx(y, rel=1e-15)


def test_origin_csv_ordinary_columns_stay_at_ten_digits() -> None:
    """The MATLAB golden's ``%.10g`` is untouched where nothing collapses."""
    rows = _origin_csv(_ds([1 / 3, 2 / 3, 1.0], [[0.1, 0.25, 1e-12]], ["y"]))
    assert [r[0] for r in rows[2:]] == ["0.3333333333", "0.6666666667", "1"]


def test_origin_csv_multiline_label_cannot_split_the_header() -> None:
    d = _ds([0.0, 1.0], [[1.0, 2.0]], ["a\nb"])
    d["units"] = ["u\r\nv"]
    rows = _origin_csv(d)
    assert rows[0] == ["X", "a b"]
    assert rows[1] == ["", "u v"]
    assert [r[1] for r in rows[2:]] == ["1", "2"]


# ── worksheet xlsx ───────────────────────────────────────────────────────────


def test_xlsx_control_characters_do_not_500() -> None:
    body = {
        "sheets": [
            {
                "name": "S",
                "columns": [
                    {"name": "a\x00b", "cells": [1.0, 2.0]},
                    {"name": "t", "kind": "text", "cells": ["x\x00y", "\x0bz"]},
                ],
            }
        ],
        "fmt": "xlsx",
    }
    r = client.post("/api/export/worksheet", json=body)
    assert r.status_code == 200, r.text
    ws = load_workbook(io.BytesIO(r.content)).active
    assert ws["A1"].value == "a�b"
    assert ws["B2"].value == "x�y"


def test_xlsx_cell_is_cut_at_excels_limit() -> None:
    sheet = ExportSheet("S", [ExportColumn("t", "", "text", ["z" * 40000])])
    ws = load_workbook(io.BytesIO(format_xlsx([sheet]))).active
    assert len(ws["A2"].value) == 32767


def test_xlsx_refuses_more_rows_than_excel_holds() -> None:
    sheet = ExportSheet("S", [ExportColumn("n", "", "number", [None] * 1_048_577)])
    with pytest.raises(ValueError, match="at most"):
        format_xlsx([sheet])


# ── unbounded knobs ──────────────────────────────────────────────────────────

_GRID = {
    "x_axis": [0.0, 1.0, 2.0],
    "y_axis": [0.0, 1.0],
    "z_grid": [[0.0, 1.0, 2.0], [1.0, 2.0, 3.0]],
    "kind": "contourf",
    "fmt": "svg",
}


def test_map_levels_count_is_bounded() -> None:
    r = client.post("/api/export/map-figure", json={**_GRID, "levels": 10**9})
    assert r.status_code == 422
    assert "too large" in r.json()["detail"]


def test_map_levels_list_is_bounded() -> None:
    r = client.post("/api/export/map-figure", json={**_GRID, "levels": list(range(5000))})
    assert r.status_code == 422


def test_corner_bin_count_is_clamped_before_numpy_allocates(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: list[Any] = []
    real = np.histogram_bin_edges

    def spy(a: Any, bins: Any = 10, *args: Any, **kw: Any) -> Any:
        seen.append(bins)
        return real(a, bins, *args, **kw)

    monkeypatch.setattr(figure_corner.np, "histogram_bin_edges", spy)
    edges = figure_corner._bin_edges(np.linspace(0.0, 1.0, 50), 10**9)
    assert max(seen) <= 60
    assert edges.size - 1 == 60


def test_histogram_bin_count_is_bounded() -> None:
    from quantized.calc.statplots import histogram

    with pytest.raises(ValueError, match="too large"):
        histogram([1.0, 2.0, 3.0], bins=10**9)


def test_huge_font_size_is_a_422_not_a_500() -> None:
    d = _ds([0.0, 1.0, 2.0], [[1.0, 2.0, 3.0]], ["y"])
    r = client.post(
        "/api/export/figure", json={"dataset": d, "fmt": "svg", "overrides": {"font_size": 1e6}}
    )
    assert r.status_code == 422
    assert "font_size" in r.json()["detail"]


def test_raster_export_is_pixel_capped() -> None:
    d = _ds([0.0, 1.0, 2.0], [[1.0, 2.0, 3.0]], ["y"])
    big = {"dataset": d, "fmt": "png", "dpi": 600, "width_in": 100, "height_in": 100}
    r = client.post("/api/export/figure", json=big)
    assert r.status_code == 422
    assert "megapixels" in r.json()["detail"]
    ok = client.post("/api/export/figure", json={"dataset": d, "fmt": "png", "dpi": 300})
    assert ok.status_code == 200 and ok.content.startswith(b"\x89PNG")


# ── log axis says what it dropped ────────────────────────────────────────────


def test_log_axis_reports_non_positive_points_it_cannot_draw() -> None:
    t = [float(i) for i in range(10)]
    d = _ds(t, [[float(v) - 3.0 for v in t]], ["y"])
    r = client.post("/api/export/figure", json={"dataset": d, "fmt": "svg", "y_log": True})
    assert r.status_code == 200
    warnings = json.loads(r.headers["X-Figure-Warnings"])
    assert any("4 point(s)" in w and "log y axis" in w for w in warnings), warnings


def test_log_axis_with_all_positive_data_has_no_warning() -> None:
    t = [float(i) for i in range(1, 6)]
    d = _ds(t, [t], ["y"])
    r = client.post("/api/export/figure", json={"dataset": d, "fmt": "svg", "y_log": True})
    assert r.status_code == 200
    assert not r.headers.get("X-Figure-Warnings")

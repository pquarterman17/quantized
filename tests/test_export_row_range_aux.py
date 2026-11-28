"""A row window on the polar map and the G15 plots -- screen == export, the BACKEND half.

``frontend/src/components/workshops/rowWindowAux.test.tsx`` pins the request the stage previews
and Export sends, per kind, in ``row_range_aux.json`` (rows 21-44 of 200, row 26 excluded). The
figure the server draws from it must hold exactly those rows: each case compares what matplotlib
drew with an independent numpy selection of the sheet. The sheet outside the window holds 9000+
values, so one leaked row would show in every comparison.

Sheet: x = row + 1 (an Origin text X names category positions 1..n, so the labels follow the X
value); Chi = 7 row mod 91; Phi = 47 row mod 360; Intensity = 10 + 13 row mod 17 and B = 5 row
mod 11 inside the window (9000 + row outside); category = one of four names by 3 row mod 4.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import matplotlib.figure
import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.polar_map import grid_polar_map

client = TestClient(app)

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "row_range_aux.json"
CASES = {c["kind"]: c for c in json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]}
NAMES = ["dust", "scratch", "pit", "crack"]


def _figure(monkeypatch: pytest.MonkeyPatch, kind: str) -> Any:
    kept: list[Any] = []
    real = matplotlib.figure.Figure.savefig

    def capturing(self: Any, *a: Any, **kw: Any) -> None:
        kept.append(self)
        real(self, *a, **kw)

    monkeypatch.setattr(matplotlib.figure.Figure, "savefig", capturing)
    r = client.post("/api/export/figure", json={**CASES[kind]["request"], "fmt": "png"})
    monkeypatch.undo()
    assert r.status_code == 200, r.text
    return kept[-1]


def _window() -> dict[str, np.ndarray]:
    row = np.arange(200)
    keep = (row >= 20) & (row <= 43) & (row != 25)
    r = row[keep]
    return {
        "x": (r + 1).astype(float),
        "chi": ((7 * r) % 91).astype(float),
        "phi": ((47 * r) % 360).astype(float),
        "inten": (10 + (13 * r) % 17).astype(float),
        "b": ((5 * r) % 11).astype(float),
        "cat": np.array([NAMES[(3 * i) % 4] for i in r]),
    }


def test_the_request_holds_the_window_rows_only() -> None:
    w = _window()
    for case in CASES.values():
        ds = case["request"]["dataset"]
        assert ds["time"] == pytest.approx(w["x"])
        assert len(ds["values"]) == 23


def test_parallel_coordinates_draw_one_line_per_window_row(monkeypatch: pytest.MonkeyPatch) -> None:
    w = _window()
    m = np.column_stack([w["x"], w["chi"], w["phi"], w["inten"], w["b"]])
    scaled = (m - m.min(axis=0)) / (m.max(axis=0) - m.min(axis=0))
    ax = _figure(monkeypatch, "parallel").axes[0]
    drawn = np.array([ln.get_ydata() for ln in ax.lines if len(ln.get_xdata()) == 5])
    assert drawn.shape == scaled.shape
    assert drawn == pytest.approx(scaled)


def test_hexbin_counts_the_window_rows(monkeypatch: pytest.MonkeyPatch) -> None:
    w = _window()
    ax = _figure(monkeypatch, "hexbin").axes[0]
    assert float(np.sum(ax.collections[0].get_array())) == 23
    assert ax.get_xlim() == pytest.approx((w["chi"].min(), w["chi"].max()))
    assert ax.get_ylim() == pytest.approx((w["phi"].min(), w["phi"].max()))


def test_kde_points_are_the_window_rows(monkeypatch: pytest.MonkeyPatch) -> None:
    w = _window()
    ax = _figure(monkeypatch, "kde2d").axes[0]
    pts = np.asarray(ax.collections[-1].get_offsets())
    assert pts[:, 0] == pytest.approx(w["chi"])
    assert pts[:, 1] == pytest.approx(w["phi"])


def test_pareto_sums_the_window_rows_per_category(monkeypatch: pytest.MonkeyPatch) -> None:
    w = _window()
    want = {n: float(w["inten"][w["cat"] == n].sum()) for n in NAMES if (w["cat"] == n).any()}
    ax = _figure(monkeypatch, "pareto").axes[0]
    ticks, bars = ax.get_xticklabels(), ax.patches
    got = {t.get_text(): p.get_height() for t, p in zip(ticks, bars, strict=True)}
    assert got == pytest.approx(want)
    assert list(got.values()) == sorted(got.values(), reverse=True)


def test_bland_altman_points_and_bias_are_the_window_rows(monkeypatch: pytest.MonkeyPatch) -> None:
    w = _window()
    ax = _figure(monkeypatch, "blandAltman").axes[0]
    pts = np.asarray(ax.collections[0].get_offsets())
    assert pts[:, 0] == pytest.approx((w["chi"] + w["phi"]) / 2)
    assert pts[:, 1] == pytest.approx(w["chi"] - w["phi"])
    assert float(ax.lines[0].get_ydata()[0]) == pytest.approx(float(np.mean(w["chi"] - w["phi"])))


def test_polar_map_is_gridded_from_the_window_rows(monkeypatch: pytest.MonkeyPatch) -> None:
    w = _window()
    ax = _figure(monkeypatch, "polarMap").axes[0]
    want = grid_polar_map(w["chi"], w["phi"], w["inten"], projection="equal_area").z
    got = np.ma.filled(ax.collections[0].get_array().reshape(want.shape), np.nan)
    np.testing.assert_allclose(got, want, equal_nan=True)
    assert np.nanmax(got) <= w["inten"].max() + 1e-9  # a leaked 9000 row would pass this bound

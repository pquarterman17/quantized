"""Wide-plot decimation (live audit: 200k rows x 49 channels).

The shared-x union of every series' picks was ~min(n, 2 * buckets * n_series)
rows, so a wide plot shipped (and the browser drew) nearly every row. The
load-invariant asserted here is the row bound and per-series extremum
preservation, never a wall-clock time.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from fastapi.testclient import TestClient
from numpy.typing import NDArray

from quantized.app import app
from quantized.calc.decimate import GAP_ROW_CAP, gap_plan, reduce_plot_rows

N = 20_000


def _wide(n_series: int) -> tuple[NDArray[np.float64], list[NDArray[np.float64]]]:
    rng = np.random.default_rng(1)
    x = np.arange(N, dtype=float)
    cols = [rng.standard_normal(N) for _ in range(n_series)]
    for s, c in enumerate(cols):
        c[(137 * (s + 1)) % N] = 100.0 + s  # a spike only this series owns
    return x, cols


def test_gap_plan_leaves_narrow_plots_alone() -> None:
    assert gap_plan(1440, 3) == (1440, False)
    assert gap_plan(1440, 0) == (1440, False)
    eff, gapped = gap_plan(1440, 49)
    assert gapped and 2 * eff * 49 <= GAP_ROW_CAP


def test_row_count_is_bounded_independent_of_series_count() -> None:
    for n_series in (3, 12, 49, 200):
        x, cols = _wide(n_series)
        xo, co, rows = reduce_plot_rows(x, cols, None, 1440)
        assert len(xo) <= GAP_ROW_CAP
        assert rows is not None and len(rows) == len(xo)
        assert all(len(c) == len(xo) for c in co)


def test_each_series_keeps_its_own_extremes_and_nan_elsewhere() -> None:
    x, cols = _wide(49)
    _, co, rows = reduce_plot_rows(x, cols, None, 1440)
    assert rows is not None
    for s, (full, out) in enumerate(zip(cols, co, strict=True)):
        kept = np.isfinite(out)
        assert kept.sum() < len(out) / 4  # gapped: only its own picks
        assert out[kept].max() == full.max() == 100.0 + s
        assert out[kept].min() == full.min()
        assert np.array_equal(out[kept], full[rows[kept]])  # real samples, row-aligned


def test_narrow_plot_is_unchanged_shared_union() -> None:
    x, cols = _wide(3)
    _, co, _ = reduce_plot_rows(x, cols, None, 1440)
    assert all(np.isfinite(c).all() for c in co)


def test_route_flags_gapped_payload() -> None:
    client = TestClient(app)
    n_series = 49
    x, cols = _wide(n_series)
    dataset: dict[str, Any] = {
        "time": x.tolist(),
        "values": np.column_stack(cols).tolist(),
        "labels": [f"c{i}" for i in range(n_series)],
        "units": [""] * n_series,
        "metadata": {},
    }
    body = client.post("/api/plot/series", json={"dataset": dataset, "decimate_width": 1440}).json()
    assert body["decimated"] is True and body["gapped"] is True
    assert len(body["data"][0]) <= GAP_ROW_CAP
    narrow = client.post(
        "/api/plot/series",
        json={"dataset": dataset, "y_keys": ["c0", "c1"], "decimate_width": 1440},
    ).json()
    assert narrow["gapped"] is False

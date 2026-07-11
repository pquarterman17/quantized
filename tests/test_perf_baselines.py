"""Performance baselines: wall-time regression tripwires (PORT_PLAN W9 #53).

These are TRIPWIRES, not benchmarks: each case asserts a deliberately
generous ceiling that only an order-of-magnitude regression (an accidental
O(n^2) loop, per-row Python iteration, a debug sleep) can trip — normal
machine-to-machine variance never should. CI Windows runners measure 5-6x
slower than a dev machine, so every ceiling is >= 14x the local measurement
recorded in the case comment (measured 2026-07-11, best of 5, warm process).

Each case warms up once (untimed) before timing best-of-3, so cold numpy /
matplotlib font caches on a fresh CI process cannot flake the bound.

Human-readable timing table for the same cases:
``uv run python tools/bench/bench.py`` (keep the two files in sync).
"""

from __future__ import annotations

import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from quantized.calc.corrections import apply_corrections
from quantized.calc.figure import render_figure
from quantized.calc.fit_models import evaluate
from quantized.calc.fitting import curve_fit
from quantized.datastruct import DataStruct
from quantized.io.delimited import import_csv

pytestmark = pytest.mark.perf


def _best_of(fn: Callable[[], object], repeat: int = 3) -> float:
    """Best wall time of ``repeat`` runs, after one untimed warm-up call."""
    fn()  # warm-up: JIT-free but primes imports, caches, and the file cache
    best = float("inf")
    for _ in range(repeat):
        t0 = time.perf_counter()
        fn()
        best = min(best, time.perf_counter() - t0)
    return best


@pytest.fixture(scope="module")
def medium_csv(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """A 50,000-row x 8-column CSV (generation is not part of the timing)."""
    rng = np.random.default_rng(42)
    path = tmp_path_factory.mktemp("perf") / "medium.csv"
    header = ",".join(f"ch{i} (V)" for i in range(8))
    np.savetxt(path, rng.normal(size=(50_000, 8)), delimiter=",", header=header, comments="")
    return path


def test_csv_import_baseline(medium_csv: Path) -> None:
    """Medium CSV import. Local: ~0.35 s -> ceiling 5 s (~14x)."""
    best = _best_of(lambda: import_csv(medium_csv))
    assert best < 5.0, f"import_csv(50k x 8) took {best:.2f}s (ceiling 5.0s)"


def test_correction_chain_baseline() -> None:
    """Representative correction chain (trim + offsets + poly background +
    smoothing + normalization + derivative) on 100k x 4.
    Local: ~0.011 s -> ceiling 0.5 s (~45x)."""
    rng = np.random.default_rng(7)
    n = 100_000
    t = np.linspace(-10.0, 10.0, n)
    vals = rng.normal(size=(n, 4)) + t[:, None] * 0.5
    ds = DataStruct.create(t, vals, labels=["a", "b", "c", "d"], units=["V"] * 4)
    params: dict[str, Any] = {
        "xTrimMin": -9.0,
        "xTrimMax": 9.0,
        "xOff": 0.1,
        "yOff": 0.05,
        "bgPoly": [0.01, -0.2, 0.5, 1.0],
        "smoothEnabled": True,
        "smoothWindow": 7,
        "smoothMethod": "moving",
        "normMethod": "Range [0,1]",
        "derivativeMode": "dY/dX",
    }
    best = _best_of(lambda: apply_corrections(ds, params))
    assert best < 0.5, f"apply_corrections(100k x 4) took {best:.3f}s (ceiling 0.5s)"


def test_curve_fit_baseline() -> None:
    """Gaussian curve fit (Nelder-Mead + error estimation) on 2,000 points.
    Local: ~0.008 s -> ceiling 0.5 s (~60x)."""
    rng = np.random.default_rng(11)
    x = np.linspace(-5.0, 5.0, 2000)
    y = np.asarray(evaluate("Gaussian", x, [2.0, 0.3, 0.8]), dtype=float)
    y = y + rng.normal(scale=0.02, size=x.size)

    def gauss(xv: Any, p: Any) -> Any:
        return evaluate("Gaussian", xv, p)

    best = _best_of(lambda: curve_fit(x, y, gauss, [1.0, 0.0, 1.0]))
    assert best < 0.5, f"curve_fit(Gaussian, 2000 pts) took {best:.3f}s (ceiling 0.5s)"


def test_figure_export_svg_baseline() -> None:
    """Server-side vector export (matplotlib SVG), 3 series x 5,000 points.
    Local: ~0.067 s -> ceiling 2 s (~30x)."""
    rng = np.random.default_rng(3)
    x = np.linspace(0.0, 10.0, 5000)
    series = [
        (f"series {i}", np.sin(x + i) + 0.05 * rng.normal(size=x.size)) for i in range(3)
    ]
    best = _best_of(
        lambda: render_figure(x, series, fmt="svg", title="perf", x_label="x", y_label="y")
    )
    assert best < 2.0, f"render_figure(svg, 3 x 5000) took {best:.3f}s (ceiling 2.0s)"

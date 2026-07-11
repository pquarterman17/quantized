"""Timing table for the perf-baseline cases — for humans, not CI.

Runs the same four cases as ``tests/test_perf_baselines.py`` (keep the two
in sync) and prints wall times next to the test ceilings so a developer can
see the headroom at a glance:

    uv run python tools/bench/bench.py

The pytest ceilings are regression TRIPWIRES (>= 14x local measurements);
this table is where the actual numbers live.
"""

from __future__ import annotations

import tempfile
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import numpy as np

from quantized.calc.corrections import apply_corrections
from quantized.calc.figure import render_figure
from quantized.calc.fit_models import evaluate
from quantized.calc.fitting import curve_fit
from quantized.datastruct import DataStruct
from quantized.io.delimited import import_csv

REPEAT = 5


def best_of(fn: Callable[[], object], repeat: int = REPEAT) -> float:
    """Best wall time of ``repeat`` runs, after one untimed warm-up call."""
    fn()
    best = float("inf")
    for _ in range(repeat):
        t0 = time.perf_counter()
        fn()
        best = min(best, time.perf_counter() - t0)
    return best


def case_csv_import(workdir: Path) -> tuple[Callable[[], object], float]:
    rng = np.random.default_rng(42)
    path = workdir / "medium.csv"
    header = ",".join(f"ch{i} (V)" for i in range(8))
    np.savetxt(path, rng.normal(size=(50_000, 8)), delimiter=",", header=header, comments="")
    return (lambda: import_csv(path)), 5.0


def case_correction_chain(_workdir: Path) -> tuple[Callable[[], object], float]:
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
    return (lambda: apply_corrections(ds, params)), 0.5


def case_curve_fit(_workdir: Path) -> tuple[Callable[[], object], float]:
    rng = np.random.default_rng(11)
    x = np.linspace(-5.0, 5.0, 2000)
    y = np.asarray(evaluate("Gaussian", x, [2.0, 0.3, 0.8]), dtype=float)
    y = y + rng.normal(scale=0.02, size=x.size)

    def gauss(xv: Any, p: Any) -> Any:
        return evaluate("Gaussian", xv, p)

    return (lambda: curve_fit(x, y, gauss, [1.0, 0.0, 1.0])), 0.5


def case_figure_export_svg(_workdir: Path) -> tuple[Callable[[], object], float]:
    rng = np.random.default_rng(3)
    x = np.linspace(0.0, 10.0, 5000)
    series = [
        (f"series {i}", np.sin(x + i) + 0.05 * rng.normal(size=x.size)) for i in range(3)
    ]
    return (
        lambda: render_figure(x, series, fmt="svg", title="perf", x_label="x", y_label="y")
    ), 2.0


CASES: dict[str, Callable[[Path], tuple[Callable[[], object], float]]] = {
    "CSV import (50k x 8)": case_csv_import,
    "correction chain (100k x 4)": case_correction_chain,
    "curve fit (Gaussian, 2000 pts)": case_curve_fit,
    "figure export SVG (3 x 5000)": case_figure_export_svg,
}


def main() -> None:
    name_w = max(len(name) for name in CASES) + 2
    print(f"{'case':<{name_w}} {'best ms':>10} {'ceiling ms':>12} {'headroom':>10}")
    print("-" * (name_w + 36))
    with tempfile.TemporaryDirectory(prefix="qz-bench-") as tmp:
        workdir = Path(tmp)
        for name, build in CASES.items():
            fn, ceiling_s = build(workdir)
            best = best_of(fn)
            headroom = ceiling_s / best if best > 0 else float("inf")
            print(
                f"{name:<{name_w}} {best * 1000:>10.1f} {ceiling_s * 1000:>12.0f} "
                f"{headroom:>9.1f}x"
            )
    print(f"\nbest of {REPEAT} runs each (one untimed warm-up); "
          "ceilings = tests/test_perf_baselines.py")


if __name__ == "__main__":
    main()

"""P0.4-scale fixtures (``--large`` mode only). Never committed.

These exist to give the upcoming P0.4 performance-envelope work a ready
corpus without re-deriving generation logic: a ~1,000,000-row numeric CSV,
a >=1000x1000 2-D map (reusing the journey-6 RSM generator at scale), and a
dense multi-series CSV (many columns x many rows) for downsampling work.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from rsm import write_xrdml_rsm

__all__ = ["write_dense_multiseries_csv", "write_large_csv", "write_large_map"]


def write_large_csv(path: Path, *, seed: int, n_rows: int = 1_000_000, n_cols: int = 8) -> None:
    """A ~1,000,000-row x 8-column numeric CSV (time + 7 channels)."""
    rng = np.random.default_rng(seed)
    header = ",".join(["Time (s)", *(f"Channel {i} (V)" for i in range(1, n_cols))])
    t = np.arange(n_rows, dtype=float) * 0.01
    values = rng.normal(size=(n_rows, n_cols - 1)) + 0.0001 * t[:, None]
    matrix = np.column_stack([t, values])
    # np.savetxt streams row-by-row without materializing the formatted text
    # twice in memory, unlike building a Python list of joined strings first.
    with path.open("w", newline="") as fh:
        fh.write(f"{header}\n")
        np.savetxt(fh, matrix, delimiter=",", fmt="%.6g")


def write_dense_multiseries_csv(
    path: Path, *, seed: int, n_rows: int = 100_000, n_series: int = 20
) -> None:
    """A dense multi-series CSV: one time column + ``n_series`` value columns."""
    rng = np.random.default_rng(seed)
    t = np.linspace(0.0, 100.0, n_rows)
    header = ",".join(["Time (s)", *(f"series{i} (arb.)" for i in range(1, n_series + 1))])
    series = np.column_stack(
        [
            np.sin(t * (0.2 + 0.05 * i)) + 0.03 * rng.normal(size=n_rows)
            for i in range(1, n_series + 1)
        ]
    )
    matrix = np.column_stack([t, series])
    with path.open("w", newline="") as fh:
        fh.write(f"{header}\n")
        np.savetxt(fh, matrix, delimiter=",", fmt="%.6g")


def write_large_map(path: Path, *, seed: int, n_omega: int = 1000, n_tt: int = 1000) -> None:
    """A >=1000x1000 2-D map, in the same XRDML RSM-mesh format as the small
    committed fixture (``tools/baselines/rsm.py``)."""
    write_xrdml_rsm(
        path,
        seed=seed,
        n_omega=n_omega,
        n_tt=n_tt,
        tt_start=40.0,
        tt_end=44.0,
        omega_start=20.5,
        omega_end=21.3,
    )

"""Seeded generators for the wave-4 oracle cases (map correlation, scattered
and trace interpolation, B-spline, surface area, PSD, row t-tests, averaging).

Same contract as ``oracle_inputs``: a ``numpy.random.Generator`` in, an
``InputSpec`` out. Planted truth is computed without Origin or quantized.
"""

from __future__ import annotations

import numpy as np
from oracle_model import Column, InputSpec


def _blobs(x: np.ndarray, y: np.ndarray, centres: np.ndarray) -> np.ndarray:
    z = np.zeros_like(x)
    for k, (cx, cy) in enumerate(centres):
        z += (1.0 + 0.4 * k) * np.exp(-0.5 * (((x - cx) / 1.1) ** 2 + ((y - cy) / 0.9) ** 2))
    return z


def map_pair(rng: np.random.Generator) -> InputSpec:
    """Two 28 x 22 maps (step 0.5) of the same blob pattern, the second
    shifted by (+1.5, +1.0) = (3 columns, 2 rows), plus a little noise."""
    nx, ny, step = 28, 22, 0.5
    gx, gy = np.meshgrid(np.arange(nx) * step, np.arange(ny) * step)
    centres = np.column_stack([rng.uniform(3.0, 9.0, 4), rng.uniform(2.5, 7.5, 4)])
    z1 = _blobs(gx, gy, centres) + rng.normal(0.0, 0.01, gx.shape)
    z2 = _blobs(gx - 1.5, gy - 1.0, centres) + rng.normal(0.0, 0.01, gx.shape)
    return InputSpec(
        (
            Column("x", "X", gx.ravel()),
            Column("y", "Y", gy.ravel()),
            Column("z1", "Y", z1.ravel()),
            Column("z2", "Y", z2.ravel()),
        ),
        {"grid": [nx, ny], "step": step, "shift_xy": [1.5, 1.0], "shift_cells": [3, 2]},
    )


def spiral_path(rng: np.random.Generator) -> InputSpec:
    """A non-monotonic path (an outward spiral, x doubles back) on 40 points."""
    t = np.sort(rng.uniform(0.0, 4.0 * np.pi, 40))
    t[0], t[-1] = 0.0, 4.0 * np.pi
    r = 1.0 + 0.4 * t
    return InputSpec(
        (Column("x", "X", r * np.cos(t)), Column("y", "Y", r * np.sin(t))),
        {"path": "x = (1 + 0.4 t) cos t, y = (1 + 0.4 t) sin t", "n_points": 40},
    )


def scattered_with_queries(rng: np.random.Generator) -> InputSpec:
    """150 scattered points on ``sin(0.6 x) cos(0.5 y) + 0.05 x`` over
    [0, 10] x [0, 8] (corners included), plus 40 query points strictly inside."""
    n, nq = 150, 40
    x = rng.uniform(0.0, 10.0, n)
    y = rng.uniform(0.0, 8.0, n)
    x[:4], y[:4] = (0.0, 10.0, 0.0, 10.0), (0.0, 0.0, 8.0, 8.0)
    xq, yq = rng.uniform(0.5, 9.5, nq), rng.uniform(0.5, 7.5, nq)

    def f(a: np.ndarray, b: np.ndarray) -> np.ndarray:
        return np.sin(0.6 * a) * np.cos(0.5 * b) + 0.05 * a

    return InputSpec(
        (
            Column("x", "X", x), Column("y", "Y", y), Column("z", "Y", f(x, y)),
            Column("xq", "X", xq), Column("yq", "Y", yq),
        ),
        {"surface": "sin(0.6 x) cos(0.5 y) + 0.05 x", "n_points": n, "n_query": nq,
         "truth_at_query": f(xq, yq)},
    )


def noisy_curve(rng: np.random.Generator) -> InputSpec:
    """A smooth curve with noise on 30 irregular x, plus 70 query x values."""
    x = np.sort(rng.uniform(0.0, 10.0, 30))
    x[0], x[-1] = 0.0, 10.0
    clean = np.sin(0.7 * x) + 0.1 * x
    y = clean + rng.normal(0.0, 0.05, x.size)
    return InputSpec(
        (Column("x", "X", x), Column("y", "Y", y), Column("xq", "X", np.linspace(0, 10, 70))),
        {"clean": clean, "noise_sigma": 0.05},
    )


def psd_record(rng: np.random.Generator) -> InputSpec:
    """fs = 200 Hz, 1024 samples: a 20 Hz tone of amplitude 2 plus white noise (sigma 0.5)."""
    fs, n = 200.0, 1024
    t = np.arange(n) / fs
    y = 2.0 * np.sin(2 * np.pi * 20.0 * t) + rng.normal(0.0, 0.5, n)
    return InputSpec(
        (Column("t", "X", t), Column("y", "Y", y)),
        {"fs": fs, "interval": 1.0 / fs, "tone_hz": 20.0, "tone_amplitude": 2.0,
         "noise_sigma": 0.5},
    )


def row_groups(rng: np.random.Generator) -> InputSpec:
    """Eight rows of two groups of three replicates (columns 1-3 and 4-6); half
    the rows carry a real offset between groups."""
    rows = 8
    shift = np.where(np.arange(rows) % 2 == 0, 1.5, 0.0)
    a = rng.normal(5.0, 0.6, (rows, 3))
    b = rng.normal(5.0, 0.9, (rows, 3)) + shift[:, None]
    cols = [Column(f"a{i + 1}", "Y", a[:, i]) for i in range(3)]
    cols += [Column(f"b{i + 1}", "Y", b[:, i]) for i in range(3)]
    return InputSpec(tuple(cols), {"shift": shift, "n_rows": rows})


def curve_family(rng: np.random.Generator) -> InputSpec:
    """Three noisy curves on a shared x grid (x, y1, y2, y3)."""
    x = np.linspace(0.0, 10.0, 51)
    base = np.sin(x) + 0.1 * x
    ys = [base + rng.normal(0.0, 0.1, x.size) for _ in range(3)]
    return InputSpec(
        (Column("x", "X", x), *(Column(f"y{i + 1}", "Y", y) for i, y in enumerate(ys))),
        {"base": base},
    )


def dense_ramp(rng: np.random.Generator) -> InputSpec:
    """120 points of a noisy ramp, for block-mean reduction by 5."""
    x = np.arange(120, dtype=float)
    return InputSpec(
        (Column("x", "X", x), Column("y", "Y", 0.1 * x + rng.normal(0.0, 0.3, x.size))),
        {"factor": 5},
    )

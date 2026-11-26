"""Seeded generators for the map and gridding oracle cases (XYZ columns)."""

from __future__ import annotations

import math

import numpy as np
from oracle_model import Column, InputSpec


def gaussian_on_offset(rng: np.random.Generator) -> InputSpec:
    """A 2-D Gaussian on a constant offset over a regular 61 x 41 grid, as
    long-form X, Y, Z columns (X fastest). The Gaussian sits well inside the
    map, so its volume above the offset is known exactly: ``2 pi A sx sy``."""
    nx, ny = 61, 41
    x = np.linspace(0.0, 12.0, nx)
    y = np.linspace(0.0, 8.0, ny)
    cx, cy = float(rng.uniform(5.0, 7.0)), float(rng.uniform(3.0, 5.0))
    amp, sx, sy, offset = 4.0, float(rng.uniform(1.0, 1.4)), float(rng.uniform(0.7, 1.0)), 1.5
    gx, gy = np.meshgrid(x, y)
    z = offset + amp * np.exp(-0.5 * (((gx - cx) / sx) ** 2 + ((gy - cy) / sy) ** 2))
    return InputSpec(
        (
            Column("x", "X", gx.ravel()),
            Column("y", "Y", gy.ravel()),
            Column("z", "Y", z.ravel()),
        ),
        {
            "grid": [nx, ny],
            "x_range": [0.0, 12.0],
            "y_range": [0.0, 8.0],
            "offset": offset,
            "centre": [cx, cy],
            "sigma": [sx, sy],
            "amplitude": amp,
            "gaussian_volume": 2.0 * math.pi * amp * sx * sy,
        },
    )


def scattered_surface(rng: np.random.Generator) -> InputSpec:
    """150 scattered points over [0, 10] x [0, 8], four of them the corners (so
    the hull is the full rectangle), on the smooth surface
    ``z = sin(0.6 x) cos(0.5 y) + 0.05 x`` (no noise)."""
    n = 150
    x = rng.uniform(0.0, 10.0, n)
    y = rng.uniform(0.0, 8.0, n)
    x[:4] = (0.0, 10.0, 0.0, 10.0)
    y[:4] = (0.0, 0.0, 8.0, 8.0)
    z = np.sin(0.6 * x) * np.cos(0.5 * y) + 0.05 * x
    return InputSpec(
        (Column("x", "X", x), Column("y", "Y", y), Column("z", "Y", z)),
        {
            "surface": "sin(0.6 x) cos(0.5 y) + 0.05 x",
            "x_range": [0.0, 10.0],
            "y_range": [0.0, 8.0],
            "n_points": n,
        },
    )

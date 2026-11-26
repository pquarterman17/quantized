"""Seeded input generators for the oracle cases.

Peak shapes come from ``quantized.calc.peakshapes`` (never retyped), so the
planted truth and the shapes quantized fits are the same function. Every
generator takes a ``numpy.random.Generator`` and is deterministic given it.
"""

from __future__ import annotations

import math

import numpy as np
from numpy.typing import NDArray
from oracle_model import Column, InputSpec

from quantized.calc import peakshapes


def two_curves(rng: np.random.Generator) -> InputSpec:
    """y1 = sin(x) and y2 = 0.3 on one irregular, sorted x grid in [0, 10].

    sin(x) = 0.3 at asin(0.3) + 2 pi k and pi - asin(0.3) + 2 pi k: four
    planted crossings in range.
    """
    x = np.sort(rng.uniform(0.0, 10.0, 200))
    x[0], x[-1] = 0.0, 10.0
    level = 0.3
    base = math.asin(level)
    roots = sorted(
        r
        for k in range(3)
        for r in (base + 2 * math.pi * k, math.pi - base + 2 * math.pi * k)
        if 0.0 <= r <= 10.0
    )
    return InputSpec(
        (
            Column("x", "X", x),
            Column("y1", "Y", np.sin(x)),
            Column("y2", "Y", np.full_like(x, level)),
        ),
        {"curve1": "sin(x)", "curve2": level, "crossings_x": roots, "x_range": [0.0, 10.0]},
    )


def sine_level(rng: np.random.Generator) -> InputSpec:
    """A sine with seeded period and phase on a jittered grid, crossing a
    non-zero level (so rising and falling crossings are not symmetric)."""
    period = float(rng.uniform(3.0, 4.0))
    phase = float(rng.uniform(0.0, 0.5))
    level = 0.25
    x = np.sort(rng.uniform(0.0, 10.0, 400))
    x[0], x[-1] = 0.0, 10.0
    w = 2 * math.pi / period
    y = np.sin(w * x + phase)
    roots: list[float] = []
    a = math.asin(level)
    for k in range(-2, 8):
        for u in (a + 2 * math.pi * k, math.pi - a + 2 * math.pi * k):
            r = (u - phase) / w
            if 0.0 <= r <= 10.0:
                roots.append(r)
    roots.sort()
    return InputSpec(
        (Column("x", "X", x), Column("y", "Y", y)),
        {"period": period, "phase": phase, "level": level, "crossings_x": roots,
         "n_crossings": len(roots)},
    )


def line_xy_errors(rng: np.random.Generator) -> InputSpec:
    """A line with per-point X and Y errors (heteroscedastic).

    True points lie exactly on y = a + b x; each is displaced by noise drawn
    from its own sigma_x and sigma_y, which are recorded as the error columns
    (so a York fit sees the per-point weights).
    """
    slope, intercept = 1.7, -0.8
    n = 20
    xt = np.linspace(0.0, 10.0, n)
    sx = rng.uniform(0.05, 0.4, n)
    sy = rng.uniform(0.1, 0.8, n)
    x = xt + rng.normal(0.0, sx)
    y = intercept + slope * xt + rng.normal(0.0, sy)
    return InputSpec(
        (
            Column("x", "X", x),
            Column("y", "Y", y),
            Column("y_err", "Y-error", sy),
            Column("x_err", "X-error", sx),
        ),
        {"slope": slope, "intercept": intercept, "n": n, "error_model": "per-point sigma"},
    )


def gauss_noisy(rng: np.random.Generator) -> InputSpec:
    """One Gaussian (quantized's ``gaussian``: height, FWHM) on a baseline,
    plus seeded noise."""
    x0, fwhm, height, y0, sigma = 0.4, 1.6, 5.0, 0.3, 0.05
    x = np.linspace(-5.0, 5.0, 201)
    y = y0 + peakshapes.gaussian(x, x0, fwhm, height) + rng.normal(0.0, sigma, x.size)
    return InputSpec(
        (Column("x", "X", x), Column("y", "Y", y)),
        {"x0": x0, "fwhm": fwhm, "height": height, "y0": y0, "noise_sigma": sigma,
         "origin_w_equals_fwhm_over": math.sqrt(2 * math.log(2))},
    )


def known_area(rng: np.random.Generator) -> InputSpec:
    """y = 2 x on [0, 5]: the exact area is 25. The grid is irregular
    (seeded) so integration has to honour the x spacing."""
    x = np.sort(rng.uniform(0.0, 5.0, 150))
    x[0], x[-1] = 0.0, 5.0
    return InputSpec(
        (Column("x", "X", x), Column("y", "Y", 2.0 * x)),
        {"integrand": "2x", "x_range": [0.0, 5.0], "area": 25.0},
    )


def planted_peaks(rng: np.random.Generator) -> InputSpec:
    """Three Gaussians of different height and width on a noisy zero baseline."""
    centers = [2.0, 5.0, 7.5]
    fwhms = [0.5, 0.8, 0.4]
    heights = [10.0, 6.0, 8.0]
    sigma = 0.05
    x = np.linspace(0.0, 10.0, 501)
    y: NDArray[np.float64] = np.zeros_like(x)
    for c, w, h in zip(centers, fwhms, heights, strict=True):
        y = y + peakshapes.gaussian(x, c, w, h)
    y = y + rng.normal(0.0, sigma, x.size)
    return InputSpec(
        (Column("x", "X", x), Column("y", "Y", y)),
        {"centers": centers, "fwhm": fwhms, "heights": heights, "noise_sigma": sigma},
    )

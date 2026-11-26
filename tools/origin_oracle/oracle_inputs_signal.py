"""Seeded generators for the signal-processing and curve oracle cases.

Same contract as ``oracle_inputs``: a ``numpy.random.Generator`` in, an
``InputSpec`` out, deterministic given the generator. Planted truth is
computed independently of Origin and of quantized's implementation.
"""

from __future__ import annotations

import math

import numpy as np
from oracle_model import Column, InputSpec


def wrapped_phase(rng: np.random.Generator) -> InputSpec:
    """A smooth, increasing phase (several turns) wrapped into (-pi, pi]."""
    x = np.linspace(0.0, 20.0, 300)
    true = 0.35 * x + 0.02 * x**2 + rng.normal(0.0, 0.02, x.size)
    wrapped = np.angle(np.exp(1j * true))
    return InputSpec(
        (Column("x", "X", x), Column("phase", "Y", wrapped)),
        {"true_phase": true, "total_turns": float((true[-1] - true[0]) / (2 * math.pi))},
    )


def coherent_pair(rng: np.random.Generator) -> InputSpec:
    """Two records sharing one 10 Hz tone; only ``b`` also carries a 25 Hz tone.

    fs = 100 Hz. Coherence should be high at 10 Hz and low at 25 Hz.
    """
    fs, n = 100.0, 4096
    t = np.arange(n) / fs
    a = np.sin(2 * np.pi * 10.0 * t) + rng.normal(0.0, 0.7, n)
    b = (
        0.8 * np.sin(2 * np.pi * 10.0 * t + 0.6)
        + 0.6 * np.sin(2 * np.pi * 25.0 * t)
        + rng.normal(0.0, 0.7, n)
    )
    return InputSpec(
        (Column("t", "X", t), Column("a", "Y", a), Column("b", "Y", b)),
        {"fs": fs, "interval": 1.0 / fs, "shared_hz": 10.0, "b_only_hz": 25.0},
    )


def aliasing_tones(rng: np.random.Generator) -> InputSpec:
    """5 Hz signal plus a 300 Hz tone at fs = 1 kHz and a little noise.

    Decimating by 4 (new fs 250 Hz) aliases the 300 Hz tone onto 50 Hz unless
    it is filtered out first.
    """
    fs, n = 1000.0, 1200
    t = np.arange(n) / fs
    y = np.sin(2 * np.pi * 5.0 * t) + 0.4 * np.sin(2 * np.pi * 300.0 * t)
    y = y + rng.normal(0.0, 0.01, n)
    return InputSpec(
        (Column("t", "X", t), Column("y", "Y", y)),
        {"fs": fs, "factor": 4, "signal_hz": 5.0, "alias_source_hz": 300.0,
         "alias_lands_hz": 50.0},
    )


def modulated_carrier(rng: np.random.Generator) -> InputSpec:
    """(1 + 0.5 sin(2 pi 0.4 x)) sin(2 pi 5 x) on a uniform grid: the planted
    envelope is the modulation (carrier amplitude 1 at its extremes)."""
    x = np.linspace(0.0, 10.0, 1000)
    env = 1.0 + 0.5 * np.sin(2 * np.pi * 0.4 * x)
    y = env * np.sin(2 * np.pi * 5.0 * x) + rng.normal(0.0, 0.005, x.size)
    return InputSpec(
        (Column("x", "X", x), Column("y", "Y", y)),
        {"carrier_hz": 5.0, "modulation_hz": 0.4, "envelope": env},
    )


def noisy_with_spikes(rng: np.random.Generator) -> InputSpec:
    """A smooth curve with Gaussian noise and four one-point outliers, so a
    rank filter and a linear filter are told apart."""
    x = np.linspace(0.0, 12.0, 240)
    clean = np.sin(x) + 0.3 * np.sin(3 * x)
    y = clean + rng.normal(0.0, 0.25, x.size)
    spikes = [37, 90, 141, 200]
    y[spikes] += 3.0
    return InputSpec(
        (Column("x", "X", x), Column("y", "Y", y)),
        {"clean": clean, "spike_rows": spikes},
    )


def irregular_curve(rng: np.random.Generator) -> InputSpec:
    """A smooth curve sampled on 25 irregular x points, plus a separate column
    of 60 evenly spaced query x values inside the range."""
    x = np.sort(rng.uniform(0.0, 10.0, 25))
    x[0], x[-1] = 0.0, 10.0
    y = np.sin(0.7 * x) + 0.1 * x
    xq = np.linspace(0.3, 9.7, 60)
    return InputSpec(
        (Column("x", "X", x), Column("y", "Y", y), Column("xq", "X", xq)),
        {"function": "sin(0.7 x) + 0.1 x", "n_points": 25, "n_query": 60},
    )


def star_polygon(rng: np.random.Generator) -> InputSpec:
    """An irregular simple (non self-intersecting) polygon, vertices in
    counter-clockwise order, not closed. Area by the shoelace formula."""
    n = 14
    ang = np.sort(rng.uniform(0.0, 2 * np.pi, n))
    r = rng.uniform(2.0, 5.0, n)
    x, y = r * np.cos(ang), r * np.sin(ang)
    area = 0.5 * float(np.sum(x * np.roll(y, -1) - np.roll(x, -1) * y))
    return InputSpec(
        (Column("x", "X", x), Column("y", "Y", y)),
        {"n_vertices": n, "orientation": "counter-clockwise", "area": area},
    )


def shifted_pair(rng: np.random.Generator) -> InputSpec:
    """A pulse train and a copy delayed by 7 rows (unit spacing)."""
    n, lag = 128, 7
    a = rng.normal(0.0, 1.0, n)
    b = np.roll(a, lag) + rng.normal(0.0, 0.05, n)
    return InputSpec(
        (Column("a", "Y", a), Column("b", "Y", b)),
        {"lag_rows": lag, "interval": 1.0},
    )

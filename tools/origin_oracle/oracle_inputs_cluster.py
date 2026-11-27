"""Seeded generators for the clustering and wavelet oracle cases (wave 6).

Same contract as ``oracle_inputs``: a ``numpy.random.Generator`` in, an
``InputSpec`` out. Planted truth is computed without Origin or quantized.
"""

from __future__ import annotations

import numpy as np
from oracle_model import Column, InputSpec


def three_blobs(rng: np.random.Generator) -> InputSpec:
    """60 observations x 4 variables: three Gaussian blobs of 20, with the
    variables on very different scales (v3 is ~100x v1) so that standardising
    changes the answer. Columns v1..v4 are plain Y columns."""
    centres = np.array([[0.0, 0.0, 0.0, 0.0], [4.0, 3.0, 300.0, -2.0], [-3.0, 5.0, 150.0, 4.0]])
    sd = np.array([1.0, 1.0, 40.0, 1.5])
    truth = np.repeat(np.arange(3), 20)
    pts = centres[truth] + rng.normal(0.0, 1.0, (60, 4)) * sd
    order = rng.permutation(60)  # shuffled, so cluster ids are not row order
    pts, truth = pts[order], truth[order]
    return InputSpec(
        tuple(Column(f"v{i + 1}", "Y", pts[:, i]) for i in range(4)),
        {"n_obs": 60, "n_vars": 4, "k": 3, "planted_labels": truth,
         "planted_centres": centres, "planted_sd": sd},
    )


def blobs_with_initial_centres(rng: np.random.Generator) -> InputSpec:
    """The same data as ``three_blobs`` plus three initial centres appended
    as rows 1-3 of columns c1..c4 (a separate 4-column block)."""
    base = three_blobs(rng)
    init = np.array([[0.5, 0.5, 20.0, 0.0], [3.0, 2.0, 250.0, -1.0], [-2.0, 4.0, 100.0, 3.0]])
    cols = base.columns + tuple(Column(f"c{i + 1}", "Y", init[:, i]) for i in range(4))
    return InputSpec(cols, {**base.truth, "initial_centres": init})


def small_obs(rng: np.random.Generator) -> InputSpec:
    """12 observations x 3 variables, two loose groups, for hierarchical
    clustering where every merge height is worth recording."""
    a = rng.normal([0.0, 0.0, 0.0], [1.0, 1.0, 20.0], (6, 3))
    b = rng.normal([5.0, 4.0, 90.0], [1.0, 1.0, 20.0], (6, 3))
    pts = np.vstack([a, b])
    pts = pts[rng.permutation(12)]
    return InputSpec(
        tuple(Column(f"v{i + 1}", "Y", pts[:, i]) for i in range(3)),
        {"n_obs": 12, "n_vars": 3},
    )


def wavelet_signal(rng: np.random.Generator) -> InputSpec:
    """256 samples at dt = 1/256 on t in [0, 1): a 8 Hz tone, a 40 Hz burst in
    t 0.5-0.7 and white noise (sigma 0.2); plus 12 scales (1..12 doubling-ish)."""
    n = 256
    t = np.arange(n) / n
    burst = np.where((t >= 0.5) & (t < 0.7), np.sin(2 * np.pi * 40.0 * t), 0.0)
    clean = np.sin(2 * np.pi * 8.0 * t) + 0.8 * burst
    y = clean + rng.normal(0.0, 0.2, n)
    scales = np.array([2.0, 3.0, 4.0, 6.0, 8.0, 12.0, 16.0, 24.0, 32.0, 48.0, 64.0, 96.0])
    return InputSpec(
        (Column("t", "X", t), Column("y", "Y", y), Column("scale", "Y", scales)),
        {"n": n, "dt": 1.0 / n, "tone_hz": 8.0, "burst_hz": 40.0, "noise_sigma": 0.2,
         "clean": clean},
    )


def power_grid(rng: np.random.Generator) -> InputSpec:
    """The hypothetical sample sizes and powers fed to the power and sample
    size engines. The grid is fixed; column 3 (``unused``) is a seeded draw
    the engines never read, so each case's input still depends on its seed."""
    sizes = np.array([5.0, 8.0, 10.0, 15.0, 20.0, 30.0, 50.0, 100.0])
    powers = np.array([0.5, 0.8, 0.9, 0.95, 0.99])
    return InputSpec(
        (
            Column("size", "X", sizes),
            Column("power", "Y", powers),
            Column("unused", "Y", rng.uniform(0.0, 1.0, 3)),
        ),
        {"sizes": sizes, "powers": powers, "unused": "seeded filler, not read by the engines"},
    )


def two_groups_unequal(rng: np.random.Generator) -> InputSpec:
    """Two independent samples with unequal size and spread (12 at sd 1.0,
    9 at sd 2.4), so the pooled and Welch t-tests differ."""
    a = rng.normal(5.0, 1.0, 12)
    b = rng.normal(6.2, 2.4, 9)
    return InputSpec(
        (Column("a", "Y", a), Column("b", "Y", b)),
        {"n": [12, 9], "sd": [1.0, 2.4], "mean": [5.0, 6.2]},
    )


def variables_mixed(rng: np.random.Generator) -> InputSpec:
    """15 observations of 4 variables: v2 tracks v1, v3 is anti-correlated
    with v1, v4 is independent. Correlation and absolute-correlation distance
    then give different trees (v3 joins v1 only under |r|)."""
    base = rng.normal(0.0, 1.0, 15)
    v1 = base
    v2 = base + rng.normal(0.0, 0.5, 15)
    v3 = -base + rng.normal(0.0, 0.3, 15)
    v4 = rng.normal(0.0, 1.0, 15)
    return InputSpec(
        tuple(Column(f"v{i + 1}", "Y", v) for i, v in enumerate((v1, v2, v3, v4))),
        {"n_obs": 15, "design": "v2 = v1 + noise, v3 = -v1 + noise, v4 independent"},
    )

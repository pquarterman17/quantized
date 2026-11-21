"""``calc._snip.snip_clip`` is bit-identical to the original per-step-copy loop."""

from __future__ import annotations

import numpy as np
import pytest

import quantized.calc._snip as snip_mod
import quantized.calc.baseline as baseline
from quantized.calc._snip import snip_clip, snip_clip_reference
from quantized.calc.peaks import find_peaks_robust


def _same(a: np.ndarray, b: np.ndarray) -> None:
    # Byte equality: stricter than ==, distinguishes -0.0/0.0 and NaN payloads.
    assert a.shape == b.shape
    assert a.tobytes() == b.tobytes()


def _w_max(n: int) -> int:
    return max(1, (n - 1) // 2)


@pytest.mark.parametrize("n", [3, 4, 5, 7, 50, 257, 1000])
def test_random_all_window_sizes(n: int) -> None:
    rng = np.random.default_rng(n)
    v = np.sqrt(np.maximum(rng.normal(100, 20, n), 0.0))
    for w in {1, 2, max(1, n // 10), _w_max(n)}:
        if 2 * w < n:
            _same(snip_clip(v, w), snip_clip_reference(v, w))


def test_multiple_chunks(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(snip_mod, "_CHUNK", 7)  # force many chunk seams
    rng = np.random.default_rng(1)
    v = np.sqrt(rng.uniform(0, 400, 203))
    for w in (1, 6, 7, 8, 50, 101):
        _same(snip_clip(v, w), snip_clip_reference(v, w))


def test_flat_plateau_and_zeros() -> None:
    flat = np.full(64, 3.5)
    _same(snip_clip(flat, 20), snip_clip_reference(flat, 20))
    zeros = np.zeros(64)
    _same(snip_clip(zeros, 20), snip_clip_reference(zeros, 20))
    plat = np.concatenate([np.ones(20), np.full(20, 9.0), np.ones(24)])
    _same(snip_clip(plat, 25), snip_clip_reference(plat, 25))
    neg_zero = np.array([0.0, -0.0, 1.0, -0.0, 0.0, 2.0, 0.0])
    _same(snip_clip(neg_zero, 3), snip_clip_reference(neg_zero, 3))


def test_nan_and_inf_propagate_identically() -> None:
    rng = np.random.default_rng(3)
    v = rng.uniform(1, 5, 80)
    v[[0, 17, 40, 79]] = np.nan
    _same(snip_clip(v, 30), snip_clip_reference(v, 30))
    w = rng.uniform(1, 5, 80)
    w[[5, 30]] = np.inf
    _same(snip_clip(w, 30), snip_clip_reference(w, 30))
    allnan = np.full(9, np.nan)
    _same(snip_clip(allnan, 4), snip_clip_reference(allnan, 4))


def test_single_sample_and_no_window() -> None:
    one = np.array([4.0])
    _same(snip_clip(one, 0), snip_clip_reference(one, 0))
    v = np.array([1.0, 5.0, 2.0])
    _same(snip_clip(v, 0), snip_clip_reference(v, 0))
    _same(snip_clip(v, 1), snip_clip_reference(v, 1))


def test_input_not_mutated() -> None:
    v = np.sqrt(np.random.default_rng(0).uniform(0, 100, 40))
    before = v.copy()
    snip_clip(v, 10)
    _same(v, before)


def test_snip_background_and_detector_match_reference(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    rng = np.random.default_rng(9)
    n = 3000
    x = np.linspace(10, 90, n)
    y = 100 + 0.5 * x + 300 * np.exp(-0.5 * ((x - 50) / 0.3) ** 2) + rng.normal(0, 1, n)
    y[100] = np.nan
    fast = find_peaks_robust(x, y)
    fast_bg = baseline.estimate_background(x, y, iterative=True)
    monkeypatch.setattr(baseline, "snip_clip", snip_clip_reference)
    ref = find_peaks_robust(x, y)
    ref_bg = baseline.estimate_background(x, y, iterative=True)
    assert repr(fast[0]) == repr(ref[0])  # repr: peak dicts carry NaN fields
    _same(fast[1], ref[1])
    _same(fast_bg, ref_bg)

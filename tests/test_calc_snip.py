"""``calc._snip.snip_clip`` is bit-identical to the original per-step-copy loop."""

from __future__ import annotations

import sys

import numpy as np
import pytest

import quantized.calc._snip as snip_mod
import quantized.calc._snip_numba as snipnb
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


# --- compiled (numba) kernel -------------------------------------------------
# ``snip_clip`` only routes big problems to the kernel, so these tests call it
# through ``_compiled`` (threshold-free) and also drive ``snip_clip`` itself
# with the threshold lowered.


def _kernel() -> object:
    k = snipnb.get_kernel()
    if k is None:  # a platform without numba wheels: the fallback tests cover it
        pytest.skip("numba kernel unavailable")
    return k


def _compiled(v: np.ndarray, w: int) -> np.ndarray:
    k = _kernel()
    a = np.array(v, dtype=np.float64)
    return k(a, np.empty_like(a), w)  # type: ignore[operator, no-any-return]


def _canon_nan(x: np.ndarray) -> np.ndarray:
    """Collapse every NaN to one bit pattern (sign/payload of a NaN is not a value)."""
    y = np.array(x)
    y[np.isnan(y)] = np.nan
    return y


@pytest.mark.parametrize("n", [3, 4, 5, 7, 50, 257, 1000])
def test_compiled_random_all_window_sizes(n: int) -> None:
    rng = np.random.default_rng(n)
    v = np.sqrt(np.maximum(rng.normal(100, 20, n), 0.0))
    for w in {1, 2, max(1, n // 10), _w_max(n)}:  # includes the w_max edge
        if 2 * w < n:
            _same(_compiled(v, w), snip_clip_reference(v, w))


def test_compiled_chunk_seams() -> None:
    # The numpy path chunks at _CHUNK; sizes straddling that seam must agree.
    rng = np.random.default_rng(11)
    for n in (snip_mod._CHUNK - 1, snip_mod._CHUNK, snip_mod._CHUNK + 1, 2 * snip_mod._CHUNK + 3):
        v = np.sqrt(rng.uniform(0, 400, n))
        _same(_compiled(v, 5), snip_clip_reference(v, 5))
    small = np.sqrt(rng.uniform(0, 400, 203))
    for w in (1, 6, 7, 8, 50, 101):
        _same(_compiled(small, w), snip_clip_reference(small, w))


def test_compiled_flat_plateau_zeros_signed_zero() -> None:
    for v, w in (
        (np.full(64, 3.5), 20),
        (np.zeros(64), 20),
        (np.concatenate([np.ones(20), np.full(20, 9.0), np.ones(24)]), 25),
        (np.array([0.0, -0.0, 1.0, -0.0, 0.0, 2.0, 0.0]), 3),
    ):
        _same(_compiled(v, w), snip_clip_reference(v, w))
    rng = np.random.default_rng(5)  # +-0 fuzz: np.minimum tie-breaking
    for n in (5, 9, 64, 301):
        v = rng.choice([0.0, -0.0, 1.0], size=n)
        for w in {1, 2, max(1, n // 7), _w_max(n)}:
            if 2 * w < n:
                _same(_compiled(v, w), snip_clip_reference(v, w))


def test_compiled_nan_and_inf_identical() -> None:
    rng = np.random.default_rng(3)
    v = rng.uniform(1, 5, 80)
    v[[0, 17, 40, 79]] = np.nan
    _same(_compiled(v, 30), snip_clip_reference(v, 30))
    w = rng.uniform(1, 5, 80)
    w[[5, 30]] = np.inf
    _same(_compiled(w, 30), snip_clip_reference(w, 30))
    ninf = rng.uniform(1, 5, 80)
    ninf[[7, 50]] = -np.inf
    _same(_compiled(ninf, 30), snip_clip_reference(ninf, 30))
    _same(_compiled(np.full(9, np.nan), 4), snip_clip_reference(np.full(9, np.nan), 4))


def test_compiled_mixed_special_values_fuzz() -> None:
    # Everything at once. Byte-exact except the sign bit of a NaN produced when
    # two NaNs of opposite sign meet in one add (needs +inf and -inf together):
    # numpy itself picks either operand there depending on SIMD lane, so no
    # scalar loop can match it. Every non-NaN value is still byte-exact and
    # every NaN is still a NaN in the same place.
    rng = np.random.default_rng(0)
    pool = [0.0, -0.0, 1.0, 2.5, np.nan, np.inf, -np.inf]
    with np.errstate(invalid="ignore"):
        for _ in range(300):
            n = int(rng.integers(3, 70))
            v = rng.choice(pool, size=n)
            w = int(rng.integers(1, _w_max(n) + 1))
            if 2 * w < n:
                _same(_canon_nan(_compiled(v, w)), _canon_nan(snip_clip_reference(v, w)))
        # without -inf there is no negative NaN, so it is fully byte-exact
        pool = [0.0, -0.0, 1.0, 2.5, np.nan, np.inf]
        for _ in range(300):
            n = int(rng.integers(3, 70))
            v = rng.choice(pool, size=n)
            w = int(rng.integers(1, _w_max(n) + 1))
            if 2 * w < n:
                _same(_compiled(v, w), snip_clip_reference(v, w))


def test_compiled_input_not_mutated_and_dispatch(monkeypatch: pytest.MonkeyPatch) -> None:
    _kernel()
    v = np.sqrt(np.random.default_rng(0).uniform(0, 100, 400))
    before = v.copy()
    monkeypatch.setattr(snip_mod, "_COMPILED_MIN_WORK", 1)
    monkeypatch.setattr(snip_mod, "_WARM_MIN_WORK", 1)
    calls: list[int] = []
    real = snipnb.get_kernel

    def spy() -> object:
        calls.append(1)
        return real()

    monkeypatch.setattr(snip_mod, "get_kernel", spy)
    out = snip_clip(v, 100)
    assert calls  # the compiled path was taken
    _same(out, snip_clip_reference(v, 100))
    _same(v, before)


def test_small_problems_never_touch_numba(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom() -> object:
        raise AssertionError("numba kernel must not load below the work threshold")

    monkeypatch.setattr(snip_mod, "get_kernel", boom)
    monkeypatch.setattr(snip_mod, "peek_kernel", boom)
    v = np.sqrt(np.random.default_rng(2).uniform(0, 100, 300))
    _same(snip_clip(v, 20), snip_clip_reference(v, 20))


def test_find_peaks_robust_identical_with_compiled_kernel(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _kernel()
    rng = np.random.default_rng(21)
    n = 4000
    x = np.linspace(10, 90, n)
    y = 100 + 0.5 * x + 300 * np.exp(-0.5 * ((x - 50) / 0.3) ** 2) + rng.normal(0, 1, n)
    y[100] = np.nan
    calls: list[int] = []
    real = snipnb.get_kernel
    monkeypatch.setattr(snip_mod, "get_kernel", lambda: (calls.append(1), real())[1])
    monkeypatch.setattr(snip_mod, "_COMPILED_MIN_WORK", 1)  # force the kernel
    monkeypatch.setattr(snip_mod, "_WARM_MIN_WORK", 1)
    fast = find_peaks_robust(x, y)
    fast_bg = baseline.estimate_background(x, y, iterative=True)
    assert calls
    monkeypatch.setattr(baseline, "snip_clip", snip_clip_reference)
    ref = find_peaks_robust(x, y)
    ref_bg = baseline.estimate_background(x, y, iterative=True)
    assert repr(fast[0]) == repr(ref[0])
    _same(fast[1], ref[1])
    _same(fast_bg, ref_bg)


# --- fallback ----------------------------------------------------------------


def test_fallback_when_numba_import_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    import builtins

    real_import = builtins.__import__

    def no_numba(name: str, *args: object, **kw: object) -> object:
        if name == "numba" or name.startswith("numba."):
            raise ModuleNotFoundError("No module named 'numba'", name="numba")
        return real_import(name, *args, **kw)  # type: ignore[arg-type]

    snipnb.reset_for_tests()
    try:
        monkeypatch.setattr(builtins, "__import__", no_numba)
        monkeypatch.setitem(sys.modules, "numba", None)  # also defeats the fast path
        assert snipnb.get_kernel() is None
        monkeypatch.setattr(snip_mod, "_COMPILED_MIN_WORK", 1)
        monkeypatch.setattr(snip_mod, "_WARM_MIN_WORK", 1)
        v = np.sqrt(np.random.default_rng(4).uniform(0, 100, 500))
        _same(snip_clip(v, 40), snip_clip_reference(v, 40))
        n = 3000
        x = np.linspace(10, 90, n)
        y = 100 + 300 * np.exp(-0.5 * ((x - 50) / 0.3) ** 2)
        fb = find_peaks_robust(x, y)
        monkeypatch.setattr(baseline, "snip_clip", snip_clip_reference)
        assert repr(fb[0]) == repr(find_peaks_robust(x, y)[0])
    finally:
        monkeypatch.undo()
        snipnb.reset_for_tests()


def test_fallback_env_switch(monkeypatch: pytest.MonkeyPatch) -> None:
    snipnb.reset_for_tests()
    try:
        monkeypatch.setenv("QZ_NO_NUMBA", "1")
        assert snipnb.get_kernel() is None
        monkeypatch.setattr(snip_mod, "_COMPILED_MIN_WORK", 1)
        monkeypatch.setattr(snip_mod, "_WARM_MIN_WORK", 1)
        v = np.sqrt(np.random.default_rng(6).uniform(0, 100, 300))
        _same(snip_clip(v, 30), snip_clip_reference(v, 30))
    finally:
        monkeypatch.undo()
        snipnb.reset_for_tests()


def test_fallback_when_jit_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    """A kernel that cannot compile (e.g. no cache dir AND no JIT) degrades to numpy."""
    numba = pytest.importorskip("numba")

    def broken(*a: object, **k: object) -> object:
        raise RuntimeError("jit unavailable")

    snipnb.reset_for_tests()
    try:
        monkeypatch.setattr(numba, "njit", broken)
        assert snipnb.get_kernel() is None
    finally:
        monkeypatch.undo()
        snipnb.reset_for_tests()


def test_cold_vs_warm_dispatch(monkeypatch: pytest.MonkeyPatch) -> None:
    """Between the thresholds the kernel is used only if already loaded."""
    seen: list[str] = []

    def fake_get() -> object:
        seen.append("get")
        return None

    def fake_peek() -> object:
        seen.append("peek")
        return None

    monkeypatch.setattr(snip_mod, "get_kernel", fake_get)
    monkeypatch.setattr(snip_mod, "peek_kernel", fake_peek)
    monkeypatch.setattr(snip_mod, "_WARM_MIN_WORK", 100)
    monkeypatch.setattr(snip_mod, "_COMPILED_MIN_WORK", 10_000)
    v = np.sqrt(np.random.default_rng(8).uniform(0, 100, 400))
    snip_clip(v, 10)  # 4,000: below warm .. cold -> peek only
    snip_clip(v, 100)  # 40,000: at/above cold -> get (may load)
    snip_clip(v[:20], 2)  # 40 < warm -> neither
    assert seen == ["peek", "get"]

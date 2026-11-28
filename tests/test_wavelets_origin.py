"""OriginPro's discrete-wavelet conventions (``calc.wavelet_origin``): periodic
extension, custom percentage threshold, smooth cutoff; and the CWT scale and
normalisation convention pinned by a hand computation. Corpus-free (the frozen
OriginPro answers are in ``test_wavelets_oracle.py``)."""

from __future__ import annotations

import numpy as np
import pytest

pywt = pytest.importorskip("pywt")

from quantized.calc import wavelet_origin as wo  # noqa: E402
from quantized.calc import wavelets as wv  # noqa: E402
from quantized.calc.signal_ops import run_signal_op  # noqa: E402
from quantized.datastruct import DataStruct  # noqa: E402

RNG = np.random.default_rng(16)
ORIGIN = wo.ORIGIN_PERIODIC


def _ds(y: np.ndarray) -> DataStruct:
    x = np.arange(y.size, dtype=float) * 0.01
    return DataStruct.create(
        x,
        y[:, None],
        labels=["y"],
        units=["V"],
        metadata={"xUnit": "s", "x_column_name": "Time", "x_column_unit": "s"},
    )


@pytest.mark.parametrize("wavelet", ["haar", "db2", "db4", "sym4", "coif2", "bior2.2"])
def test_origin_periodic_reconstructs_to_rounding(wavelet: str) -> None:
    y = RNG.normal(size=256)
    top = wv._origin_top_level(256, wavelet)
    for level in (1, 3, top):
        coeffs = wo.origin_wavedec(pywt, y, wavelet, level)
        np.testing.assert_allclose(wo.origin_waverec(pywt, coeffs, wavelet), y, rtol=0, atol=1e-10)


@pytest.mark.parametrize(("wavelet", "roll"), [("haar", 0), ("db2", 1), ("db4", 3), ("sym4", 3)])
def test_origin_periodic_is_a_rolled_periodization_at_level_one(wavelet: str, roll: int) -> None:
    y = RNG.normal(size=64)
    a, d = wo.origin_wavedec(pywt, y, wavelet, 1)
    pa, pd = pywt.dwt(np.roll(y, roll), wavelet, mode="periodization")
    np.testing.assert_allclose(a, pa, atol=1e-12)
    np.testing.assert_allclose(d, pd, atol=1e-12)


def test_origin_periodic_is_not_wavedec_periodization_beyond_level_one() -> None:
    y = RNG.normal(size=64)
    ours = wo.origin_wavedec(pywt, y, "db4", 2)
    theirs = pywt.wavedec(y, "db4", mode="periodization", level=2)
    assert not np.allclose(ours[1], theirs[1])  # level 2 detail differs: the roll repeats


def test_origin_periodic_refuses_a_length_it_cannot_take() -> None:
    with pytest.raises(ValueError, match="level must be 1 to 2"):
        wv.wavedec(RNG.normal(size=100), "db4", 3, ORIGIN)
    with pytest.raises(ValueError, match="level must be 1 to 4"):
        wv.wavedec(RNG.normal(size=64), "db4", 6, ORIGIN)


def test_default_level_and_signal_op_path() -> None:
    y = RNG.normal(size=256)
    out = run_signal_op(
        _ds(y),
        "wavelet-reconstruct",
        [0],
        {"wavelet": "db4", "level": 6, "mode": ORIGIN, "keep": "A,6,5,4,3,2,1"},
    )
    np.testing.assert_allclose(out.data.values[:, 0], y, atol=1e-10)


def test_percent_threshold_is_hard_global_and_hand_checkable() -> None:
    y = RNG.normal(size=128) + np.sin(np.arange(128) / 5)
    coeffs, _ = wv.wavedec(y, "db4", 4, ORIGIN)
    t = 0.3 * max(np.abs(d).max() for d in coeffs[1:])
    expect = [coeffs[0]] + [np.where(np.abs(d) > t, d, 0.0) for d in coeffs[1:]]
    rec, info = wv.denoise(y, "db4", 4, ORIGIN, rule="percent", threshold_mode="hard", percent=30)
    np.testing.assert_allclose(rec, wo.origin_waverec(pywt, expect, "db4"), atol=1e-12)
    np.testing.assert_allclose(list(info["threshold"].values()), t)
    # 0 percent keeps everything that is non-zero: a round trip to 1e-12
    rt, _ = wv.denoise(y, "db4", 4, ORIGIN, rule="percent", threshold_mode="hard", percent=0)
    np.testing.assert_allclose(rt, y, atol=1e-12)
    with pytest.raises(ValueError, match="hard"):
        wv.denoise(y, "db4", 4, ORIGIN, rule="percent", threshold_mode="soft", percent=30)
    with pytest.raises(ValueError, match="0 to 100"):
        wv.denoise(y, "db4", 4, ORIGIN, rule="percent", threshold_mode="hard", percent=101)


def test_smooth_cutoff_zeroes_finest_levels_from_the_last_index() -> None:
    y = RNG.normal(size=64)
    coeffs, _ = wv.wavedec(y, "haar", 3, ORIGIN)  # details 32, 16, 8 = 56
    rec, lev, zeroed = wv.smooth_cutoff(y, "haar", 3, ORIGIN, 50)
    assert (lev, zeroed) == (3, 28)
    expect = [coeffs[0], coeffs[1].copy(), coeffs[2].copy(), coeffs[3].copy()]
    expect[3][4:] = 0.0  # cD1: 28 of 32 zeroed from the end
    np.testing.assert_allclose(rec, wo.origin_waverec(pywt, expect, "haar"), atol=1e-12)
    np.testing.assert_allclose(wv.smooth_cutoff(y, "haar", 3, ORIGIN, 0)[0], y, atol=1e-12)
    top = wv.smooth_cutoff(y, "haar", 3, ORIGIN, 100)[0]
    np.testing.assert_allclose(
        top,
        wo.origin_waverec(pywt, [coeffs[0], *[np.zeros_like(c) for c in coeffs[1:]]], "haar"),
        atol=1e-12,
    )


def test_signal_op_cutoff_and_percent_entries() -> None:
    y = RNG.normal(size=128)
    sm = run_signal_op(
        _ds(y), "wavelet-smooth", [0], {"wavelet": "db4", "level": 4, "mode": ORIGIN, "cutoff": 40}
    )
    ref = wv.smooth_cutoff(y, "db4", 4, ORIGIN, 40)[0]
    np.testing.assert_allclose(sm.data.values[:, 0], ref, atol=1e-12)
    assert sm.data.metadata["wavelet"]["kind"] == "smooth-cutoff"
    dn = run_signal_op(
        _ds(y),
        "wavelet-denoise",
        [0],
        {
            "wavelet": "db4",
            "level": 4,
            "mode": ORIGIN,
            "rule": "percent",
            "percent": 25,
            "threshold": "hard",
        },
    )
    ref = wv.denoise(y, "db4", 4, ORIGIN, rule="percent", threshold_mode="hard", percent=25)[0]
    np.testing.assert_allclose(dn.data.values[:, 0], ref, atol=1e-12)
    with pytest.raises(ValueError, match="hard"):
        run_signal_op(
            _ds(y),
            "wavelet-denoise",
            [0],
            {"wavelet": "db4", "level": 4, "rule": "percent", "percent": 25},
        )


# --- CWT scale and normalisation -------------------------------------------


def _mexh(x: np.ndarray) -> np.ndarray:
    return 2 / (np.sqrt(3) * np.pi**0.25) * (1 - x**2) * np.exp(-(x**2) / 2)


def test_cwt_normalisation_is_l2_by_hand() -> None:
    """``W[s, n] = s**-0.5 * sum_k y[k] psi((k - n + 0.5) / s)``: the wavelet
    dilated by scale ``s`` (in SAMPLES) and divided by ``sqrt(s)``, zero beyond
    the record, sampled half a sample off the grid. A unit-L1 form (``1/s``)
    would differ by a factor ``sqrt(s)`` = 2.8 at s=8."""
    n = 256
    k = np.arange(n)
    y = np.sin(2 * np.pi * k / 40) + 0.3 * np.cos(2 * np.pi * k / 13)
    s = 8.0
    direct = np.array([np.sum(y * _mexh((k - m + 0.5) / s)) for m in k]) / np.sqrt(s)
    mag, freqs, fc = wv.cwt_scalogram(y, 0.01, "mexh", np.array([s]))
    peak = np.abs(direct).max()
    np.testing.assert_allclose(mag[0], np.abs(direct), rtol=0, atol=0.005 * peak)
    assert np.abs(mag[0]).max() / peak == pytest.approx(1.0, abs=0.005)
    assert abs(mag[0].max() * np.sqrt(s) / peak - 1) > 1.0  # an L1 reading is far off
    assert freqs[0] == pytest.approx(fc / (s * 0.01))  # pseudo-frequency: centre / (scale * dt)

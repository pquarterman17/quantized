"""Align to peak: a sloped baseline's window edge is not a peak."""

import numpy as np
import pytest

from quantized.calc.peak_align import align_spectra

X = np.linspace(0, 80, 321)


def _spec(seed, peaks, slope=0.02):
    rng = np.random.default_rng(seed)
    y = slope * X + rng.normal(0, 0.03, X.size)
    for c, h in peaks:
        y += h * np.exp(-0.5 * ((X - c) / 1.5) ** 2)
    return y


def _four():
    ys = [
        _spec(1, [(30, 3), (60, 2)]),
        _spec(2, [(30.4, 3), (60.5, 2)]),
        _spec(3, [(29.7, 3), (59.8, 2)]),
        _spec(4, [(30, 3)]),
    ]
    return [X] * 4, ys


def test_sloped_edge_is_refused_with_reason():
    xs, ys = _four()
    r = align_spectra(xs, ys, 55, 67)
    assert r["ok"] == [True, True, True, False]
    assert np.isnan(r["shifts"][3])
    assert "window edge" in r["errors"][3] or "no clear peak" in r["errors"][3]


def test_genuine_peak_on_slope_still_aligned():
    xs, ys = _four()
    r = align_spectra(xs, ys, 55, 67)
    assert r["positions"][1] - r["positions"][0] == pytest.approx(0.5, abs=0.15)
    assert r["shifts"][2] == pytest.approx(r["positions"][0] - 59.8, abs=0.15)


def test_steep_slope_genuine_peak_accepted():
    ys = [_spec(5, [(60, 4)], slope=0.2), _spec(6, [(60.6, 4)], slope=0.2)]
    r = align_spectra([X, X], ys, 55, 67)
    assert r["ok"] == [True, True]
    assert r["shifts"][1] == pytest.approx(-0.6, abs=0.15)


def test_maximum_near_edge_refused_even_if_tall():
    y = np.exp(-0.5 * ((X - 66.5) / 1.5) ** 2) * 5
    r = align_spectra([X, X], [_spec(7, [(60, 2)]), y], 55, 67)
    assert r["ok"] == [True, False]


def test_follow_keeps_rules():
    xs, ys = _four()
    r = align_spectra(xs, ys, 55, 67, follow=True)
    assert r["ok"][:3] == [True, True, True]
    assert r["ok"][3] is False

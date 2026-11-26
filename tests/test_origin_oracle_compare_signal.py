"""quantized's Signal Processing extras against OriginPro's own answers.

Each test runs ``quantized.calc.signal_extras`` on the SAME seeded input the
oracle harness fed Origin (``../test-data/origin/analysis_oracle/<case>/``) and
compares with the answer Origin froze. Skips without the local corpus.

Measured on OriginPro 2026b (10.35); numbers in the docstrings are those runs.
A ``strict`` xfail is a real disagreement, reported rather than loosened away.
"""

from __future__ import annotations

import numpy as np
import pytest

from _origin_oracle_fixture import load_fixture
from quantized.calc import signal_extras as se

pytestmark = pytest.mark.realdata

Vec = np.ndarray


def _finite(v: Vec) -> Vec:
    return v[np.isfinite(v)]


def test_unwrap_phase_matches_origin_exactly() -> None:
    """Both remove a 2 pi jump whenever consecutive samples differ by more than
    pi, so the results are identical (measured: 0.0)."""
    fx = load_fixture("unwrap_phase")
    got = se.unwrap_phase(fx.input_columns()["phase"], "radians")
    np.testing.assert_allclose(got, fx.outputs()[0], rtol=0, atol=1e-12)
    # and both recover the planted phase (it has several turns)
    np.testing.assert_allclose(got, fx.planted["true_phase"], atol=1e-9)


def _cohere(detrend: str | bool) -> tuple[Vec, Vec, Vec, Vec]:
    fx = load_fixture("cohere")
    cols = fx.input_columns()
    f, c, _ = se.coherence_welch(
        cols["a"], cols["b"], 100.0, "hanning", 256, 0.5, detrend=detrend  # type: ignore[arg-type]
    )
    return f, c, _finite(fx.outputs()[0]), _finite(fx.outputs()[1])


def test_coherence_without_detrend_matches_origin_to_a_window_definition() -> None:
    """Welch coherence, Hann, 256-row segments, 50 % overlap, no detrend.
    The frequency axis is identical. Coherence differs by at most 0.0107
    because scipy's Hann is the periodic form and Origin's is the symmetric
    form; with scipy's symmetric Hann the two agree to 5e-16."""
    f, c, of, oc = _cohere(False)
    np.testing.assert_allclose(f, of, rtol=0, atol=1e-12)
    assert np.max(np.abs(c - oc)) < 0.015


def test_coherence_default_detrend_differs_only_in_the_two_lowest_bins() -> None:
    """quantized removes each segment's mean by default and Origin does not.
    That changes only the DC bin (0.124) and the next one (0.042); from the
    third bin up the difference is the same Hann effect as above (0.0107)."""
    _, c, _, oc = _cohere("constant")
    d = np.abs(c - oc)
    assert d[0] < 0.15 and d[1] < 0.06
    assert np.max(d[2:]) < 0.015


def test_coherence_finds_the_shared_tone_and_not_the_other() -> None:
    f, c, of, oc = _cohere("constant")
    for freq, arr in ((f, c), (of, oc)):
        assert arr[np.argmin(np.abs(freq - 10.0))] > 0.9  # shared 10 Hz tone
        assert arr[np.argmin(np.abs(freq - 25.0))] < 0.3  # tone only in b


def _tone(v: Vec, fs: float, hz: float) -> float:
    spec = np.abs(np.fft.rfft(v - v.mean())) * 2.0 / v.size
    return float(spec[np.argmin(np.abs(np.fft.rfftfreq(v.size, 1.0 / fs) - hz))])


def test_decimate_row_count_and_axis_agree() -> None:
    fx = load_fixture("decimate_fir")
    cols = fx.input_columns()
    out = fx.outputs()
    got = se.decimate_antialias(cols["y"], 4, "fir")
    assert _finite(out[1]).size == got.size == 300
    np.testing.assert_allclose(_finite(out[0]), cols["t"][::4], atol=1e-12)


@pytest.mark.xfail(
    strict=True,
    reason=(
        "Origin's FIR decimate (order 32) is not a usable anti-alias filter on this input: "
        "max |quantized - Origin| = 0.775 over 300 rows, against 0.386 for plain "
        "row-keeping. Origin keeps the aliased 300 Hz tone at 0.519 amplitude (input 0.4) "
        "and cuts the 5 Hz signal to 0.868 (quantized: 5e-4 and 1.0)."
    ),
)
def test_decimate_fir_matches_origin_fir() -> None:
    """Compares quantized's FIR decimation (``scipy.signal.decimate``, Hamming
    FIR of order 20*q) with Origin's ``filter:=fir order:=32``."""
    fx = load_fixture("decimate_fir")
    got = se.decimate_antialias(fx.input_columns()["y"], 4, "fir")
    np.testing.assert_allclose(got, _finite(fx.outputs()[1]), rtol=0, atol=0.05)


def test_decimate_fir_removes_the_alias_that_origin_keeps() -> None:
    """The planted 300 Hz tone must not land on 50 Hz after decimating by 4.
    quantized removes it; the frozen Origin FIR output still carries it."""
    fx = load_fixture("decimate_fir")
    fs = fx.planted["fs"] / fx.planted["factor"]
    mine = se.decimate_antialias(fx.input_columns()["y"], 4, "fir")
    assert _tone(mine, fs, fx.planted["alias_lands_hz"]) < 0.01
    assert _tone(mine, fs, fx.planted["signal_hz"]) > 0.95
    assert _tone(_finite(fx.outputs()[1]), fs, fx.planted["alias_lands_hz"]) > 0.1


def _envelopes() -> tuple[Vec, Vec, Vec, Vec, Vec]:
    fx = load_fixture("envelope")
    cols = fx.input_columns()
    out = fx.outputs()
    up = se.extrema_envelope(cols["x"], cols["y"], "upper", "spline", 1)
    lo = se.extrema_envelope(cols["x"], cols["y"], "lower", "spline", 1)
    return up, lo, out[1], out[3], np.array(fx.planted["envelope"])


def test_envelope_agrees_with_origin_away_from_the_ends() -> None:
    """Both run a cubic spline through the local extrema. Over rows 100-899
    of 1000 they agree (before the end-handling fix: within 0.0012); the ends
    are the next test."""
    up, lo, oup, olo, _ = _envelopes()
    np.testing.assert_allclose(up[100:-100], oup[100:-100], rtol=0, atol=3e-3)
    np.testing.assert_allclose(lo[100:-100], olo[100:-100], rtol=0, atol=3e-3)


def test_envelope_agrees_with_origin_over_every_row() -> None:
    """Both fit a natural cubic spline through the extrema alone and extrapolate
    past the outer ones. Before the fix quantized pinned both end rows as knots
    (here y = 0.001 and 0.004, a carrier zero crossing), so the envelope
    collapsed toward 0 there: max |quantized - Origin| was 1.001 upper (row 0)
    and 1.034 lower. Now it agrees at floating-point level; 1e-9 is slack."""
    up, lo, oup, olo, _ = _envelopes()
    np.testing.assert_allclose(up, oup, rtol=0, atol=1e-9)
    np.testing.assert_allclose(lo, olo, rtol=0, atol=1e-9)


def test_origin_envelope_follows_the_planted_modulation() -> None:
    """Guards the fixture: Origin's envelope is within 0.034 of the planted one."""
    _, _, oup, olo, env = _envelopes()
    assert np.max(np.abs(oup - env)) < 0.04
    assert np.max(np.abs(olo + env)) < 0.04


def test_percentile_smoothing_matches_origin_on_every_row() -> None:
    """Rank filter, 9 rows, 30th percentile, edge value repeated: identical
    to Origin's ``smooth method:=pf`` (measured max difference 0.0)."""
    fx = load_fixture("smooth_rank_binomial")
    got = se.percentile_smooth(fx.input_columns()["y"], 9, 30.0)
    np.testing.assert_allclose(got, fx.outputs()[0], rtol=0, atol=1e-12)


def test_binomial_smoothing_matches_origin_except_at_the_edges() -> None:
    """A 9-row binomial window (Origin: ``order:=4``; its ``npts`` is ignored
    for this method). Interior rows are identical (2e-16). Origin applies the
    [1 2 1]/4 pass four times with the edge value repeated on each pass,
    quantized pads once and convolves with the 9-tap kernel, so the 4 edge rows
    on each side differ (measured max 0.0236, last row)."""
    fx = load_fixture("smooth_rank_binomial")
    got = se.binomial_smooth(fx.input_columns()["y"], 9)
    ref = fx.outputs()[1]
    np.testing.assert_allclose(got[4:-4], ref[4:-4], rtol=0, atol=1e-12)
    assert np.max(np.abs(got - ref)) < 0.03

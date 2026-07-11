"""calc.backgrounds (GOTO #2/#3/#7): anchor baseline, Shirley, XRD low-angle,
beam footprint. New features beyond MATLAB parity — no goldens; reference-value
and invariant tests, plus the corrections-pipeline integration (#2/#7b ride
apply_corrections as new params).
"""

from __future__ import annotations

import math

import numpy as np
import pytest
from numpy.testing import assert_allclose

from quantized.calc.backgrounds import (
    anchor_baseline,
    footprint_correction,
    footprint_factor,
    shirley_background,
    xrd_low_angle_background,
)
from quantized.calc.corrections import apply_corrections
from quantized.datastruct import DataStruct

# ── anchor_baseline (#2) ────────────────────────────────────────────────────

X = np.linspace(0.0, 10.0, 101)  # grid contains every integer anchor x
Y = np.sin(X) + 5.0
ANCHORS = [[1.0, 2.0], [4.0, 3.5], [7.0, 1.0], [9.0, 2.5]]


@pytest.mark.parametrize("method", ["linear", "pchip", "spline"])
def test_anchor_baseline_passes_exactly_through_anchors(method: str) -> None:
    base = anchor_baseline(X, Y, ANCHORS, method=method)
    for ax, ay in ANCHORS:
        i = int(np.argmin(np.abs(X - ax)))
        assert X[i] == pytest.approx(ax)  # the grid really contains the anchor x
        assert base[i] == pytest.approx(ay, abs=1e-12)


@pytest.mark.parametrize("method", ["linear", "pchip", "spline"])
def test_anchor_baseline_clamps_extrapolation_to_end_anchors(method: str) -> None:
    base = anchor_baseline(X, Y, ANCHORS, method=method)
    assert_allclose(base[X < 1.0], 2.0)  # left of the first anchor
    assert_allclose(base[X > 9.0], 2.5)  # right of the last anchor


def test_anchor_baseline_linear_midpoint() -> None:
    base = anchor_baseline(X, Y, [[2.0, 1.0], [4.0, 3.0]], method="linear")
    i = int(np.argmin(np.abs(X - 3.0)))
    assert base[i] == pytest.approx(2.0, abs=1e-12)


def test_anchor_baseline_sorts_unordered_anchors() -> None:
    shuffled = [ANCHORS[2], ANCHORS[0], ANCHORS[3], ANCHORS[1]]
    assert_allclose(
        anchor_baseline(X, Y, shuffled, method="pchip"),
        anchor_baseline(X, Y, ANCHORS, method="pchip"),
    )


def test_anchor_baseline_two_anchor_spline_degrades_to_linear() -> None:
    two = [[1.0, 2.0], [9.0, 4.0]]
    assert_allclose(
        anchor_baseline(X, Y, two, method="spline"),
        anchor_baseline(X, Y, two, method="linear"),
        atol=1e-12,
    )


def test_anchor_baseline_rejects_duplicate_anchor_x() -> None:
    with pytest.raises(ValueError, match="strictly monotone"):
        anchor_baseline(X, Y, [[1.0, 2.0], [1.0, 3.0], [5.0, 1.0]])


def test_anchor_baseline_rejects_too_few_and_nonfinite() -> None:
    with pytest.raises(ValueError, match="at least 2"):
        anchor_baseline(X, Y, [[1.0, 2.0]])
    with pytest.raises(ValueError, match="finite"):
        anchor_baseline(X, Y, [[1.0, np.nan], [5.0, 1.0]])
    with pytest.raises(ValueError, match="method"):
        anchor_baseline(X, Y, ANCHORS, method="nope")
    with pytest.raises(ValueError, match="same length"):
        anchor_baseline(X, Y[:-1], ANCHORS)


def test_anchor_baseline_pchip_no_overshoot_between_anchors() -> None:
    # Shape preservation: between two anchors at the same height, pchip stays
    # within the anchor y-range (a cubic spline may overshoot).
    anchors = [[0.0, 1.0], [3.0, 1.0], [5.0, 4.0], [10.0, 1.0]]
    base = anchor_baseline(X, Y, anchors, method="pchip")
    seg = base[(X >= 0.0) & (X <= 3.0)]
    assert float(np.max(np.abs(seg - 1.0))) < 1e-9


# ── shirley_background (#3) ────────────────────────────────────────────────


def _step_spectrum() -> tuple[np.ndarray, np.ndarray]:
    """Gaussian peak on a step: level 1.0 left of the peak, 0.0 right of it —
    the canonical XPS shape a Shirley background models."""
    x = np.linspace(0.0, 10.0, 401)
    peak = 5.0 * np.exp(-((x - 5.0) ** 2) / (2 * 0.4**2))
    step = 0.5 * (1.0 + np.tanh((5.0 - x) / 0.4))
    return x, peak + step


def test_shirley_converges_on_step_spectrum() -> None:
    x, y = _step_spectrum()
    bg, info = shirley_background(x, y)
    assert info["converged"] is True
    assert 1 <= info["nIter"] <= 50
    # Pinned to the endpoint levels, monotone step downward (i1=1 > i2=0).
    assert bg[0] == pytest.approx(y[0], abs=1e-9)
    assert bg[-1] == pytest.approx(y[-1], abs=1e-9)
    # Monotone step downward, up to iteration-tolerance-level wiggle (the
    # fixed point is reached within tol * ptp(y), not to machine precision).
    assert np.all(np.diff(bg) <= 1e-6)
    assert np.all(bg <= max(y[0], y[-1]) + 1e-5)
    # The step is crossed under the peak: at x=5 roughly half the area is left.
    mid = int(np.argmin(np.abs(x - 5.0)))
    assert 0.2 < bg[mid] < 0.8


def test_shirley_flat_spectrum_gives_near_zero_background() -> None:
    x = np.linspace(0.0, 10.0, 101)
    bg, info = shirley_background(x, np.zeros_like(x))
    assert info["converged"] is True
    assert_allclose(bg, 0.0, atol=1e-12)


def test_shirley_descending_x_matches_flipped_ascending() -> None:
    x, y = _step_spectrum()
    bg_asc, _ = shirley_background(x, y)
    bg_desc, _ = shirley_background(x[::-1], y[::-1])
    assert_allclose(bg_desc, bg_asc[::-1], atol=1e-9)


def test_shirley_nonconvergence_raises_value_error() -> None:
    x, y = _step_spectrum()
    with pytest.raises(ValueError, match="did not converge"):
        shirley_background(x, y, max_iter=1, tol=1e-15)


def test_shirley_rejects_bad_inputs() -> None:
    x, y = _step_spectrum()
    with pytest.raises(ValueError, match="monotone"):
        shirley_background([0.0, 2.0, 1.0], [1.0, 2.0, 3.0])
    with pytest.raises(ValueError, match="max_iter"):
        shirley_background(x, y, max_iter=0)
    with pytest.raises(ValueError, match="tol"):
        shirley_background(x, y, tol=0.0)
    with pytest.raises(ValueError, match="at least 3"):
        shirley_background([0.0, 1.0], [1.0, 2.0])


# ── xrd_low_angle_background (#7a) ─────────────────────────────────────────


def test_xrd_low_angle_recovers_exact_hyperbolic_coeffs() -> None:
    x = np.linspace(1.0, 40.0, 200)
    y = 5.0 + 120.0 / x + 30.0 / x**2
    bg, info = xrd_low_angle_background(x, y)
    assert info["converged"] is True
    assert_allclose(bg, y, rtol=1e-8)
    assert info["coeffs"][0] == pytest.approx(5.0, abs=1e-6)
    assert info["coeffs"][1] == pytest.approx(120.0, rel=1e-6)
    assert info["coeffs"][2] == pytest.approx(30.0, rel=1e-5)


def test_xrd_low_angle_clips_bragg_peaks_off_the_fit() -> None:
    x = np.linspace(1.0, 40.0, 400)
    truth = 5.0 + 120.0 / x
    y = truth + 200.0 * np.exp(-((x - 20.0) ** 2) / (2 * 0.3**2))
    bg, _ = xrd_low_angle_background(x, y, include_x2=False)
    # The iterative clip keeps the peak from dragging the background up: the
    # fit stays within a few percent of the true hyperbola away from the peak
    # (the clip biases slightly LOW, never peak-high). Unclipped least squares
    # on the same data overshoots the low-angle end by tens of counts.
    off_peak = np.abs(x - 20.0) > 3.0
    rel = np.abs(bg[off_peak] - truth[off_peak]) / truth[off_peak]
    assert float(np.max(rel)) < 0.06
    # And the peak apex sits far above the fitted background.
    apex = int(np.argmin(np.abs(x - 20.0)))
    assert y[apex] - bg[apex] > 150.0


def test_xrd_low_angle_rejects_nonpositive_x() -> None:
    with pytest.raises(ValueError, match="positive"):
        xrd_low_angle_background([0.0, 1.0, 2.0, 3.0, 4.0], [1.0, 1.0, 1.0, 1.0, 1.0])


# ── footprint (#7b) ────────────────────────────────────────────────────────

W, L = 0.2, 10.0  # sin(theta_spill) = w/L = 0.02 -> theta_spill ~ 1.146 deg


def test_footprint_closed_form_below_spillover() -> None:
    theta = np.array([0.5])
    y = np.array([1.0])
    corrected, info = footprint_correction(theta, y, beam_width=W, sample_length=L)
    expected = 1.0 / (L * math.sin(math.radians(0.5)) / W)
    assert corrected[0] == pytest.approx(expected, rel=1e-12)
    assert info["spilloverDeg"] == pytest.approx(math.degrees(math.asin(W / L)), rel=1e-12)


def test_footprint_unity_above_spillover_and_idempotent() -> None:
    theta = np.array([2.0, 5.0, 30.0])
    y = np.array([3.0, 2.0, 1.0])
    once, _ = footprint_correction(theta, y, beam_width=W, sample_length=L)
    assert_allclose(once, y)  # factor is exactly 1 above spill-over
    twice, _ = footprint_correction(theta, once, beam_width=W, sample_length=L)
    assert_allclose(twice, once)


def test_footprint_two_theta_halves_the_angle() -> None:
    y = np.array([1.0])
    via_2t, _ = footprint_correction(
        np.array([1.0]), y, beam_width=W, sample_length=L, two_theta=True
    )
    via_t, _ = footprint_correction(np.array([0.5]), y, beam_width=W, sample_length=L)
    assert via_2t[0] == pytest.approx(via_t[0], rel=1e-12)


def test_footprint_leaves_nonpositive_theta_alone() -> None:
    factor = footprint_factor(np.array([-1.0, 0.0, 0.5]), beam_width=W, sample_length=L)
    assert factor[0] == 1.0
    assert factor[1] == 1.0
    assert factor[2] < 1.0


def test_footprint_rejects_bad_geometry() -> None:
    with pytest.raises(ValueError, match="beam_width"):
        footprint_factor(np.array([1.0]), beam_width=0.0, sample_length=L)
    with pytest.raises(ValueError, match="sample_length"):
        footprint_factor(np.array([1.0]), beam_width=W, sample_length=-1.0)


# ── corrections-pipeline integration (#2 + #7b as params) ──────────────────


def test_apply_corrections_bg_anchors_subtracts_anchor_baseline() -> None:
    x = np.linspace(0.0, 10.0, 101)
    signal = 3.0 * np.exp(-((x - 5.0) ** 2) / 2.0)
    bg = 0.2 * x + 1.0
    ds = DataStruct.create(x, (signal + bg).reshape(-1, 1), labels=["I"], units=["cps"])
    anchors = [[0.0, 1.0], [10.0, 3.0]]  # exactly the linear background
    out = apply_corrections(ds, {"bgAnchors": anchors, "bgAnchorMethod": "linear"})
    assert_allclose(out.values[:, 0], signal, atol=1e-12)


def test_apply_corrections_anchor_beats_poly_and_slope() -> None:
    x = np.linspace(0.0, 10.0, 11)
    ds = DataStruct.create(x, np.ones((11, 1)), labels=["I"], units=["a.u."])
    out = apply_corrections(
        ds,
        {
            "bgAnchors": [[0.0, 1.0], [10.0, 1.0]],
            "bgAnchorMethod": "linear",
            "bgSlope": 99.0,
            "bgInt": 99.0,
        },
    )
    assert_allclose(out.values[:, 0], 0.0, atol=1e-12)


def test_apply_corrections_footprint_scales_below_spillover_only() -> None:
    theta = np.array([0.5, 5.0])
    ds = DataStruct.create(theta, np.ones((2, 2)), labels=["R", "dQ"], units=["", ""])
    out = apply_corrections(ds, {"footprintW": W, "footprintL": L})
    expected = 1.0 / (L * math.sin(math.radians(0.5)) / W)
    assert out.values[0, 0] == pytest.approx(expected, rel=1e-12)
    assert out.values[1, 0] == pytest.approx(1.0, rel=1e-12)  # above spill-over
    # dQ is a resolution channel — never footprint-scaled.
    assert_allclose(out.values[:, 1], 1.0)

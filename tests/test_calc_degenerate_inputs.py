"""Degenerate-input hardening for the calc layer.

Regression guards for a bug-hunt round (2026-07-05) that found calc functions
which crashed (uncaught non-ValueError), hung, or silently returned wrong
results on degenerate inputs — several reachable through routes as HTTP 500s.
Every fix turns the bad path into a clean ``ValueError`` (or a NaN degrade)
while leaving valid-input behaviour — and golden parity — untouched.

Each test asserts the *bad* path no longer escapes as its original crash type,
and a paired sanity assert confirms the guard doesn't over-fire on valid input.
"""

from __future__ import annotations

import math
from collections.abc import Sequence

import numpy as np
import pytest

from quantized.calc.baseline import baseline_modpoly, baseline_rolling_ball
from quantized.calc.crystallography import d_spacing
from quantized.calc.interp2d import interpolate2d
from quantized.calc.resample import resample_data
from quantized.calc.sld import sld_profile
from quantized.calc.sld_formula import sld_from_formula
from quantized.calc.spectral import fft_spectral
from quantized.calc.unit_convert import unit_convert
from quantized.datastruct import DataStruct


def test_interp2d_linear_collinear_degrades_to_nan_not_qhullerror() -> None:
    """Collinear cloud + method='linear' used to raise QhullError (a 500 via
    /api/rsm/cut-segment and /api/plot/map); now it degrades to NaN like the
    out-of-hull case."""
    x = np.full(20, 30.0)  # constant x -> vertical line -> Qhull can't triangulate
    y = np.linspace(14.9, 15.1, 20)
    z = np.random.default_rng(0).random(20)
    out = interpolate2d(x, y, z, x, y, method="linear")
    assert np.all(np.isnan(out["zq"]))


def test_interp2d_linear_valid_cloud_still_interpolates() -> None:
    rng = np.random.default_rng(1)
    x, y = rng.random(30), rng.random(30)
    z = x + 2.0 * y
    out = interpolate2d(x, y, z, np.array([0.5]), np.array([0.5]), method="linear")
    assert np.isfinite(out["zq"]).any()  # a real triangulation produced values


def test_sld_from_formula_garbage_raises_valueerror_not_parseexception() -> None:
    """periodictable's parser raises pyparsing.ParseException (not ValueError);
    /api/sld/formula caught only ValueError -> 500 on any malformed formula."""
    with pytest.raises(ValueError):
        sld_from_formula("!!!not a formula###", 1.0)


def test_sld_from_formula_valid_still_computes() -> None:
    res = sld_from_formula("SiO2", 2.65)
    assert res["neutron"]["sld_real"] != 0.0


def test_unit_convert_huge_exponent_overflow_raises_valueerror() -> None:
    """base_scale ** exp overflowed (OverflowError -> 500 via /api/reference/convert)."""
    with pytest.raises(ValueError):
        unit_convert(1.0, "km^300", "m^300")


def test_unit_convert_exponent_underflow_to_zero_raises_valueerror() -> None:
    """A huge negative exponent underflowed the scale to 0.0 -> ZeroDivisionError."""
    with pytest.raises(ValueError):
        unit_convert(1.0, "m^308", "cm^308")


def test_unit_convert_normal_exponent_still_works() -> None:
    result, _ = unit_convert(1.0, "km^2", "m^2")
    assert abs(float(np.asarray(result)) - 1.0e6) < 1e-3


def test_welch_full_overlap_terminates_not_infinite_loop() -> None:
    """overlap=1.0 made the hop 0 -> the segment loop never advanced (a hang, not
    a crash). If the clamp regressed, this test would time out rather than fail."""
    x = np.arange(64, dtype=float)
    y = np.sin(x)
    out = fft_spectral(x, y, segment_len=8, overlap=1.0)
    assert "frequency" in out or "psd" in out or isinstance(out, dict)


def test_resample_zero_step_raises_valueerror_not_zerodivision() -> None:
    ds = DataStruct(
        time=np.arange(5.0), values=np.arange(5.0).reshape(-1, 1),
        labels=("y",), units=("",), metadata={},
    )
    with pytest.raises(ValueError):
        resample_data(ds, step=0.0)


def test_rhombohedral_at_120deg_singularity_raises_specific_error() -> None:
    """α >= 120° collapses the rhombohedral cell volume. Used to silently return
    d -> 0 (below) or raise the WRONG 'hkl all zero' message (past 120°)."""
    with pytest.raises(ValueError, match="degenerate rhombohedral"):
        d_spacing("rhombohedral", 5.0, 5.0, 5.0, 1, 1, 1, alpha=120.001)


def test_rhombohedral_valid_angle_still_computes() -> None:
    assert d_spacing("rhombohedral", 5.0, 5.0, 5.0, 1, 1, 1, alpha=60.0)["d"] > 0.0


def test_rolling_ball_nonpositive_radius_raises_valueerror() -> None:
    """radius <= 0 silently produced an all -inf (all-null over the wire) baseline;
    MATLAB requires mustBePositive."""
    with pytest.raises(ValueError, match="radius"):
        baseline_rolling_ball(np.sin(np.arange(50.0)), radius=-5)


def test_rolling_ball_valid_radius_still_computes() -> None:
    bg, _ = baseline_rolling_ball(np.sin(np.arange(50.0)), radius=10)
    assert np.isfinite(bg).all()


def test_modpoly_nonpositive_order_raises_clean_message() -> None:
    with pytest.raises(ValueError, match="order"):
        baseline_modpoly(np.sin(np.arange(50.0)), order=-1)


def test_sld_profile_bad_shape_raises_valueerror_not_indexerror() -> None:
    with pytest.raises(ValueError):
        sld_profile(np.zeros((0, 4)))
    with pytest.raises(ValueError):
        sld_profile(np.zeros((3, 3)))  # too few columns


# ── 2026-07-19 round ──────────────────────────────────────────────────────
# A second sweep of the same class (a route's narrow except tuple vs. what the
# callee actually raises), all three confirmed as live HTTP 500s against the
# real app before fixing.


def test_datastruct_non_numeric_payload_raises_valueerror_not_typeerror() -> None:
    """``np.asarray(dict, dtype=float)`` raises TypeError, which is NOT in the
    ``(ValueError, KeyError, IndexError)`` tuple every DataStruct-building
    route catches — so a malformed ``dataset`` escaped as a 500 from ~17
    handlers across 7 route modules. Every one types the field as
    ``dict[str, Any]``, so pydantic does not filter it.

    Fixed in ``DataStruct.create`` (the ONE constructor they all share) rather
    than by widening N route tuples.
    """
    with pytest.raises(ValueError, match="numeric"):
        DataStruct.from_dict({"time": {"bad": "dict"}, "values": [[1.0], [2.0]]})
    with pytest.raises(ValueError, match="numeric"):
        DataStruct.from_dict({"time": [0.0, 1.0], "values": "not an array"})
    # Guard must not over-fire: ordinary payloads still build.
    ok = DataStruct.from_dict({"time": [0.0, 1.0], "values": [[1.0], [2.0]]})
    assert ok.n_points == 2


def test_fermi_level_underflowed_ni_raises_valueerror_not_zerodivision() -> None:
    """A large ``eg`` (bounded below at 0 by the schema, but not above)
    underflows ``exp(-eg*e/(2*kB*T))`` to exactly 0.0, so ``ni == 0`` and
    ``asinh(net / (2*ni))`` divided by zero — the same underflow class already
    fixed once for ``unit_convert``'s exponent.
    """
    from quantized.calc.semiconductor import fermi_level

    with pytest.raises(ValueError, match="underflow"):
        fermi_level(eg=100.0, me_star=1.0, mh_star=1.0, nd=1e16, na=0.0, t=300.0)
    # Silicon-ish input still works.
    out = fermi_level(eg=1.12, me_star=1.08, mh_star=0.81, nd=1e16, na=0.0, t=300.0)
    assert math.isfinite(out["EF"])


def test_curve_fit_empty_arrays_raise_valueerror_not_zerodivision() -> None:
    """``rmse = sqrt(ss_res / n)`` is a plain-Python float/int division, so
    ``n == 0`` raises ZeroDivisionError rather than yielding nan the way the
    neighbouring numpy divisions do. Neither ``x`` nor ``y`` has a pydantic
    ``min_length``, and passing an explicit ``p0`` skips ``auto_guess``, so
    empty arrays reached the fitter. ``/fitting/scan`` already guarded this;
    the guard now lives in the shared fitter instead.
    """
    from quantized.calc.fitting import curve_fit

    def linear(x: np.ndarray, p: Sequence[float]) -> np.ndarray:
        return np.asarray(p[0] * x + p[1], dtype=float)

    with pytest.raises(ValueError, match="at least one data point"):
        curve_fit([], [], linear, [1.0, 0.0])
    with pytest.raises(ValueError, match="same length"):
        curve_fit([1.0, 2.0, 3.0], [1.0, 2.0], linear, [1.0, 0.0])
    # A real fit is unaffected.
    res = curve_fit([0.0, 1.0, 2.0], [1.0, 3.0, 5.0], linear, [1.0, 0.0])
    assert res["params"][0] == pytest.approx(2.0, rel=1e-6)

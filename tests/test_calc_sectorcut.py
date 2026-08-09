"""Polar (|Q|, azimuth) profiles (calc.sectorcut) — RSM_CUTS_PLAN item 1.

Oracle 1 (round-trip): a synthetic RSM with a KNOWN, ground-truth Q-space
Gaussian (``fixtures.synthetic_rsm.make_synthetic_rsm``) must have its peak
recovered by both ``sector_profile`` (radial) and ``chi_profile``
(azimuthal) within one bin width — never re-derive the expected qrad/phi as
separate literals; read them off the fixture's returned ``PlantedPeak``.

Oracle 2 (wrap equivalence): ``wrap_mask`` — and the sector/chi profiles
built on it — must reproduce MATLAB ``extract2DArcIntegral.m``'s
three-branch sector mask exactly (hand-verified truth table in the
function's docstring), on both a wrapping and a non-wrapping sector.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from fixtures.synthetic_rsm import make_synthetic_rsm
from quantized.calc._rsm_grid import wrap_mask
from quantized.calc.sectorcut import chi_profile, sector_profile
from quantized.datastruct import DataStruct


def _q_points(specs: list[tuple[float, float, float]]) -> DataStruct:
    """A minimal scattered (Qx, Qz, Intensity) DataStruct from (qrad, phi_deg,
    intensity) specs — precise control over azimuth for the wrap tests,
    independent of any particular mesh geometry."""
    qx, qz, iv = [], [], []
    for qrad, phi_deg, intensity in specs:
        phi = math.radians(phi_deg)
        qx.append(qrad * math.cos(phi))
        qz.append(qrad * math.sin(phi))
        iv.append(intensity)
    values = np.column_stack([qx, qz, iv])
    return DataStruct.create(
        np.arange(len(qx), dtype=float),
        values,
        labels=["Qx", "Qz", "Intensity"],
        units=["Ang^-1", "Ang^-1", "counts"],
        metadata={"source": "test", "is2D": True},
    )


# ── wrap_mask (the shared rebase formula) ───────────────────────────────────


def test_wrap_mask_matches_matlab_branches() -> None:
    phi = np.array([175.0, -175.0, -165.0, 160.0, 0.0])

    # Wrapping sector (170 -> -170): MATLAB `(phi>=170) | (phi<-170)`.
    mask, span, _ = wrap_mask(phi, 170.0, -170.0)
    np.testing.assert_array_equal(mask, [True, True, False, False, False])
    assert span == pytest.approx(20.0)

    # Non-wrapping sector (-170 -> 170): MATLAB `(phi>=-170) & (phi<170)`.
    mask2, span2, _ = wrap_mask(phi, -170.0, 170.0)
    np.testing.assert_array_equal(mask2, [False, False, True, True, True])
    assert span2 == pytest.approx(340.0)

    # Full circle: MATLAB's `sMin==-180 && sMax==180` branch.
    mask3, span3, _ = wrap_mask(phi, -180.0, 180.0)
    assert mask3.all()
    assert span3 == pytest.approx(360.0)


def test_wrap_equivalence_matches_matlab_branches() -> None:
    """sector_profile built on wrap_mask reproduces MATLAB's wrapping vs
    non-wrapping sector selection on points straddling the +-180 seam."""
    ds = _q_points([(3.0, 175.0, 10.0), (3.0, -175.0, 20.0)])

    wrap = sector_profile(
        ds, q_min=2.5, q_max=3.5, n_bins=2, phi_min=170.0, phi_max=-170.0, mode="sum"
    )
    assert wrap.values[:, 0].sum() == pytest.approx(30.0)  # both points included
    assert wrap.values[:, 1].sum() == pytest.approx(2.0)  # counts

    with pytest.raises(ValueError, match="no data points"):
        sector_profile(
            ds, q_min=2.5, q_max=3.5, n_bins=2, phi_min=-170.0, phi_max=170.0, mode="sum"
        )


def test_chi_profile_x_is_monotonic_across_wrap_seam() -> None:
    ds = _q_points([(3.0, 170.0, 10.0), (3.0, -170.0, 20.0)])  # true azimuth 170, 190
    out = chi_profile(ds, q_min=2.5, q_max=3.5, n_bins=6, phi_min=150.0, phi_max=-150.0)
    assert np.all(np.diff(out.time) > 0)
    assert out.time.max() > 180.0  # intentional -- see chi_profile's docstring


# ── planted-peak round-trip (the point of the fixture) ──────────────────────


def test_sector_and_chi_profile_recover_the_planted_peak() -> None:
    ds, peaks = make_synthetic_rsm(n=64, m=96)
    assert len(peaks) == 1
    peak = peaks[0]
    qrad0 = math.hypot(peak.qx, peak.qz)
    phi0 = math.degrees(math.atan2(peak.qz, peak.qx))

    q_min = max(qrad0 - 6.0 * peak.sigma, 0.0)
    q_max = qrad0 + 6.0 * peak.sigma
    n_bins = 80
    radial = sector_profile(ds, q_min=q_min, q_max=q_max, n_bins=n_bins, mode="sum")
    bin_width = (q_max - q_min) / n_bins
    peak_q = float(radial.time[int(np.argmax(radial.values[:, 0]))])
    assert abs(peak_q - qrad0) <= bin_width

    chi = chi_profile(ds, q_min=q_min, q_max=q_max, n_bins=90, mode="sum")
    bin_width_phi = 360.0 / 90
    peak_phi = float(chi.time[int(np.argmax(chi.values[:, 0]))])
    diff = abs(peak_phi - phi0)
    diff = min(diff, 360.0 - diff)
    assert diff <= bin_width_phi

    assert radial.labels == ("Intensity", "N points")
    assert radial.metadata["cut_kind"] == "sector"
    assert chi.metadata["cut_kind"] == "chi"
    assert chi.metadata["cut_space"] == "q"


# ── mean/sum modes + counts (empty bin -> NaN, not an error) ────────────────


def test_mean_and_sum_modes_with_an_empty_bin() -> None:
    ds = _q_points([(1.5, 0.0, 4.0), (1.5, 0.0, 6.0)])  # both land in bin 0 of 2

    mean_out = sector_profile(ds, q_min=1.0, q_max=3.0, n_bins=2, mode="mean")
    assert mean_out.values[0, 0] == pytest.approx(5.0)  # mean(4, 6)
    assert mean_out.values[0, 1] == pytest.approx(2.0)
    assert math.isnan(mean_out.values[1, 0])  # empty bin -> NaN, not 0
    assert mean_out.values[1, 1] == pytest.approx(0.0)

    sum_out = sector_profile(ds, q_min=1.0, q_max=3.0, n_bins=2, mode="sum")
    assert sum_out.values[0, 0] == pytest.approx(10.0)  # sum(4, 6)
    assert sum_out.values[1, 0] == pytest.approx(0.0)  # empty bin -> 0, not NaN
    assert sum_out.units == ("counts", "")


# ── error paths ──────────────────────────────────────────────────────────────


def test_missing_q_columns_states_the_polar_space_reason() -> None:
    flat = DataStruct.create(
        np.arange(5.0), np.arange(5.0), labels=["Intensity"], units=[""], metadata={}
    )
    with pytest.raises(ValueError, match="true-polar"):
        sector_profile(flat, q_min=0.0, q_max=1.0)
    with pytest.raises(ValueError, match="true-polar"):
        chi_profile(flat, q_min=0.0, q_max=1.0)


def test_validation_errors() -> None:
    ds, _peaks = make_synthetic_rsm(n=16, m=24)
    with pytest.raises(ValueError, match="mode"):
        sector_profile(ds, q_min=0.0, q_max=1.0, mode="banana")
    with pytest.raises(ValueError, match="n_bins"):
        sector_profile(ds, q_min=0.0, q_max=1.0, n_bins=1)
    with pytest.raises(ValueError, match="q_max"):
        sector_profile(ds, q_min=2.0, q_max=1.0)
    with pytest.raises(ValueError, match="q_max"):
        chi_profile(ds, q_min=-1.0, q_max=-2.0)
    with pytest.raises(ValueError, match="no data points"):
        sector_profile(ds, q_min=1000.0, q_max=1001.0)

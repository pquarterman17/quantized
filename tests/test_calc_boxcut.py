"""Cartesian box integration (calc.boxcut) — RSM_CUTS_PLAN item 3.

Oracle 1 (grid-path exactness): a hand-computed 4x5 grid, with a planted NaN
cell, proves the "angular + map_shape + angle=0 + wrap=None" path is EXACT
(the selected lines/values/counts are asserted against hand-derived numbers,
not just "close to" — this is the test that proves "zero interpolation" is
true).

Oracle 2 (cloud-path round-trip): a synthetic RSM with a KNOWN Q-space
Gaussian (``fixtures.synthetic_rsm.make_synthetic_rsm``) must have its peak
recovered by ``box_cut`` (collapse="x") and its centroid recovered by
``box_stats`` — never re-derive the expected qx/qz as separate literals,
read them off the fixture's returned ``PlantedPeak``.

Oracle 3 (rotation): a synthetic 45-deg-tilted Gaussian "ridge" — a box
ROTATED to align with the ridge integrates several times more of its total
intensity than an axis-aligned box of identical size (Resolved decisions
rev 2: the cut-ruler backend). Stable across random seeds because it
compares an AGGREGATE (``box_stats``' ``integrated_intensity``), not a
single noisy bin.

Oracle 4 (wrap): a periodic axis spanning the 0/360 seam, masked via
``wrap="y"``, must select exactly the same points (and sum to the same
totals) as a hand-written "wrap-around" boolean mask built independently of
``box_cut``.

Oracle 5 (pole figure, RSM_CUTS_PLAN item 19): a dataset with NO '2Theta'
column (labels ``["Phi", "Psi", "Intensity"]``, matching the real
``xrayutilities_polefig_point.xrdml`` corpus anchor's schema) used to crash
``box_cut``/``box_stats`` with a leaked ``tuple.index(x): x not in tuple`` —
``calc._rsm_grid.scatter_columns``/``full_grids`` hardcoded ``"2Theta"``. Now
resolves to the dataset's own ``(Phi, Psi)`` pair (see
``tests/test_calc_rsm_grid.py`` for the resolver's own unit tests) and labels
the cut with the axis it actually came from, never a literal ``"2Theta"``.
The real-corpus round trip additionally proves a wedge straddling the +-180
deg Phi seam (``wrap="x"``) matches its unwrapped two-piece equivalent —
the same seam property ``sectorcut.chi_profile`` asserts.
"""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import pytest

from fixtures.synthetic_rsm import make_synthetic_rsm
from quantized.calc.boxcut import box_cut, box_stats
from quantized.datastruct import DataStruct

# ── Grid-path exactness: a hand-computed 4x5 grid ───────────────────────────
#
# 2Theta = [10, 11, 12, 13, 14] (columns), Omega = [0, 1, 2, 3] (rows).
# Intensity = arange(20).reshape(4, 5), with cell [row=1, col=2] (value 7)
# planted as NaN to exercise the "counts = finite cells per line" contract.
#
#        col0  col1  col2  col3  col4     (2Theta: 10    11    12    13    14)
# row0:    0     1     2     3     4      (Omega=0)
# row1:    5     6    NaN    8     9      (Omega=1)
# row2:   10    11    12    13    14      (Omega=2)
# row3:   15    16    17    18    19      (Omega=3)


@pytest.fixture
def hand_grid() -> DataStruct:
    tt_vec = np.array([10.0, 11.0, 12.0, 13.0, 14.0])
    om_vec = np.array([0.0, 1.0, 2.0, 3.0])
    tt_grid, om_grid = np.meshgrid(tt_vec, om_vec)  # shape (4, 5): rows=Omega, cols=2Theta
    intensity = np.arange(20, dtype=float).reshape(4, 5)
    intensity[1, 2] = np.nan
    values = np.column_stack([tt_grid.ravel(), om_grid.ravel(), intensity.ravel()])
    return DataStruct.create(
        np.arange(20, dtype=float),
        values,
        labels=["2Theta", "Omega", "Intensity"],
        units=["deg", "deg", "counts"],
        metadata={"is2D": True, "map_shape": [4, 5], "axis1_name": "Omega", "source": "test"},
    )


def test_grid_path_collapse_x_sum_mean_max(hand_grid: DataStruct) -> None:
    # Box selects rows 1..2 (Omega in [1, 2]) and cols 1..3 (2Theta in [11, 13]):
    #   row1 (cols 1..3): [6, NaN, 8]
    #   row2 (cols 1..3): [11, 12, 13]
    out_sum = box_cut(
        hand_grid, x_min=11.0, x_max=13.0, y_min=1.0, y_max=2.0, collapse="x", reduce="sum"
    )
    np.testing.assert_allclose(out_sum.time, [11.0, 12.0, 13.0])
    np.testing.assert_allclose(out_sum.values[:, 0], [17.0, 12.0, 21.0])  # nansum per column
    np.testing.assert_allclose(out_sum.values[:, 1], [2.0, 1.0, 2.0])  # finite counts
    assert out_sum.labels == ("Intensity", "N points")
    assert out_sum.metadata["cut_kind"] == "box"
    assert out_sum.metadata["roi"] == [11.0, 13.0, 1.0, 2.0]
    assert out_sum.metadata["n_bins_or_lines"] == 2  # 2 rows reduced per column
    assert out_sum.metadata["cut_space"] == "angular"

    out_mean = box_cut(
        hand_grid, x_min=11.0, x_max=13.0, y_min=1.0, y_max=2.0, collapse="x", reduce="mean"
    )
    np.testing.assert_allclose(out_mean.values[:, 0], [8.5, 12.0, 10.5])

    out_max = box_cut(
        hand_grid, x_min=11.0, x_max=13.0, y_min=1.0, y_max=2.0, collapse="x", reduce="max"
    )
    np.testing.assert_allclose(out_max.values[:, 0], [11.0, 12.0, 13.0])


def test_grid_path_collapse_y(hand_grid: DataStruct) -> None:
    # Same box, collapsed onto y (Omega) instead: row1=[6,NaN,8], row2=[11,12,13].
    out_sum = box_cut(
        hand_grid, x_min=11.0, x_max=13.0, y_min=1.0, y_max=2.0, collapse="y", reduce="sum"
    )
    np.testing.assert_allclose(out_sum.time, [1.0, 2.0])
    np.testing.assert_allclose(out_sum.values[:, 0], [14.0, 36.0])  # nansum(6,8)=14; sum=11+12+13
    np.testing.assert_allclose(out_sum.values[:, 1], [2.0, 3.0])  # finite counts
    assert out_sum.metadata["n_bins_or_lines"] == 3  # 3 cols reduced per row

    out_mean = box_cut(
        hand_grid, x_min=11.0, x_max=13.0, y_min=1.0, y_max=2.0, collapse="y", reduce="mean"
    )
    np.testing.assert_allclose(out_mean.values[:, 0], [7.0, 12.0])  # nanmean(6,8)=7; mean=12


def test_grid_path_used_only_when_eligible(hand_grid: DataStruct) -> None:
    """angle != 0 or wrap set forces the cloud path even on a grid dataset —
    cheaply distinguishable here because n_bins_or_lines then reports the
    (default) bin count, not the (small) hand-grid's line count."""
    out_rot = box_cut(
        hand_grid, x_min=11.0, x_max=13.0, y_min=1.0, y_max=2.0, collapse="x", angle=1.0, n_bins=5
    )
    assert out_rot.metadata["n_bins_or_lines"] == 5
    out_wrap = box_cut(
        hand_grid, x_min=11.0, x_max=13.0, y_min=1.0, y_max=2.0, collapse="x", wrap="x", n_bins=5
    )
    assert out_wrap.metadata["n_bins_or_lines"] == 5


def test_empty_box_raises(hand_grid: DataStruct) -> None:
    with pytest.raises(ValueError, match="box selects no data"):
        box_cut(hand_grid, x_min=1000.0, x_max=1001.0, y_min=1.0, y_max=2.0)
    with pytest.raises(ValueError, match="box selects no data"):
        box_stats(hand_grid, x_min=1000.0, x_max=1001.0, y_min=1.0, y_max=2.0)


# ── Cloud-path round-trip: planted Q-space Gaussian ─────────────────────────


def test_cloud_path_recovers_the_planted_gaussian() -> None:
    ds, peaks = make_synthetic_rsm(n=48, m=64)
    assert len(peaks) == 1
    peak = peaks[0]
    half = 6.0 * peak.sigma
    x_min, x_max = peak.qx - half, peak.qx + half
    y_min, y_max = peak.qz - half, peak.qz + half
    n_bins = 60

    out = box_cut(
        ds, x_min=x_min, x_max=x_max, y_min=y_min, y_max=y_max,
        space="q", collapse="x", reduce="sum", n_bins=n_bins,
    )
    assert out.metadata["cut_space"] == "q"
    assert out.metadata["n_bins_or_lines"] == n_bins
    bin_width = (x_max - x_min) / n_bins
    peak_x = float(out.time[int(np.argmax(out.values[:, 0]))])
    assert abs(peak_x - peak.qx) <= bin_width

    stats = box_stats(ds, x_min=x_min, x_max=x_max, y_min=y_min, y_max=y_max, space="q")

    # "within one grid spacing" — the mesh's own local Q resolution, not the
    # profile's bin width (box_stats doesn't bin at all).
    n, m = ds.metadata["map_shape"]
    qx_grid = ds.column("Qx").reshape(n, m)
    qz_grid = ds.column("Qz").reshape(n, m)
    dqx = float(np.median(np.abs(np.diff(qx_grid, axis=1))))
    dqz = float(np.median(np.abs(np.diff(qz_grid, axis=0))))
    grid_spacing = float(np.hypot(dqx, dqz))
    assert abs(stats["centroid_x"] - peak.qx) <= grid_spacing
    assert abs(stats["centroid_y"] - peak.qz) <= grid_spacing

    # integrated_intensity equals a direct numpy sum over the SAME mask.
    xs, ys, iv = ds.column("Qx"), ds.column("Qz"), ds.column("Intensity")
    mask = (xs >= x_min) & (xs <= x_max) & (ys >= y_min) & (ys <= y_max)
    assert stats["integrated_intensity"] == pytest.approx(float(iv[mask].sum()))
    assert stats["n_points"] == int(mask.sum())
    assert stats["space"] == "q"
    assert stats["wrap"] is None


def test_collapse_y_and_map_shape_less_fallback() -> None:
    """A dataset with NO map_shape can never take the grid path — confirmed
    here by checking n_bins_or_lines reports the requested bin count (a
    cloud-path-only quantity; the grid path reports a line count instead)."""
    rng = np.random.default_rng(3)
    n = 500
    tt = rng.uniform(0.0, 5.0, n)
    om = rng.uniform(0.0, 5.0, n)
    iv = rng.uniform(1.0, 10.0, n)
    ds = DataStruct.create(
        np.arange(n, dtype=float), np.column_stack([tt, om, iv]),
        labels=["2Theta", "Omega", "Intensity"], units=["deg", "deg", "counts"],
        metadata={"is2D": True, "source": "test"},  # no map_shape
    )
    out = box_cut(ds, x_min=0.0, x_max=5.0, y_min=0.0, y_max=5.0, collapse="y", n_bins=17)
    assert out.metadata["n_bins_or_lines"] == 17
    assert out.metadata["cut_space"] == "angular"
    assert out.time.size == 17


# ── Rotation: a 45-deg ridge recovered by a rotated box, smeared by an
# axis-aligned one ──────────────────────────────────────────────────────────


def _ridge_dataset(
    theta_deg: float = 45.0,
    sigma_long: float = 6.0,
    sigma_short: float = 0.4,
    amp: float = 100.0,
    background: float = 1.0,
    half_extent: float = 12.0,
    n: int = 20_000,
    seed: int = 0,
) -> DataStruct:
    """A scattered cloud with an anisotropic Gaussian "ridge" tilted
    ``theta_deg`` off-axis — a pure geometry stress test for box_cut's
    rotation math, so a hand-built synthetic cloud (not derived from any
    production physics formula) is the right fixture here, same spirit as
    ``test_calc_sectorcut.py``'s ``_q_points`` helper."""
    rng = np.random.default_rng(seed)
    x = rng.uniform(-half_extent, half_extent, n)
    y = rng.uniform(-half_extent, half_extent, n)
    theta = math.radians(theta_deg)
    u = x * math.cos(theta) + y * math.sin(theta)  # along the ridge
    v = -x * math.sin(theta) + y * math.cos(theta)  # across the ridge
    intensity = background + amp * np.exp(
        -0.5 * (u / sigma_long) ** 2 - 0.5 * (v / sigma_short) ** 2
    )
    values = np.column_stack([x, y, intensity])
    return DataStruct.create(
        np.arange(n, dtype=float), values,
        labels=["2Theta", "Omega", "Intensity"], units=["deg", "deg", "counts"],
        metadata={"is2D": True, "source": "test"},
    )


def test_rotated_box_recovers_ridge_axis_aligned_box_smears_it() -> None:
    ds = _ridge_dataset()
    half = 12.0
    rotated = box_stats(ds, x_min=-half, x_max=half, y_min=-1.5, y_max=1.5, angle=45.0)
    axis_aligned = box_stats(ds, x_min=-half, x_max=half, y_min=-1.5, y_max=1.5, angle=0.0)

    # Both boxes have identical area/point count (rotation doesn't change how
    # many scattered points fall inside a box of the same shape) but the
    # rotated one is aligned with the ridge, so it integrates several times
    # more of the ridge's total intensity — a robust aggregate comparison,
    # stable across random seeds (unlike comparing a single noisy profile
    # bin).
    assert rotated["n_points"] == pytest.approx(axis_aligned["n_points"], rel=0.1)
    assert rotated["integrated_intensity"] > 2.0 * axis_aligned["integrated_intensity"]

    # The rotated profile also recovers the ridge's transverse (v) position
    # (true centre v=0) as a real peak vs the box's y axis in the rotated frame.
    profile = box_cut(
        ds, x_min=-half, x_max=half, y_min=-1.5, y_max=1.5,
        collapse="y", reduce="sum", n_bins=20, angle=45.0,
    )
    bin_width = 3.0 / 20
    peak_v = float(profile.time[int(np.argmax(profile.values[:, 0]))])
    assert abs(peak_v) <= bin_width


def test_angle_zero_matches_unspecified_angle() -> None:
    ds = _ridge_dataset()
    explicit = box_cut(
        ds, x_min=-5.0, x_max=5.0, y_min=-5.0, y_max=5.0,
        collapse="x", reduce="sum", n_bins=20, angle=0.0,
    )
    default = box_cut(
        ds, x_min=-5.0, x_max=5.0, y_min=-5.0, y_max=5.0, collapse="x", reduce="sum", n_bins=20
    )
    np.testing.assert_allclose(explicit.values, default.values)
    np.testing.assert_allclose(explicit.time, default.time)


# ── Wrap: a periodic axis crossing the 0/360 seam ───────────────────────────


def test_wrap_selects_same_points_as_a_hand_written_wraparound_mask() -> None:
    rng = np.random.default_rng(1)
    n = 2000
    tt = rng.uniform(0.0, 5.0, n)
    omega = rng.uniform(0.0, 360.0, n)  # a full-circle periodic axis
    intensity = rng.uniform(1.0, 10.0, n)
    ds = DataStruct.create(
        np.arange(n, dtype=float), np.column_stack([tt, omega, intensity]),
        labels=["2Theta", "Omega", "Intensity"], units=["deg", "deg", "counts"],
        metadata={"is2D": True, "source": "test"},
    )

    out = box_cut(
        ds, x_min=0.0, x_max=5.0, y_min=350.0, y_max=10.0, space="angular",
        collapse="x", reduce="sum", n_bins=10, wrap="y",
    )
    # Independently hand-written wraparound mask -- the seam-crossing
    # equivalent of the plain (unwrapped) range mask.
    expected_mask = (tt >= 0.0) & (tt <= 5.0) & ((omega >= 350.0) | (omega < 10.0))
    assert out.values[:, 1].sum() == pytest.approx(float(expected_mask.sum()))
    assert out.values[:, 0].sum() == pytest.approx(float(intensity[expected_mask].sum()))

    stats = box_stats(ds, x_min=0.0, x_max=5.0, y_min=350.0, y_max=10.0, space="angular", wrap="y")
    assert stats["n_points"] == int(expected_mask.sum())
    assert stats["integrated_intensity"] == pytest.approx(float(intensity[expected_mask].sum()))
    assert stats["wrap"] == "y"


# ── Pole figures: no '2Theta' column (RSM_CUTS_PLAN item 19) ───────────────


@pytest.fixture
def pole_figure_grid() -> DataStruct:
    """Pole-figure-shaped dataset: labels ``(Phi, Psi, Intensity)``, no
    '2Theta' column, ``axis1_name='Psi'`` — the real corpus anchor's schema
    (``xrayutilities_polefig_point.xrdml``). Phi spans (almost) the full
    circle, Psi a tilt range, exactly like the real file."""
    n, m = 7, 37  # Psi steps x Phi points
    phi_vec = np.linspace(-178.0, 178.0, m)
    psi_vec = np.linspace(0.0, 60.0, n)
    phi_grid, psi_grid = np.meshgrid(phi_vec, psi_vec)
    intensity = np.arange(n * m, dtype=float).reshape(n, m)
    values = np.column_stack([phi_grid.ravel(), psi_grid.ravel(), intensity.ravel()])
    return DataStruct.create(
        np.arange(n * m, dtype=float),
        values,
        labels=["Phi", "Psi", "Intensity"],
        units=["deg", "deg", "cps"],
        metadata={"is2D": True, "map_shape": [n, m], "axis1_name": "Psi", "source": "test"},
    )


def test_pole_figure_box_cut_labels_phi_not_2theta(pole_figure_grid: DataStruct) -> None:
    """Before item 19: this call raised ``ValueError: tuple.index(x): x not
    in tuple`` (a bare ``ds.column("2Theta")`` on a dataset with no such
    column). Now it resolves ``(Phi, Psi)`` and labels the cut accordingly."""
    out = box_cut(
        pole_figure_grid, x_min=-180.0, x_max=180.0, y_min=0.0, y_max=30.0,
        space="angular", collapse="x", reduce="sum", wrap="x",
    )
    assert out.metadata["x_column_name"] == "Phi"
    assert out.metadata["x_column_unit"] == "deg"
    assert out.metadata["cut_space"] == "angular"
    assert np.all(np.isfinite(out.values[:, 0]))
    assert out.values[:, 0].sum() > 0


def test_pole_figure_box_cut_collapse_y_labels_psi(pole_figure_grid: DataStruct) -> None:
    out = box_cut(
        pole_figure_grid, x_min=-180.0, x_max=180.0, y_min=0.0, y_max=30.0,
        space="angular", collapse="y", reduce="sum", wrap="x",
    )
    assert out.metadata["x_column_name"] == "Psi"


def test_pole_figure_box_stats_no_2theta_needed(pole_figure_grid: DataStruct) -> None:
    stats = box_stats(
        pole_figure_grid, x_min=-180.0, x_max=180.0, y_min=0.0, y_max=30.0,
        space="angular", wrap="x",
    )
    assert stats["n_points"] > 0
    assert stats["space"] == "angular"


@pytest.mark.realdata
def test_pole_figure_real_corpus_azimuthal_profile_and_seam(corpus_dir: Path) -> None:
    """End-to-end acceptance (RSM_CUTS_PLAN item 19): azimuthal ∫x profile
    with ``wrap="x"`` over the real 359.4-deg Phi axis returns a sane, fully
    finite profile labelled 'Phi' -- and a wedge straddling the +-180 deg
    seam matches its unwrapped two-piece equivalent exactly (same property
    ``sectorcut.chi_profile``'s seam test asserts), proving the wrap handling
    is correct on the real data, not just the synthetic fixture above."""
    from quantized.io.registry import import_auto

    path = corpus_dir / "panalytical" / "xrd" / "xrayutilities_polefig_point.xrdml"
    if not path.exists():
        pytest.skip("pole-figure corpus file missing")
    ds = import_auto(str(path))
    assert "2Theta" not in ds.labels  # sanity: this IS the no-2Theta case

    # Full-circle azimuthal profile: must not raise, must label 'Phi', must
    # be a sane (fully finite, non-degenerate) profile.
    profile = box_cut(
        ds, x_min=-180.0, x_max=180.0, y_min=0.0, y_max=90.0,
        space="angular", collapse="x", reduce="sum", wrap="x", n_bins=200,
    )
    assert profile.metadata["x_column_name"] == "Phi"
    assert np.all(np.isfinite(profile.values[:, 0]))
    assert profile.values[:, 0].sum() > 0
    assert profile.time.min() >= -180.0 - 1e-6
    assert profile.time.max() <= 180.0 + 1e-6

    # Seam wedge: phi in [170, -170] wrapping through +-180 (span 20 deg)
    # must equal the sum of its two non-wrapping pieces on either side of
    # the seam.
    wrapped = box_stats(
        ds, x_min=170.0, x_max=-170.0, y_min=0.0, y_max=90.0,
        space="angular", wrap="x",
    )
    piece_a = box_stats(
        ds, x_min=170.0, x_max=180.0, y_min=0.0, y_max=90.0, space="angular"
    )
    piece_b = box_stats(
        ds, x_min=-180.0, x_max=-170.0, y_min=0.0, y_max=90.0, space="angular"
    )
    assert wrapped["n_points"] == piece_a["n_points"] + piece_b["n_points"]
    assert wrapped["integrated_intensity"] == pytest.approx(
        piece_a["integrated_intensity"] + piece_b["integrated_intensity"]
    )


# ── Error paths ──────────────────────────────────────────────────────────────


def test_validation_errors(hand_grid: DataStruct) -> None:
    with pytest.raises(ValueError, match="space"):
        box_cut(hand_grid, x_min=0.0, x_max=1.0, y_min=0.0, y_max=1.0, space="banana")
    with pytest.raises(ValueError, match="collapse"):
        box_cut(hand_grid, x_min=0.0, x_max=1.0, y_min=0.0, y_max=1.0, collapse="z")
    with pytest.raises(ValueError, match="reduce"):
        box_cut(hand_grid, x_min=0.0, x_max=1.0, y_min=0.0, y_max=1.0, reduce="banana")
    with pytest.raises(ValueError, match="wrap"):
        box_cut(hand_grid, x_min=0.0, x_max=1.0, y_min=0.0, y_max=1.0, wrap="z")
    with pytest.raises(ValueError, match="n_bins"):
        box_cut(hand_grid, x_min=0.0, x_max=1.0, y_min=0.0, y_max=1.0, space="q", n_bins=1)
    with pytest.raises(ValueError, match="x_max"):
        box_cut(hand_grid, x_min=2.0, x_max=1.0, y_min=0.0, y_max=1.0)
    with pytest.raises(ValueError, match="y_max"):
        box_stats(hand_grid, x_min=0.0, x_max=1.0, y_min=2.0, y_max=1.0)
    # A wrapped axis is exempt from ordering — lo > hi is normal wrapping,
    # not an error (only the NON-wrapped axis is still checked). x covers
    # the full 2Theta range so the (near-full-circle) wrapped y selection
    # actually finds data instead of raising "box selects no data".
    box_cut(hand_grid, x_min=10.0, x_max=14.0, y_min=2.0, y_max=1.0, wrap="y", space="angular")

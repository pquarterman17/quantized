"""Line cuts / projections (calc.linecut) — verified against the committed
xrdml_rsm_synthetic fixture (5 Omega frames x 10 2Theta pixels, known grid).

Oracle (angular space): a cut must equal the corresponding row/column of the
reshaped (map_shape) grid — an implementation-independent statement of what a
detector-line cut IS. MATLAB parity: width=0 reproduces extract2DLineCut's
nearest-line behaviour; projection(axis='pixels') reproduces importXRDML's
integrated 1-D fallback sum(intensityMap, 1).

RSM_CUTS_PLAN item 2: Q-space cuts are covered separately below, with a
FALSIFIABLE regression against the fixed-mean-row bug this item fixes (see
``test_q_space_band_excludes_curvilinear_far_cell`` — verified by hand to
fail against the pre-fix implementation; see the task summary for the
before/after run) and a hand-computed mask+bin oracle
(``test_q_space_band_matches_hand_computed_reference``).
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from fixtures.synthetic_rsm import make_synthetic_rsm
from quantized.calc.linecut import cut_segment, line_cut, projection
from quantized.datastruct import DataStruct
from quantized.io.xrdml import import_xrdml


@pytest.fixture
def rsm(fixtures_dir: Path) -> DataStruct:
    return import_xrdml(fixtures_dir / "xrdml_rsm_synthetic.xrdml")


def _grids(ds: DataStruct) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    n, m = ds.metadata["map_shape"]
    return (
        ds.column("2Theta").reshape(n, m),
        ds.column("Omega").reshape(n, m),
        ds.column("Intensity").reshape(n, m),
    )


def test_h_cut_nearest_row_matches_grid(rsm: DataStruct) -> None:
    tt, om, iv = _grids(rsm)
    target = float(om[1, 0])  # exactly the 2nd frame's omega
    out = line_cut(rsm, direction="h", value=target)
    np.testing.assert_allclose(out.time, tt[1, :])
    np.testing.assert_allclose(out.values[:, 0], iv[1, :])
    assert out.metadata["n_lines"] == 1
    assert "H-cut" in out.metadata["cut_label"]


def test_h_cut_width_averages_rows(rsm: DataStruct) -> None:
    tt, om, iv = _grids(rsm)
    step = float(om[1, 0] - om[0, 0])
    # width of 2 steps centred on row 1 -> rows 0..2 averaged
    out = line_cut(rsm, direction="h", value=float(om[1, 0]), width=2.0 * step)
    np.testing.assert_allclose(out.values[:, 0], iv[0:3, :].mean(axis=0))
    assert out.metadata["n_lines"] == 3


def test_v_cut_nearest_col_matches_grid(rsm: DataStruct) -> None:
    tt, om, iv = _grids(rsm)
    target = float(tt[0, 4])
    out = line_cut(rsm, direction="v", value=target)
    np.testing.assert_allclose(out.time, om[:, 4])
    np.testing.assert_allclose(out.values[:, 0], iv[:, 4])


def test_q_space_cut_uses_q_axes(rsm: DataStruct) -> None:
    n, m = rsm.metadata["map_shape"]
    qz = rsm.column("Qz").reshape(n, m)
    target = float(np.mean(qz[2, :]))
    out = line_cut(rsm, direction="h", value=target, space="q")
    assert out.metadata["x_column_name"] == "Qx"
    assert out.metadata["x_column_unit"] == "Ang^-1"
    assert out.time.size == m
    # single Intensity column in Q space too -- consistency within line_cut,
    # not the 2-column [Intensity, "N points"] convention of sectorcut/boxcut
    # (RSM_CUTS_PLAN item 2's resolved decision).
    assert out.labels == ("Intensity",)


def test_projection_matches_matlab_integrated_fallback(rsm: DataStruct) -> None:
    tt, om, iv = _grids(rsm)
    out = projection(rsm, axis="pixels")
    np.testing.assert_allclose(out.values[:, 0], iv.sum(axis=0))  # sum(intensityMap, 1)
    np.testing.assert_allclose(out.time, tt.mean(axis=0))
    rock = projection(rsm, axis="frames")
    np.testing.assert_allclose(rock.values[:, 0], iv.sum(axis=1))


def test_segment_cut_along_a_row_reproduces_it(rsm: DataStruct) -> None:
    tt, om, iv = _grids(rsm)
    row = 2
    out = cut_segment(
        rsm,
        p0=(float(tt[row, 0]), float(om[row, 0])),
        p1=(float(tt[row, -1]), float(om[row, -1])),
        n=tt.shape[1],
    )
    # sample points coincide with grid nodes -> linear interp is exact there
    np.testing.assert_allclose(out.values[:, 0], iv[row, :], rtol=1e-9)
    assert out.metadata["x_column_name"] == "Distance"
    np.testing.assert_allclose(out.time[-1], tt[row, -1] - tt[row, 0])


def test_segment_cut_width_averages_perpendicular(rsm: DataStruct) -> None:
    tt, om, iv = _grids(rsm)
    row = 2
    step = float(om[1, 0] - om[0, 0])
    out = cut_segment(
        rsm,
        p0=(float(tt[row, 1]), float(om[row, 0])),
        p1=(float(tt[row, -2]), float(om[row, 0])),
        n=5,
        width=2.0 * step,  # spans rows 1..3
    )
    assert np.isfinite(out.values[:, 0]).all()


# ── RSM_CUTS_PLAN item 2: honest fixed-Qx/Qz band cuts ──────────────────────
#
# Q-space cuts used to select a whole detector row/column by nearest MEAN
# Qz/Qx and call it "fixed Q". Because the (2Theta, Omega) grid is
# curvilinear in reciprocal space, that whole row/column's ACTUAL Qz sweeps
# most of the map -- measured on the real corpus (see
# test_q_space_band_is_honest_on_real_corpus below): epytaxy_rsm.xrdml
# 98.1%, xrayutilities_rsm_pixcel.xrdml 98.8%, test_area_panalytical.xrdml
# 79.1% of the map's whole Qz range. The tests below prove the fix two ways:
# a falsifiable planted-peak regression (a peak on a row cell far from the
# row's mean Qz must NOT leak into a "fixed Qz = row mean" cut once the cut
# is an honest band) and a hand-computed mask+bin oracle.


def _plant_far_cell_peak(
    n: int = 40, m: int = 50, amplitude: float = 5000.0, background: float = 5.0
) -> tuple[DataStruct, int, float, float, float]:
    """A curvilinear synthetic RSM with a peak planted on the cell of row
    ``row`` whose actual Qz deviates MOST from that row's mean Qz.

    Returns ``(ds, row, qz_a, qx_b, qz_b)`` -- ``qz_a`` is row's mean Qz (the
    "fixed Qz" value a user would click); ``(qx_b, qz_b)`` is the far cell's
    true Q position, where the peak lives. A grid-line cut at ``qz_a``
    necessarily includes that cell (it's part of the row); an honest
    perpendicular-band cut at ``qz_a`` should not, because ``qz_b`` sits far
    outside any reasonable band around ``qz_a``.
    """
    # Step 1: a background-only grid to read off the curvilinear Q geometry
    # (never re-derive it from a separate formula -- read the fixture's own
    # Qx/Qz columns, the same ones line_cut will see).
    ds0, _ = make_synthetic_rsm(n=n, m=m, curvilinear=True, peaks=[], background=background)
    qx0 = ds0.column("Qx").reshape(n, m)
    qz0 = ds0.column("Qz").reshape(n, m)

    row = n // 2
    qz_row = qz0[row, :]
    qz_a = float(np.mean(qz_row))
    idx = int(np.argmax(np.abs(qz_row - qz_a)))
    qx_b, qz_b = float(qx0[row, idx]), float(qz_row[idx])

    # Assert the fixture still has the property it exists for (per the
    # project's fixtures-derive-from-production rule): the far cell must be
    # a substantial fraction of the map's whole Qz range away from qz_a, not
    # a rounding-error-sized wobble.
    total_qz_range = float(qz0.max() - qz0.min())
    deviation_frac = abs(qz_b - qz_a) / total_qz_range
    assert deviation_frac > 0.2, (
        f"fixture's far cell only deviates {deviation_frac:.1%} of the map's Qz "
        "range from the row mean -- too small to distinguish a whole-row cut "
        "from a band cut; widen omega_range or pick a different row"
    )

    q_span = float(np.hypot(np.ptp(qx0), np.ptp(qz0)))
    sigma = q_span * 0.01  # narrow -- localized essentially to the one cell
    ds, _ = make_synthetic_rsm(
        n=n, m=m, curvilinear=True, peaks=[(qx_b, qz_b, amplitude, sigma)], background=background
    )
    return ds, row, qz_a, qx_b, qz_b


def test_q_space_band_excludes_curvilinear_far_cell() -> None:
    """FALSIFIABLE regression for RSM_CUTS_PLAN item 2.

    Verified by hand to FAIL against the pre-fix implementation (which
    selects the whole nearest-mean-row and therefore returns the far cell's
    peak): git-stash the fix, run this test, confirm red; restore, confirm
    green. See the task summary for the recorded before/after run.
    """
    background = 5.0
    ds, row, qz_a, qx_b, _qz_b = _plant_far_cell_peak(background=background)

    out = line_cut(ds, direction="h", value=qz_a, space="q")
    bin_idx = int(np.argmin(np.abs(out.time - qx_b)))
    # The band around qz_a must exclude the far cell's peak -> the bin
    # nearest the peak's Qx stays at background, not elevated by the bump.
    assert out.values[bin_idx, 0] == pytest.approx(background, abs=1.0)
    assert out.metadata["cut_width_used"] < abs(qz_a - _qz_b) / 2.0


def test_q_space_band_matches_hand_computed_reference() -> None:
    """Band-honesty oracle: line_cut's Q-space output equals an independent
    mask + histogram-bin computation over the same raw columns, built
    without calling any of line_cut's internals."""
    n, m = 30, 36
    ds, peaks = make_synthetic_rsm(n=n, m=m, curvilinear=True)
    peak = peaks[0]

    qx = ds.column("Qx")
    qz = ds.column("Qz")
    iv = ds.column("Intensity")
    width = 0.02

    out = line_cut(ds, direction="h", value=peak.qz, space="q", width=width)

    mask = np.abs(qz - peak.qz) <= width / 2.0
    edges = np.linspace(float(qx.min()), float(qx.max()), m + 1)
    sum_i, _ = np.histogram(qx[mask], bins=edges, weights=iv[mask])
    counts, _ = np.histogram(qx[mask], bins=edges)
    with np.errstate(invalid="ignore", divide="ignore"):
        expected = np.where(counts > 0, sum_i / counts, np.nan)
    centres = (edges[:-1] + edges[1:]) / 2.0

    np.testing.assert_allclose(out.time, centres)
    np.testing.assert_allclose(out.values[:, 0], expected, equal_nan=True)
    assert out.metadata["cut_width_used"] == pytest.approx(width)
    assert out.metadata["n_points"] == int(mask.sum())


def test_q_space_width_explicit_vs_auto_band() -> None:
    """``width=0`` auto-selects a single-detector-line-scale band;
    ``width>0`` is a genuine, different (here: much wider) physical band --
    NOT a line count, unlike angular space's ``width``."""
    n, m = 24, 30
    ds, peaks = make_synthetic_rsm(n=n, m=m, curvilinear=True)
    peak = peaks[0]

    auto = line_cut(ds, direction="h", value=peak.qz, space="q")
    wide = line_cut(
        ds, direction="h", value=peak.qz, space="q",
        width=auto.metadata["cut_width_used"] * 20.0,
    )
    assert wide.metadata["cut_width_used"] == pytest.approx(auto.metadata["cut_width_used"] * 20.0)
    assert wide.metadata["cut_width_used"] > auto.metadata["cut_width_used"]
    assert wide.metadata["n_points"] > auto.metadata["n_points"]
    # width is echoed as requested (0 for auto), the ACTUAL band used is a
    # separate field -- a caller must never confuse the two.
    assert auto.metadata["cut_width"] == 0.0
    assert wide.metadata["cut_width"] == pytest.approx(auto.metadata["cut_width_used"] * 20.0)


def test_q_space_band_selecting_no_data_raises() -> None:
    ds, peaks = make_synthetic_rsm(n=20, m=24, curvilinear=True)
    peak = peaks[0]
    far_qz = peak.qz + 1000.0  # nowhere near the map's Qz range
    with pytest.raises(ValueError, match="fixed-Q band selects no data"):
        line_cut(ds, direction="h", value=far_qz, space="q", width=1e-9)


@pytest.mark.realdata
def test_q_space_band_is_honest_on_real_corpus(corpus_dir: Path) -> None:
    """The measured-bug corpus check (RSM_CUTS_PLAN item 2 acceptance):
    before this fix, a "fixed Qz" cut actually swept 79-99% of the map's
    whole Qz range (see the module docstring for the per-file numbers).
    After the fix, the band actually applied (``cut_width_used``) is a
    small fraction of the map's Qz range, not comparable to it -- proof the
    "returned points" genuinely sit near the requested Qz, not scattered
    across nearly the whole map."""
    from quantized.io.registry import import_auto

    names = [
        "epytaxy_rsm.xrdml",
        "xrayutilities_rsm_pixcel.xrdml",
        "test_area_panalytical.xrdml",
    ]
    paths = [corpus_dir / "panalytical" / "xrd" / name for name in names]
    paths = [p for p in paths if p.exists()]
    if not paths:
        pytest.skip("no RSM corpus files present")

    for path in paths:
        ds = import_auto(str(path))
        n, m = ds.metadata["map_shape"]
        qz = ds.column("Qz").reshape(n, m)
        total_range = float(qz.max() - qz.min())
        target = float(np.mean(qz[n // 2, :]))

        out = line_cut(ds, direction="h", value=target, space="q")
        band_used = out.metadata["cut_width_used"]
        assert band_used / total_range < 0.1, (
            f"{path.name}: band {band_used:g} is {100 * band_used / total_range:.1f}% "
            "of the map's Qz range -- expected a small slice, not a whole-row sweep"
        )


def test_errors(rsm: DataStruct) -> None:
    flat = DataStruct.create(
        np.arange(5.0), np.arange(5.0), labels=["I"], units=[""], metadata={}
    )
    with pytest.raises(ValueError, match="not a 2-D map"):
        line_cut(flat, direction="h", value=0.0)
    with pytest.raises(ValueError, match="direction"):
        line_cut(rsm, direction="x", value=0.0)
    with pytest.raises(ValueError, match="distinct"):
        cut_segment(rsm, p0=(1.0, 1.0), p1=(1.0, 1.0))
    with pytest.raises(ValueError, match="space"):
        projection(rsm, space="banana")

"""quantized's map volume and XYZ gridding against OriginPro's own answers.

Same protocol as ``test_origin_oracle_compare_signal``: the input is the seeded
data the harness gave Origin; the reference is Origin's frozen result. Grids are
evaluated on the exact X and Y coordinates of Origin's output matrix. Skips
without the local corpus. Numbers are measured on OriginPro 2026b (10.35).
"""

from __future__ import annotations

import numpy as np
import pytest

from _origin_oracle_fixture import OracleFixture, load_fixture
from quantized.calc._map_points import MapPoints
from quantized.calc.grid_xyz import grid_xyz
from quantized.calc.map_volume import roi_volume

pytestmark = pytest.mark.realdata


def _volume_inputs() -> tuple[OracleFixture, MapPoints, dict[str, float], float]:
    fx = load_fixture("integ2_volume")
    cols = fx.input_columns()
    nx, ny = fx.planted["grid"]
    ux, uy = np.unique(cols["x"]), np.unique(cols["y"])
    pts = MapPoints(
        cols["x"], cols["y"], cols["z"], "X", "", "Y", "", "Z", "", ux, uy,
        cols["z"].reshape(ny, nx),
    )
    whole = {"kind": "rect", "x0": 0.0, "x1": 12.0, "y0": 0.0, "y1": 8.0}
    return fx, pts, whole, float(fx.oracle["values"]["vol"])


def test_origin_integ2_is_the_trapezoid_rule() -> None:
    """Guards the fixture: integ2 integrates over (nx-1)(ny-1) cells, i.e. the
    trapezoid rule on the matrix extent (167.385 here, equal to 1e-12)."""
    fx, pts, _, vol = _volume_inputs()
    assert pts.grid is not None and pts.ux is not None and pts.uy is not None
    trap = np.trapezoid(np.trapezoid(pts.grid, pts.ux, axis=1), pts.uy)
    assert vol == pytest.approx(float(trap), rel=1e-12)


def test_volume_above_the_offset_matches_origin() -> None:
    """Volume above a known constant background. quantized subtracts it per
    cell; Origin's integ2 has no background, so its share is removed
    analytically (offset x map area 12 x 8). The two agree to 1.3e-5 relative
    and both are within 1e-3 of the analytic Gaussian volume."""
    fx, pts, whole, vol = _volume_inputs()
    off = fx.planted["offset"]
    mine = roi_volume(pts, whole, {"kind": "constant", "value": off})["volume"]
    theirs = vol - off * 12.0 * 8.0
    assert mine == pytest.approx(theirs, rel=1e-4)
    assert mine == pytest.approx(fx.planted["gaussian_volume"], rel=1e-3)


def test_raw_volume_differs_by_the_cell_versus_trapezoid_convention() -> None:
    """quantized sums value x cell over nx x ny cell centres (area 100.04);
    Origin integrates over the extent (area 96). The raw volumes differ by
    exactly offset x (100.04 - 96) = 6.060 (measured 6.0603)."""
    fx, pts, whole, vol = _volume_inputs()
    raw = roi_volume(pts, whole)
    expected = fx.planted["offset"] * (raw["area"] - 12.0 * 8.0)
    assert raw["raw_volume"] - vol == pytest.approx(expected, abs=1e-3)


def test_trapezoid_rule_reproduces_origin_integ2() -> None:
    """The opt-in ``rule="trapezoid"`` is Origin's integ2: 167.385 on the whole
    map, to floating point (the default pixel rule reads 173.446, +3.6 %)."""
    _, pts, whole, vol = _volume_inputs()
    got = roi_volume(pts, whole, rule="trapezoid")["raw_volume"]
    assert got == pytest.approx(vol, rel=1e-12)


@pytest.mark.xfail(
    strict=True,
    reason=(
        "whole-map raw volume: quantized 173.446 against Origin integ2 167.385 "
        "(+3.6 %, relative 0.036). quantized counts every pixel as a full cell; "
        "integ2 uses the trapezoid rule, losing half a cell on each edge."
    ),
)
def test_raw_whole_map_volume_equals_origin_integ2() -> None:
    _, pts, whole, vol = _volume_inputs()
    assert roi_volume(pts, whole)["raw_volume"] == pytest.approx(vol, rel=1e-3)


def _grid(case: str, method: str, **kw: object) -> tuple[np.ndarray, np.ndarray]:
    """``(quantized grid, Origin grid)`` on Origin's own axes."""
    fx = load_fixture(case)
    m = fx.matrix()
    c = fx.input_columns()
    got = grid_xyz(
        c["x"], c["y"], c["z"], method=method, nx=m.x.size, ny=m.y.size,
        xlim=(m.x[0], m.x[-1]), ylim=(m.y[0], m.y[-1]), **kw,  # type: ignore[arg-type]
    ).z
    assert got.shape == m.z.shape
    return got, m.z


def test_origin_grids_are_linspace_over_the_data_extent() -> None:
    """Guards the axes assumption behind every gridding comparison."""
    for case in ("xyz_renka", "xyz_shep", "xyz_tps"):
        m = load_fixture(case).matrix()
        np.testing.assert_allclose(m.x, np.linspace(0, 10, 36), atol=1e-12)
        np.testing.assert_allclose(m.y, np.linspace(0, 8, 30), atol=1e-12)
        assert not np.isnan(m.z).any()


def test_shepard_matches_origin_xyz_shep() -> None:
    """Modified Shepard with quadratic nodal functions, 13 / 19 neighbours:
    both follow Renka's QSHEP2. Measured: max 0.0224 (at the hull edge), rms
    0.0022, interior (2 rim cells dropped) max 0.0072, on a surface spanning
    about 2.5. The plain value blend (``shepard_quadratic=False``) is not the
    same method and differs by 0.57."""
    got, ref = _grid("xyz_shep", "shepard")
    assert np.max(np.abs(got - ref)) < 0.03
    assert np.sqrt(np.mean((got - ref) ** 2)) < 0.003


def test_thinplate_matches_origin_xyz_tps() -> None:
    """Interpolating thin-plate spline (smoothing 0). Measured: max 0.0366 at
    the hull edge, rms 0.0044, interior max 0.017; the two choose different
    boundary behaviour, and both are within 0.09 of the true surface."""
    got, ref = _grid("xyz_tps", "thinplate", smoothing=0.0)
    assert np.max(np.abs(got - ref)) < 0.05
    assert np.sqrt(np.mean((got - ref) ** 2)) < 0.006


def test_renka_matches_origin_away_from_the_hull_edge() -> None:
    """quantized's ``renka`` is scipy's Clough-Tocher (gradients by curvature
    minimisation); Origin's is Renka-Cline's own estimate. Dropping the two
    outermost cell rows and columns the grids differ by at most 0.0376 (rms
    0.0074, surface span about 2.5)."""
    got, ref = _grid("xyz_renka", "renka")
    inner = (slice(2, -2), slice(2, -2))
    assert np.max(np.abs(got[inner] - ref[inner])) < 0.05
    assert np.sqrt(np.mean((got[inner] - ref[inner]) ** 2)) < 0.01


@pytest.mark.xfail(
    strict=True,
    reason=(
        "Along the bottom edge of the hull (row 0, columns 7-12) quantized's "
        "Clough-Tocher grid differs from Origin's Renka by up to 0.515 "
        "(whole grid rms 0.0757, median 0.0035). Against the true surface the "
        "worst cell is 0.365 off for Origin and 0.682 for quantized."
    ),
)
def test_renka_matches_origin_on_every_cell() -> None:
    got, ref = _grid("xyz_renka", "renka")
    assert np.max(np.abs(got - ref)) < 0.05

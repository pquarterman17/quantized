"""quantized's math extras against OriginPro's own answers (wave-4 fixtures).

Map correlation (``corr2``), trace interpolation (``interp1trace``), scattered
interpolation (``interp2``), B-spline resampling (``bspline``), surface area
(``marea``) and the NAG gridders. Same protocol as
``test_origin_oracle_compare_map``: the input is the seeded data the harness
gave Origin, the reference is Origin's frozen result, and the test skips
without the corpus. Numbers are measured on OriginPro 2026b (10.35). A
``strict`` xfail is a real disagreement, reported rather than loosened; each
reason says whether it looks like a convention or a defect.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pytest
from scipy.interpolate import CubicSpline, LinearNDInterpolator
from scipy.signal import fftconvolve

from _origin_oracle_fixture import load_fixture
from quantized.calc import math_area as ma
from quantized.calc import math_interp as mi
from quantized.calc.grid_xyz import grid_xyz
from quantized.calc.map_correlate import correlate_maps
from quantized.calc.map_ops import MapGrid

pytestmark = pytest.mark.realdata

Vec = np.ndarray


def _grid(m: Any) -> MapGrid:
    return MapGrid(m.x, m.y, m.z, "x", "", "y", "", "", {})


# --- corr2 -----------------------------------------------------------------


def _corr() -> tuple[MapGrid, MapGrid, Vec, Vec, Vec]:
    fx = load_fixture("corr2_maps")
    a, b, o = fx.matrix(0), fx.matrix(1), fx.matrix(2)
    return _grid(a), _grid(b), o.z, o.x, o.y


def test_origin_corr2_is_the_uncentred_correlation_over_the_norms() -> None:
    """Guards the fixture: Origin's normalised 2-D correlation is the plain
    full cross-correlation divided by ``|a| |b|`` of the WHOLE maps, with no
    mean removed (measured: 7e-16 from this formula)."""
    a, b, ref, _, _ = _corr()
    raw = fftconvolve(a.z, b.z[::-1, ::-1])
    np.testing.assert_allclose(raw / np.sqrt((a.z**2).sum() * (b.z**2).sum()), ref, atol=1e-12)


def test_corr2_peak_position_and_axes_match_origin() -> None:
    """The offset axes are identical and the maximum sits in the same cell
    (row 19, column 24: the planted shift of 3 x 2 cells)."""
    a, b, ref, ox, oy = _corr()
    out, peak = correlate_maps(a, b)
    assert out.z.shape == ref.shape
    np.testing.assert_allclose(out.x, ox, atol=1e-12)
    np.testing.assert_allclose(out.y, oy, atol=1e-12)
    assert np.unravel_index(np.argmax(out.z), out.z.shape) == np.unravel_index(
        np.nanargmax(ref), ref.shape
    )
    assert (peak.lag_x, peak.lag_y) == (-3, -2)


@pytest.mark.xfail(
    strict=True,
    reason=(
        "quantized removes each map's mean before correlating (Pearson-style); "
        "Origin's corr2 norm:=1 does not. Peak 0.9439 against Origin 0.9997 "
        "(0.056), whole-grid max difference 0.353. A convention difference: "
        "quantized's is the better pattern match on maps with an offset."
    ),
)
def test_corr2_values_equal_origin() -> None:
    a, b, ref, _, _ = _corr()
    out, _ = correlate_maps(a, b)
    np.testing.assert_allclose(out.z, ref, atol=1e-3)


# --- interp1trace ----------------------------------------------------------


def _trace_ref() -> tuple[dict[str, Vec], list[Vec]]:
    fx = load_fixture("interp1trace")
    return fx.input_columns(), fx.outputs()


def test_trace_cubic_equals_origin_bspline() -> None:
    """Origin's ``method:=bspline`` is quantized's ``kind="cubic"`` (chord
    length, not-a-knot): measured 5e-15 in x and y over 50 points."""
    c, o = _trace_ref()
    r = mi.trace_interpolate(c["x"], c["y"], n=50, kind="cubic")
    np.testing.assert_allclose(r.x, o[2], atol=1e-10)
    np.testing.assert_allclose(r.y, o[3], atol=1e-10)


def test_origin_trace_spline_is_a_natural_cubic_on_chord_length() -> None:
    """Guards the fixture: Origin's ``method:=spline`` is a NATURAL cubic
    spline of x(s), y(s) over the cumulative chord length, sampled at 50 equal
    steps of s (measured 1.8e-15)."""
    c, o = _trace_ref()
    s = np.r_[0.0, np.cumsum(np.hypot(np.diff(c["x"]), np.diff(c["y"])))]
    sq = np.linspace(0.0, s[-1], 50)
    np.testing.assert_allclose(CubicSpline(s, c["x"], bc_type="natural")(sq), o[0], atol=1e-10)
    np.testing.assert_allclose(CubicSpline(s, c["y"], bc_type="natural")(sq), o[1], atol=1e-10)


@pytest.mark.xfail(
    strict=True,
    reason=(
        "quantized offers linear, pchip and a not-a-knot cubic along the path, "
        "no natural spline. Closest (cubic) is 0.307 off Origin's `spline` in x "
        "and 0.117 in y on a path 12 units wide (linear: 0.748 and 0.433). "
        "A missing option, not a defect."
    ),
)
def test_trace_has_origin_spline() -> None:
    c, o = _trace_ref()
    worst = []
    for kind in ("linear", "pchip", "cubic"):
        r = mi.trace_interpolate(c["x"], c["y"], n=50, kind=kind)  # type: ignore[arg-type]
        worst.append(max(np.abs(r.x - o[0]).max(), np.abs(r.y - o[1]).max()))
    assert min(worst) < 1e-6


# --- interp2 ---------------------------------------------------------------


def _scatter(case: str) -> tuple[Vec, Vec, Vec, list[Vec], Vec]:
    fx = load_fixture(case)
    c = fx.input_columns()
    n = fx.planted["n_query"]
    pts = np.column_stack([c["x"][:150], c["y"][:150]])
    q = np.column_stack([c["xq"][:n], c["yq"][:n]])
    outs = [o[:n] for o in fx.outputs()]
    return pts, c["z"][:150], q, outs, np.array(fx.planted["truth_at_query"])


def test_thin_plate_matches_origin_interp2_tps() -> None:
    """Origin's thin-plate (smoothing 0) and quantized's ``rbf`` are the same
    interpolant: max difference 1.7e-7 on 40 queries."""
    pts, w, q, outs, _ = _scatter("interp2_tps_renka")
    r = mi.scattered_interpolate(pts, w, q, method="rbf").w
    np.testing.assert_allclose(r, outs[0], atol=1e-5)


def test_renka_cline_is_close_to_the_thin_plate_surface() -> None:
    """Origin's Renka-Cline against quantized's ``rbf``: max 0.0148, and
    Origin is within 0.0263 of the true surface."""
    pts, w, q, outs, truth = _scatter("interp2_tps_renka")
    r = mi.scattered_interpolate(pts, w, q, method="rbf").w
    assert np.abs(r - outs[1]).max() < 0.02
    assert np.abs(outs[1] - truth).max() < 0.03


def test_origin_interp2_linear_and_nearest_use_the_raw_coordinates() -> None:
    """Guards the fixture: Origin's ``ta`` is a Delaunay linear interpolant and
    ``nr`` a nearest neighbour, both in the RAW x and y (4e-16 and exact)."""
    pts, w, q, outs, _ = _scatter("interp2_nearest_triangle")
    np.testing.assert_allclose(LinearNDInterpolator(pts, w)(q), outs[1], atol=1e-12)
    idx = np.argmin(((q[:, None, :] - pts[None]) ** 2).sum(-1), axis=1)
    np.testing.assert_allclose(w[idx], outs[0], atol=1e-12)


@pytest.mark.xfail(
    strict=True,
    reason=(
        "quantized scales x and y to the unit box before triangulating, Origin "
        "uses the raw coordinates. 5 of 40 queries land in a different "
        "triangle: max difference 0.0264 (the surface spans 2.3). Looks like a "
        "convention (quantized's is unit-invariant), not a defect."
    ),
)
def test_linear_interpolation_equals_origin_triangle() -> None:
    pts, w, q, outs, _ = _scatter("interp2_nearest_triangle")
    r = mi.scattered_interpolate(pts, w, q, method="linear").w
    np.testing.assert_allclose(r, outs[1], atol=1e-9)


@pytest.mark.xfail(
    strict=True,
    reason=(
        "same unit-box scaling for the distance: 5 of 40 queries pick a "
        "different nearest point, max difference 0.258. Convention, as above."
    ),
)
def test_nearest_interpolation_equals_origin_nearest() -> None:
    pts, w, q, outs, _ = _scatter("interp2_nearest_triangle")
    r = mi.scattered_interpolate(pts, w, q, method="nearest").w
    np.testing.assert_allclose(r, outs[0], atol=1e-9)


# --- bspline ---------------------------------------------------------------


def test_bspline_matches_origin_interpolating_and_smoothing() -> None:
    """Origin's ``bspline`` is a scipy-style B-spline: ``sf:=0`` interpolates
    (3e-15 from quantized) and its smoothing factor ``sf`` is quantized's
    ``smoothing`` (the allowed sum of squared residuals): ``sf:=0.05`` agrees
    to 9e-16 on 70 query x values."""
    fx = load_fixture("bspline_curve")
    c = fx.input_columns()
    x, y, o = c["x"][:30], c["y"][:30], fx.outputs()
    assert np.isfinite(o[0]).sum() == 70
    for smooth, ref in ((0.0, o[0]), (0.05, o[2])):
        r = mi.bspline_resample(x, y, n=70, smoothing=smooth)
        np.testing.assert_allclose(r.x, c["xq"][:70], atol=1e-12)
        np.testing.assert_allclose(r.y, ref[:70], atol=1e-10)


# --- marea -----------------------------------------------------------------


def _surface() -> tuple[float, MapGrid]:
    fx = load_fixture("marea_surface")
    return float(fx.oracle["values"]["sa"]), _grid(fx.matrix())


def test_origin_marea_is_two_triangles_per_cell() -> None:
    """Guards the fixture: 113.9224 is the area of two triangles per cell
    (either diagonal), equal to 1e-11 relative."""
    sa, g = _surface()
    x, y = np.meshgrid(g.x, g.y)
    p = np.stack([x, y, g.z], -1)

    def tri(u: Vec, v: Vec, w: Vec) -> Vec:
        return np.asarray(0.5 * np.linalg.norm(np.cross(v - u, w - u), axis=-1))

    a, b, c_, d = p[:-1, :-1], p[:-1, 1:], p[1:, :-1], p[1:, 1:]
    assert float((tri(a, b, c_) + tri(b, d, c_)).sum()) == pytest.approx(sa, rel=1e-11)


def test_surface_area_is_within_two_parts_in_ten_thousand_of_origin() -> None:
    """quantized 113.9017 against Origin 113.9224 (relative -1.8e-4); the
    projected area is the same 96."""
    sa, g = _surface()
    r = ma.surface_area(g)
    assert r.surface_area == pytest.approx(sa, rel=5e-4)
    assert r.projected_area == pytest.approx(96.0, rel=1e-12)


@pytest.mark.xfail(
    strict=True,
    reason=(
        "quantized splits each cell into four triangles about the cell centre, "
        "Origin into two: 113.9017 against 113.9224 (-0.0207, relative -1.8e-4) "
        "on a smooth Gaussian. Convention; the gap grows on rough maps."
    ),
)
def test_surface_area_equals_origin_marea() -> None:
    sa, g = _surface()
    assert ma.surface_area(g).surface_area == pytest.approx(sa, rel=1e-9)


# --- the NAG gridders ------------------------------------------------------


def _nag(case: str, method: str) -> tuple[Vec, Vec]:
    fx = load_fixture(case)
    m, c = fx.matrix(), fx.input_columns()
    got = grid_xyz(
        c["x"], c["y"], c["z"], method=method, nx=m.x.size, ny=m.y.size,
        xlim=(m.x[0], m.x[-1]), ylim=(m.y[0], m.y[-1]),
    ).z
    assert got.shape == m.z.shape
    return got, m.z


def test_renka_matches_origin_xyz_renka_nag() -> None:
    """quantized's ``renka`` against the NAG Renka gridder: max 0.0434, rms
    0.0053 (interior 0.0200) on a surface spanning 2.3. That is far closer
    than Origin's own non-NAG ``xyz_renka``, which is up to 0.558 from the NAG
    one; its edge cells are the disagreement recorded in
    ``test_origin_oracle_compare_map``."""
    got, ref = _nag("xyz_renka_nag", "renka")
    d = np.abs(got - ref)
    assert d.max() < 0.06
    assert np.sqrt(np.mean(d**2)) < 0.008


def test_shepard_matches_origin_xyz_shep_nag_in_the_middle_of_the_grid() -> None:
    """Median difference 0.0048 against NAG Shepard; most of the 1080 cells
    are within 0.05 (the rest are the unstable cells in the xfail below)."""
    got, ref = _nag("xyz_shep_nag", "shepard")
    d = np.abs(got - ref)
    assert np.median(d) < 0.01
    assert np.mean(d < 0.05) > 0.7


@pytest.mark.xfail(
    strict=True,
    reason=(
        "Origin's NAG Shepard is unstable on this data: its grid spans -3.24 to "
        "8.91 although the surface spans -0.87 to 1.40, with 213 of 1080 cells "
        "more than 0.5 from the true surface (worst 8.69, in rows 0-9 and "
        "16-29). quantized differs from it by the same 8.69. Origin behaviour "
        "(its non-NAG xyz_shep is within 0.178), not a quantized defect."
    ),
)
def test_shepard_equals_origin_xyz_shep_nag_on_every_cell() -> None:
    got, ref = _nag("xyz_shep_nag", "shepard")
    assert np.max(np.abs(got - ref)) < 0.05

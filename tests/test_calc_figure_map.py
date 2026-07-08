"""2-D map publication rendering (calc.figure_map): contour + 3-D export.

Rendering can't be pixel-asserted, so the tests check that every kind/format
produces a valid, non-trivial file (right magic bytes), that level computation
is correct (lin/log/explicit), and that malformed input is rejected.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from quantized.calc.figure_map import (
    MAP_KINDS,
    _contour_levels,  # noqa: PLC2701 (internal, tested directly)
    render_map_figure,
)

_MAGIC = {"pdf": b"%PDF", "svg": b"<?xml", "png": b"\x89PNG"}


def _demo_grid() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    x = np.linspace(-2.0, 2.0, 24)
    y = np.linspace(-1.0, 3.0, 18)
    xg, yg = np.meshgrid(x, y)
    z = 100.0 * np.exp(-(xg**2 + (yg - 1.0) ** 2))
    z[0, 0] = np.nan  # a gap outside the "hull"
    return x, y, z


def _demo_points() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    # An irregular (non-gridded) scattered cloud -- the RSM point-cloud shape
    # (io/_xrdml_scan.py snapshot/coupled layouts), never a regular grid.
    rng = np.random.default_rng(11)
    x = rng.uniform(-2.0, 2.0, 60)
    y = rng.uniform(-1.0, 3.0, 60)
    z = 100.0 * np.exp(-(x**2 + (y - 1.0) ** 2)) + rng.normal(0.0, 0.5, 60)
    return x, y, z


@pytest.mark.parametrize("kind", MAP_KINDS)
@pytest.mark.parametrize("fmt", ["png", "pdf", "svg"])
def test_every_kind_and_format_renders(kind: str, fmt: str) -> None:
    x, y, z = _demo_grid()
    data = render_map_figure(x, y, z, kind=kind, fmt=fmt, title=kind,
                             x_label="qx", y_label="qz", z_label="I")
    assert data[: len(_MAGIC[fmt])] == _MAGIC[fmt]
    assert len(data) > 800


def test_contour_levels_linear_log_explicit() -> None:
    lin = _contour_levels(0.0, 10.0, 6, "linear")
    np.testing.assert_allclose(lin, [0, 2, 4, 6, 8, 10])
    log = _contour_levels(1.0, 100.0, 3, "log")
    np.testing.assert_allclose(log, [1.0, 10.0, 100.0])
    explicit = _contour_levels(0.0, 1.0, [0.3, 0.1, 0.9], "linear")
    np.testing.assert_allclose(explicit, [0.1, 0.3, 0.9])  # sorted


def test_contour_log_handles_nonpositive_floor() -> None:
    # z_min <= 0 -> log floor derives from z_max, must not raise or emit NaN
    lv = _contour_levels(-5.0, 1000.0, 4, "log")
    assert np.all(np.isfinite(lv)) and lv[0] > 0 and lv[-1] == 1000.0


def test_render_rejects_bad_shape_and_kind() -> None:
    x, y, z = _demo_grid()
    with pytest.raises(ValueError, match="z_grid must be"):
        render_map_figure(x, y, z[:, :-1], kind="heatmap")
    with pytest.raises(ValueError, match="kind must be"):
        render_map_figure(x, y, z, kind="bogus")
    with pytest.raises(ValueError, match="fmt must be"):
        render_map_figure(x, y, z, fmt="jpg")


def test_render_rejects_degenerate_grid() -> None:
    # a 1-wide grid is not a map -> clean ValueError, never a matplotlib TypeError
    with pytest.raises(ValueError, match="at least a 2x2 grid"):
        render_map_figure(np.array([1.0]), np.array([1.0, 2.0]),
                          np.array([[1.0], [2.0]]), kind="contourf")


def test_contour_levels_log_all_nonpositive_raises() -> None:
    with pytest.raises(ValueError, match="positive z-range"):
        _contour_levels(-5.0, -1.0, 4, "log")


def test_contour_levels_explicit_list_needs_two() -> None:
    with pytest.raises(ValueError, match="at least 2 entries"):
        _contour_levels(0.0, 1.0, [0.5], "linear")


def test_render_rejects_all_nan_contour() -> None:
    x = np.linspace(0, 1, 5)
    y = np.linspace(0, 1, 4)
    z = np.full((4, 5), np.nan)
    with pytest.raises(ValueError, match="no finite z-range"):
        render_map_figure(x, y, z, kind="contourf")


def test_levels_count_lower_bound() -> None:
    with pytest.raises(ValueError, match="levels count"):
        _contour_levels(0.0, 1.0, 1, "linear")
    with pytest.raises(ValueError, match="level_scale"):
        _contour_levels(0.0, 1.0, 5, "sqrt")


# ── Scattered tri-contour (gap #17 last remaining piece) ────────────────────


@pytest.mark.parametrize("kind", ["contourf", "contour"])
@pytest.mark.parametrize("fmt", ["png", "pdf", "svg"])
def test_points_tricontour_renders(kind: str, fmt: str) -> None:
    x, y, z = _demo_points()
    data = render_map_figure(
        x, y, None, contour_source="points", z_values=z,
        kind=kind, fmt=fmt, title="rsm cloud", x_label="Qx", y_label="Qz",
    )
    assert data[: len(_MAGIC[fmt])] == _MAGIC[fmt]
    assert len(data) > 800


def test_points_level_count_changes_output() -> None:
    # More contour levels -> more drawn paths -> a measurably different (in
    # practice larger) vector file, the same "effect is observable" pattern
    # test_calc_figure.py uses for dpi.
    x, y, z = _demo_points()
    few = render_map_figure(
        x, y, None, contour_source="points", z_values=z, kind="contourf", fmt="svg", levels=3
    )
    many = render_map_figure(
        x, y, None, contour_source="points", z_values=z, kind="contourf", fmt="svg", levels=20
    )
    assert len(few) != len(many)


def test_points_collinear_is_degenerate_value_error() -> None:
    x = np.array([0.0, 1.0, 2.0, 3.0, 4.0])
    y = np.array([0.0, 0.0, 0.0, 0.0, 0.0])  # all collinear -> qhull can't triangulate
    z = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
    with pytest.raises(ValueError, match="degenerate"):
        render_map_figure(x, y, None, contour_source="points", z_values=z, kind="contourf")


def test_points_too_few_finite_points_raises() -> None:
    x = np.array([0.0, 1.0, np.nan, 3.0])
    y = np.array([0.0, 1.0, 2.0, np.nan])
    z = np.array([1.0, 2.0, 3.0, 4.0])
    with pytest.raises(ValueError, match="at least 3 finite points"):
        render_map_figure(x, y, None, contour_source="points", z_values=z, kind="contourf")


def test_points_mismatched_lengths_raises() -> None:
    x, y, z = _demo_points()
    with pytest.raises(ValueError, match="same length"):
        render_map_figure(x, y, None, contour_source="points", z_values=z[:-1], kind="contourf")


def test_points_missing_z_values_raises() -> None:
    x, y, _z = _demo_points()
    with pytest.raises(ValueError, match="z_values is required"):
        render_map_figure(x, y, None, contour_source="points", kind="contourf")


def test_points_kind_restricted_to_contour_kinds() -> None:
    x, y, z = _demo_points()
    for bad_kind in ("heatmap", "surface", "scatter3d", "waterfall"):
        with pytest.raises(ValueError, match="only supports kind"):
            render_map_figure(
                x, y, None, contour_source="points", z_values=z, kind=bad_kind
            )


def test_invalid_contour_source_raises() -> None:
    x, y, z = _demo_grid()
    with pytest.raises(ValueError, match="contour_source must be"):
        render_map_figure(x, y, z, contour_source="bogus")


def test_grid_source_requires_z_grid() -> None:
    x, y, _z = _demo_grid()
    with pytest.raises(ValueError, match="z_grid is required"):
        render_map_figure(x, y, None, kind="contourf")


def test_grid_default_matches_explicit_contour_source() -> None:
    # Regression: contour_source defaults to "grid" -- an un-annotated call
    # (the pre-existing calling convention) must render byte-identically to
    # the same call with contour_source="grid" spelled out explicitly.
    x, y, z = _demo_grid()
    implicit = render_map_figure(x, y, z, kind="contourf", fmt="png")
    explicit = render_map_figure(x, y, z, contour_source="grid", kind="contourf", fmt="png")
    assert implicit == explicit


# ── dpi preset resolution + mirrored box ticks (GAP_TIER3 item 2 follow-up) ─


def test_dpi_none_uses_style_preset_dpi() -> None:
    # dpi=None (the default) resolves to the style's calibrated dpi -- a
    # raster render at the high-dpi 'aps' preset must be a larger PNG than
    # the same map at the low-dpi 'web' preset (mirrors test_calc_figure.py's
    # dpi-scales-raster-output pattern and the corner/ternary/field siblings).
    x, y, z = _demo_grid()
    small = render_map_figure(x, y, z, kind="contourf", fmt="png", style="web", dpi=None)
    large = render_map_figure(x, y, z, kind="contourf", fmt="png", style="aps", dpi=None)
    assert len(large) > len(small)


def test_dpi_explicit_overrides_preset() -> None:
    x, y, z = _demo_grid()
    at_100 = render_map_figure(x, y, z, kind="contourf", fmt="png", dpi=100)
    at_300 = render_map_figure(x, y, z, kind="contourf", fmt="png", dpi=300)
    assert len(at_300) > len(at_100)


@pytest.mark.realdata
def test_scattered_rsm_cloud_from_corpus(corpus_dir: Path) -> None:
    """The tri-contour path's driving case: a real PANalytical snapshot/coupled
    RSM point cloud (io/_xrdml_scan.py), contoured straight off its raw
    (x, y, intensity) columns -- never regridded. Skips when the corpus or a
    matching cloud file is absent (local-only, like the rest of realdata)."""
    from quantized.io.registry import import_auto

    files = sorted((corpus_dir / "panalytical" / "xrd").glob("*.xrdml"))
    if not files:
        pytest.skip("no PANalytical corpus files present")
    for f in files:
        ds = import_auto(str(f))
        if ds.metadata.get("mesh_kind") in ("snapshot", "coupled"):
            break
    else:
        pytest.skip("no snapshot/coupled RSM point cloud in corpus")

    if "Qx" in ds.labels and "Qz" in ds.labels:
        xi, yi = ds.labels.index("Qx"), ds.labels.index("Qz")
    else:
        xi, yi = 0, 1
    zi = ds.labels.index("Intensity")
    x, y, z = ds.values[:, xi], ds.values[:, yi], ds.values[:, zi]
    data = render_map_figure(
        x, y, None, contour_source="points", z_values=z, kind="contourf", fmt="png"
    )
    assert data[:8] == b"\x89PNG\r\n\x1a\n"

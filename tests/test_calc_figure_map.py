"""2-D map publication rendering (calc.figure_map): contour + 3-D export.

Rendering can't be pixel-asserted, so the tests check that every kind/format
produces a valid, non-trivial file (right magic bytes), that level computation
is correct (lin/log/explicit), and that malformed input is rejected.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from quantized.calc.figure_map import (
    MAP_KINDS,
    _contour_levels,  # noqa: PLC2701 (internal, tested directly)
    log_decade_ticks,
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
    for bad_kind in ("heatmap", "surface", "waterfall"):
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


# ── log colour scale: the bar labels decade VALUES, as the canvas does ───────
_LOG_BAR = json.loads(
    (Path(__file__).parent / "fixtures" / "wire" / "map_log_colorbar.json").read_text("utf-8")
)["cases"]


@pytest.mark.parametrize("case", _LOG_BAR, ids=[c["name"] for c in _LOG_BAR])
def test_log_decade_ticks_match_the_canvas_colour_bar(case: dict[str, Any]) -> None:
    ticks = log_decade_ticks(math.log10(case["lo"]), math.log10(case["hi"]))
    assert [label for _k, label in ticks] == case["labels"]


def test_log_colour_bar_exports_values_not_exponents() -> None:
    """MapStage sends log10(z) under a log colour scale; the bar used to read
    -4 … 2 where the canvas reads 1e-4 … 100."""
    x, y, _z = _demo_grid()
    z = np.tile(np.linspace(-4.7, 2.7, x.size), (y.size, 1))  # log10 of 2e-5 … 500
    svg = render_map_figure(
        x, y, z, kind="heatmap", fmt="svg", z_label="I (cps) — log", colorbar_log10=True
    ).decode("utf-8")
    for label in ("1e-4", "0.01", "100"):
        assert f">{label}<" in svg or f"<!-- {label} -->" in svg
    assert "<!-- \N{MINUS SIGN}4 -->" not in svg


# ── static 3-D fail-closed (gap-5 lane F) ───────────────────────────────────


@pytest.mark.parametrize("kind", ["surface", "scatter3d", "waterfall"])
@pytest.mark.parametrize(
    ("elev", "azim"), [(91.0, 0.0), (-91.0, 0.0), (30.0, 400.0), (float("nan"), 0.0)]
)
def test_3d_rejects_out_of_range_view_angles(kind: str, elev: float, azim: float) -> None:
    x, y, z = _demo_grid()
    with pytest.raises(ValueError, match="view_(elev|azim)"):
        render_map_figure(x, y, z, kind=kind, fmt="png", view_elev=elev, view_azim=azim)


def test_3d_view_angles_change_the_picture() -> None:
    x, y, z = _demo_grid()
    a = render_map_figure(x, y, z, kind="surface", fmt="png", view_elev=20.0, view_azim=-60.0)
    b = render_map_figure(x, y, z, kind="surface", fmt="png", view_elev=60.0, view_azim=30.0)
    assert a != b


def test_3d_waterfall_needs_two_curves() -> None:
    x = np.linspace(0.0, 1.0, 5)
    y = np.array([0.0, 1.0])
    z = np.array([[1.0, 2.0, 3.0, 2.0, 1.0], [np.nan, np.nan, np.nan, np.nan, 4.0]])
    with pytest.raises(ValueError, match="at least 2 curves"):
        render_map_figure(x, y, z, kind="waterfall", fmt="png")


def test_3d_too_few_finite_cells_is_refused() -> None:
    x = np.array([0.0, 1.0])
    y = np.array([0.0, 1.0])
    z = np.array([[1.0, np.nan], [np.nan, np.nan]])
    with pytest.raises(ValueError, match="at least 4 finite"):
        render_map_figure(x, y, z, kind="surface", fmt="png")
    with pytest.raises(ValueError, match="at least 3 finite"):
        render_map_figure(x, y, z, kind="scatter3d", fmt="png")


# ── 3-D scatter of RAW points / stepped waterfall rows (gap-5 lane F) ───────


def _capture(monkeypatch: pytest.MonkeyPatch, name: str) -> list[tuple[Any, ...]]:
    from mpl_toolkits.mplot3d import Axes3D

    calls: list[tuple[Any, ...]] = []
    real = getattr(Axes3D, name)

    def spy(self: Any, *a: Any, **kw: Any) -> Any:
        calls.append(a)
        return real(self, *a, **kw)

    monkeypatch.setattr(Axes3D, name, spy)
    return calls


def test_points_scatter3d_plots_exactly_the_source_points(monkeypatch: pytest.MonkeyPatch) -> None:
    x, y, z = _demo_points()
    x[3] = np.nan  # a non-finite row is dropped, nothing else is touched
    calls = _capture(monkeypatch, "scatter")
    data = render_map_figure(
        x, y, None, contour_source="points", z_values=z, kind="scatter3d", fmt="png"
    )
    assert data[:4] == b"\x89PNG"
    keep = np.isfinite(x) & np.isfinite(y) & np.isfinite(z)
    (px, py, pz) = calls[0][:3]
    assert np.array_equal(px, x[keep])
    assert np.array_equal(py, y[keep])
    assert np.array_equal(pz, z[keep])
    assert len(px) == 59  # the raw count, not a resampled grid's


def test_points_scatter3d_validates_angles_and_count() -> None:
    x, y, z = _demo_points()
    with pytest.raises(ValueError, match="view_elev"):
        render_map_figure(x, y, None, contour_source="points", z_values=z, kind="scatter3d",
                          view_elev=95.0)
    with pytest.raises(ValueError, match="at least 3 finite"):
        render_map_figure(x[:2], y[:2], None, contour_source="points", z_values=z[:2],
                          kind="scatter3d")


def test_waterfall_max_lines_steps_rows_and_keeps_the_ends(monkeypatch: pytest.MonkeyPatch) -> None:
    x = np.linspace(0.0, 1.0, 6)
    y = np.linspace(0.0, 99.0, 100)
    z = np.add.outer(y, x)
    calls = _capture(monkeypatch, "plot")
    render_map_figure(x, y, z, kind="waterfall", fmt="png", max_lines=10)
    drawn = [float(c[1][0]) for c in calls]
    assert len(drawn) == 10 and drawn[0] == 0.0 and drawn[-1] == 99.0
    calls.clear()
    render_map_figure(x, y, z, kind="waterfall", fmt="png")  # 0 = every row
    assert len(calls) == 100


# ── review fixes: separate curves, caps, row stepping, log z ticks (lane F) ──


def test_curves_keep_each_polyline_in_original_order(monkeypatch: pytest.MonkeyPatch) -> None:
    # A hysteresis loop: x goes up then back down. No sort, no union, no resample.
    loop_x = [0.0, 1.0, 2.0, 3.0, 2.0, 1.0, 0.0]
    loop_z = [0.0, 1.0, 3.0, 4.0, 3.5, 2.0, 0.5]
    calls = _capture(monkeypatch, "plot")
    curves = [
        {"x": loop_x, "z": loop_z, "depth": 50.0},
        {"x": loop_x, "z": [v + 1 for v in loop_z], "depth": 100.0},
    ]
    data = render_map_figure([], [], None, contour_source="curves", curves=curves,
                             kind="waterfall", fmt="png")
    assert data[:4] == b"\x89PNG"
    assert len(calls) == 2
    for call, c in zip(calls, curves, strict=True):
        assert list(call[0]) == c["x"] and list(call[2]) == c["z"]
        assert set(call[1]) == {c["depth"]}


def test_curves_fail_closed() -> None:
    one = [{"x": [0.0, 1.0], "z": [1.0, 2.0], "depth": 0.0}]
    with pytest.raises(ValueError, match="at least 2 curves"):
        render_map_figure([], [], None, contour_source="curves", curves=one, kind="waterfall")
    two = [*one, {"x": [0.0, 1.0], "z": [3.0, 4.0], "depth": 1.0}]
    with pytest.raises(ValueError, match="only supports kind 'waterfall'"):
        render_map_figure([], [], None, contour_source="curves", curves=two, kind="surface")
    bad = [*one, {"x": [0.0, 1.0], "z": [3.0], "depth": 1.0}]
    with pytest.raises(ValueError, match="same length"):
        render_map_figure([], [], None, contour_source="curves", curves=bad, kind="waterfall")
    nan = [*one, {"x": [0.0, 1.0], "z": [3.0, 4.0], "depth": float("nan")}]
    with pytest.raises(ValueError, match="depth must be a finite"):
        render_map_figure([], [], None, contour_source="curves", curves=nan, kind="waterfall")
    with pytest.raises(ValueError, match="view_elev"):
        render_map_figure([], [], None, contour_source="curves", curves=two, kind="waterfall",
                          view_elev=120.0)


def test_scatter3d_cloud_is_sampled_to_the_cap(monkeypatch: pytest.MonkeyPatch) -> None:
    from quantized.calc.figure_map3d import MAX_SCATTER_POINTS

    n = 120_000
    x = np.arange(n, dtype=float)
    calls = _capture(monkeypatch, "scatter")
    render_map_figure(x, x * 0.5, None, contour_source="points", z_values=np.sin(x),
                      kind="scatter3d", fmt="png")
    px = calls[0][0]
    assert len(px) == MAX_SCATTER_POINTS
    assert px[0] == 0.0 and px[-1] == n - 1 and np.all(np.diff(px) > 0)  # ends kept, order kept


def test_scatter3d_of_a_big_grid_is_sampled_too(monkeypatch: pytest.MonkeyPatch) -> None:
    from quantized.calc.figure_map3d import MAX_SCATTER_POINTS

    x = np.linspace(0.0, 1.0, 300)
    z = np.add.outer(x, x)  # 90,000 finite cells
    calls = _capture(monkeypatch, "scatter")
    render_map_figure(x, x, z, kind="scatter3d", fmt="png")
    assert len(calls[0][0]) == MAX_SCATTER_POINTS


def test_waterfall_steps_only_rows_that_have_data(monkeypatch: pytest.MonkeyPatch) -> None:
    x = np.linspace(0.0, 1.0, 6)
    y = np.arange(100.0)
    z = np.full((100, 6), np.nan)
    z[1] = np.arange(6.0)
    z[2] = np.arange(6.0) + 1
    calls = _capture(monkeypatch, "plot")
    render_map_figure(x, y, z, kind="waterfall", fmt="png", max_lines=10)
    assert [float(c[1][0]) for c in calls] == [1.0, 2.0]  # not 10 mostly-empty rows


def test_3d_log_colour_scale_labels_the_z_axis_by_value(monkeypatch: pytest.MonkeyPatch) -> None:
    from mpl_toolkits.mplot3d import Axes3D

    seen: list[list[str]] = []
    real = Axes3D.set_zticks

    def spy(self: Any, ticks: Any, labels: Any = None, **kw: Any) -> Any:
        seen.append(list(labels or []))
        return real(self, ticks, labels=labels, **kw)

    monkeypatch.setattr(Axes3D, "set_zticks", spy)
    x, y, z = _demo_grid()
    render_map_figure(x, y, np.log10(np.maximum(z, 1e-3) * 1e3), kind="surface", fmt="png",
                      colorbar_log10=True)
    assert seen and all(not lab.startswith("-") for lab in seen[0])
    assert any(lab in {"1", "10", "100", "1000", "1e3", "1e4"} for lab in seen[0])


def test_3d_refuses_values_too_large_to_draw() -> None:
    x = np.array([0.0, 1.0, 2.0])
    z = np.array([[1e308, 1.0, 2.0], [3.0, 4.0, 5.0], [1.0, 2.0, 3.0]])
    with pytest.raises(ValueError, match=r"beyond \+/-1e100"):
        render_map_figure(x, x, z, kind="surface", fmt="png")


def test_raw_scatter_with_too_few_points_has_a_scatter_message() -> None:
    with pytest.raises(ValueError, match="3-D scatter needs at least 3"):
        render_map_figure([0.0, 1.0], [0.0, 1.0], None, contour_source="points",
                          z_values=[1.0, 2.0], kind="scatter3d")

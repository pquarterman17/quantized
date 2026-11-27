"""Plan item 24: the group shapes, screen == export, pinned by a SHARED wire fixture
(``tests/fixtures/wire/group_shapes.json``).

One backend computation (``calc.figure_overlays``) feeds both the live plot (through
``POST /api/plot/overlays``) and the matplotlib export. This test asserts (1) the
computation still yields the fixture's hull vertices, ellipse parameters and legend
words, and (2) the REAL export draws exactly those vertices and words. The vitest
half (``plotOverlaysDraw.groupShapes.test.ts``) asserts the canvas draws the same
fixture's vertices and key rows.

Regenerate only after a DELIBERATE rule change: ``QZ_WRITE_WIRE=1 pytest <this file>``.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from quantized.calc.figure_overlays import series_overlays, validate_overlay_spec

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "group_shapes.json"


def _inputs() -> tuple[list[float], list[dict[str, Any]]]:
    """Five groups sharing one X column (a grouped scatter: a blank is another group's row)."""
    rng = np.random.default_rng(24)
    groups: list[list[tuple[float, float]]] = []
    for cx, cy, n in ((2.0, 3.0, 9), (6.0, 7.0, 8), (9.0, 2.0, 10)):
        px = rng.normal(cx, 0.9, n)
        py = 0.5 * (px - cx) + cy + rng.normal(0.0, 0.5, n)
        groups.append(
            [(round(float(a), 3), round(float(b), 3)) for a, b in zip(px, py, strict=True)]
        )
    groups.append([(1.0, 8.0), (2.0, 9.0)])  # two points: no hull, no ellipse
    groups.append([(3.0, 5.0), (4.0, 6.0), (5.0, 7.0), (6.0, 8.0), (7.0, 9.0)])  # collinear
    xs: list[float] = []
    ys: list[list[float | None]] = [[] for _ in groups]
    for g, pts in enumerate(groups):
        for px, py in pts:
            xs.append(px)
            for k in range(len(groups)):
                ys[k].append(py if k == g else None)
    names = ["A", "B", "C", "two points", "collinear"]
    return xs, [{"label": n, "y": y} for n, y in zip(names, ys, strict=True)]


CASES: dict[str, dict[str, Any]] = {
    "hull_centroid_mean_ellipse": {
        "centroid": True,
        "hull": True,
        "ellipse": {"level": 0.95, "kind": "mean"},
    },
    "data_ellipse_99": {"ellipse": {"level": 0.99, "kind": "data"}, "hull": True},
}


def _compute(spec: dict[str, Any]) -> list[dict[str, Any]]:
    xs, series = _inputs()
    out = series_overlays([(s["label"], s["y"]) for s in series], xs, validate_overlay_spec(spec))
    result: list[dict[str, Any]] = json.loads(json.dumps(out))
    return result


def _build() -> dict[str, Any]:
    xs, series = _inputs()
    return {
        "x": xs,
        "series": series,
        "cases": {name: {"spec": spec, "expected": _compute(spec)} for name, spec in CASES.items()},
    }


def _fixture() -> dict[str, Any]:
    if os.environ.get("QZ_WRITE_WIRE"):
        FIXTURE.write_text(json.dumps(_build(), indent=1) + "\n", encoding="utf-8", newline="\n")
    data: dict[str, Any] = json.loads(FIXTURE.read_text(encoding="utf-8"))
    return data


def _close(a: Any, b: Any, path: str = "") -> None:
    if isinstance(b, dict):
        assert set(a) == set(b), path
        for k in b:
            _close(a[k], b[k], f"{path}.{k}")
    elif isinstance(b, list):
        assert len(a) == len(b), path
        for i, (u, v) in enumerate(zip(a, b, strict=True)):
            _close(u, v, f"{path}[{i}]")
    elif isinstance(b, float):
        assert a == pytest.approx(b, rel=1e-9, abs=1e-9), path
    else:
        assert a == b, path


def test_fixture_inputs_are_current() -> None:
    fx = _fixture()
    xs, series = _inputs()
    assert fx["x"] == xs and fx["series"] == series


@pytest.mark.parametrize("case", list(CASES))
def test_backend_reproduces_the_fixture(case: str) -> None:
    fx = _fixture()["cases"][case]
    _close(_compute(fx["spec"]), fx["expected"])


def test_the_fixture_pins_the_edge_cases() -> None:
    cases = _fixture()["cases"]
    a, b, c, two, line = cases["hull_centroid_mean_ellipse"]["expected"]
    assert not a["hull"]["degenerate"] and a["hull"]["n_vertices"] >= 3
    major, minor = a["ellipse"]["semi_axes"]
    assert a["ellipse"]["kind"] == "mean" and major >= minor
    assert set(two["refused"]) == {"hull", "ellipse"} and "at least 3" in two["refused"]["hull"]
    assert "centroid" in two
    assert line["hull"]["degenerate"] and "degenerate" in line["hull"]["label"]
    assert "straight line" in line["refused"]["ellipse"]
    assert b["centroid"]["n"] == 8 and c["centroid"]["n"] == 10
    data = cases["data_ellipse_99"]["expected"]
    assert data[0]["ellipse"]["kind"] == "data" and data[0]["ellipse"]["level"] == 0.99
    assert "at least 5" in data[3]["refused"]["ellipse"]


def _export(spec: dict[str, Any]) -> tuple[Any, list[str]]:
    import matplotlib

    matplotlib.use("Agg")
    from matplotlib.figure import Figure

    from quantized.calc.figure_overlays_draw import apply_overlays

    fx = _fixture()
    xs = np.array(fx["x"], dtype=float)
    series = [
        (s["label"], np.array([np.nan if v is None else v for v in s["y"]], dtype=float))
        for s in fx["series"]
    ]
    ax = Figure().add_subplot()
    artists = [ax.plot(xs, y, linestyle="none", marker="o")[0] for _, y in series]
    apply_overlays(ax, xs, series, None, {"overlays": spec}, artists, "linear", "linear")
    legend = [t.get_text() for leg in ax.artists for t in leg.get_texts()]
    return ax, legend


def test_export_draws_the_fixture_vertices_and_words() -> None:
    fx = _fixture()["cases"]["hull_centroid_mean_ellipse"]
    ax, legend = _export(fx["spec"])
    polys = [np.asarray(p.get_xy()) for p in ax.patches]
    expected = fx["expected"]
    # Each group's hull ring (closed) and ellipse outline are filled polygons, in group order.
    want: list[np.ndarray] = []
    for res in expected:
        if "hull" in res and not res["hull"]["degenerate"]:
            want.append(np.column_stack([res["hull"]["x"], res["hull"]["y"]]))
        if "ellipse" in res:
            want.append(np.column_stack([res["ellipse"]["x"], res["ellipse"]["y"]]))
    assert len(polys) == len(want)
    for got, exp in zip(polys, want, strict=True):
        # matplotlib appends its own closing vertex to a polygon.
        assert got[: len(exp)] == pytest.approx(exp, abs=1e-9)
    # The degenerate hull is a drawn segment between the fixture's two end points.
    seg = expected[4]["hull"]
    assert any(
        len(ln.get_xdata()) == 2
        and np.allclose(ln.get_xdata(), seg["x"])
        and np.allclose(ln.get_ydata(), seg["y"])
        for ln in ax.lines
    )
    # The centroid markers sit at the fixture's centroids.
    marks = {
        (round(float(ln.get_xdata()[0]), 9), round(float(ln.get_ydata()[0]), 9))
        for ln in ax.lines
        if ln.get_marker() == "P"
    }
    for res in expected:
        if "centroid" in res:
            c = res["centroid"]
            assert (round(c["x"][0], 9), round(c["y"][0], 9)) in marks
    # Legend words are the fixture's labels (prefixed with the group when several are drawn).
    for res in expected:
        for kind in ("hull", "ellipse", "centroid"):
            if kind in res:
                assert f"{res['label']}: {res[kind]['label']}" in legend
        for kind, why in res["refused"].items():
            assert f"{res['label']}: {kind} not drawn: {why}" in legend


def test_export_ellipse_styles_differ_by_kind() -> None:
    fx = _fixture()["cases"]
    ax, _ = _export(fx["data_ellipse_99"]["spec"])
    assert any(p.get_linestyle() == ":" for p in ax.patches)
    ax2, _ = _export(fx["hull_centroid_mean_ellipse"]["spec"])
    assert any(p.get_linestyle() == (0, (6, 3)) for p in ax2.patches)


def test_render_figure_names_the_shapes_in_a_real_svg() -> None:
    from quantized.calc.figure import render_figure

    fx = _fixture()
    xs = np.array(fx["x"], dtype=float)
    series = [
        (s["label"], np.array([np.nan if v is None else v for v in s["y"]], dtype=float))
        for s in fx["series"][:3]
    ]
    spec = fx["cases"]["hull_centroid_mean_ellipse"]["spec"]
    out = render_figure(xs, series, fmt="svg", overrides={"overlays": spec})
    text = out.decode() if isinstance(out, bytes) else str(out)
    for word in ("Convex hull", "mean confidence ellipse", "Centroid"):
        assert word in text

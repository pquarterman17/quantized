"""Scatter overlays (gap audit 8, SCAT): calc, route and export parity."""

from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import create_app
from quantized.calc.figure import render_figure
from quantized.calc.figure_overlays import compute_overlays, validate_overlay_spec

ALL = {
    "line": {"band": "confidence", "level": 0.95},
    "smoother": {"span": 0.5},
    "ellipse": {"level": 0.95},
}


def _data(n: int = 60) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(3)
    x = rng.uniform(0, 10, n)
    return x, 2.0 * x + 1.0 + rng.normal(0, 1.0, n)


def test_line_matches_polyfit_and_names_itself() -> None:
    x, y = _data()
    res = compute_overlays(x, y, validate_overlay_spec(ALL))
    slope, intercept = np.polyfit(x, y, 1)
    line = res["line"]
    assert line["slope"] == pytest.approx(slope)
    assert line["intercept"] == pytest.approx(intercept)
    assert "Line of fit: y = " in line["label"] and "n = 60" in line["label"]
    assert line["band"]["label"] == "95% confidence band"
    assert np.all(np.array(line["band"]["lo"]) < np.array(line["y"]))
    assert res["refused"] == {}


def test_prediction_band_wider_than_confidence() -> None:
    x, y = _data()
    ci = compute_overlays(x, y, validate_overlay_spec({"line": {"band": "confidence"}}))["line"][
        "band"
    ]
    pi = compute_overlays(x, y, validate_overlay_spec({"line": {"band": "prediction"}}))["line"][
        "band"
    ]
    assert np.all(np.array(pi["hi"]) > np.array(ci["hi"]))


def test_ellipse_is_centred_and_scales_with_level() -> None:
    x, y = _data()
    e68 = compute_overlays(x, y, {"ellipse": {"level": 0.68}})["ellipse"]
    e95 = compute_overlays(x, y, {"ellipse": {"level": 0.95}})["ellipse"]
    assert np.mean(e95["x"][:-1]) == pytest.approx(x.mean(), abs=1e-9)
    assert np.ptp(e95["x"]) > np.ptp(e68["x"])
    assert e95["label"].startswith("95% data ellipse")


def test_smoother_follows_curvature() -> None:
    x = np.linspace(0, 6, 80)
    res = compute_overlays(x, np.sin(x), {"smoother": {"span": 0.3}})["smoother"]
    assert np.max(np.abs(np.array(res["y"]) - np.sin(np.array(res["x"])))) < 0.1


def test_too_few_points_refused_not_fitted() -> None:
    res = compute_overlays([1, 2], [1, 2], validate_overlay_spec(ALL))
    assert set(res["refused"]) == {"line", "smoother", "ellipse"}
    assert "line" not in res and "at least 3" in res["refused"]["line"]


def test_blank_cells_are_dropped_and_infinity_refuses() -> None:
    x, y = _data(10)
    y_blank = y.tolist()
    y_blank[0] = None
    assert compute_overlays(x, y_blank, {"line": {"band": "none", "level": 0.9}})["line"]["n"] == 9
    y_inf = y.tolist()
    y_inf[3] = float("inf")
    res = compute_overlays(x, y_inf, validate_overlay_spec(ALL))
    assert (
        set(res["refused"]) == {"line", "smoother", "ellipse"}
        and "infinite" in res["refused"]["line"]
    )


def test_constant_x_and_collinear_points_refused() -> None:
    assert (
        "line" in compute_overlays([1.0] * 9, list(range(9)), validate_overlay_spec(ALL))["refused"]
    )
    xs = np.arange(12.0)
    res = compute_overlays(xs, 3 * xs, validate_overlay_spec({"ellipse": {}}))
    assert "straight line" in res["refused"]["ellipse"]


def test_smoother_refused_beyond_its_point_cap() -> None:
    x = np.arange(5001.0)
    res = compute_overlays(x, x % 7, validate_overlay_spec({"smoother": {}}))
    assert "smoother" not in res and "5000" in res["refused"]["smoother"]


def test_bad_spec_is_an_error() -> None:
    for bad in (
        {"line": {"band": "wide"}},
        {"ellipse": {"level": 1.5}},
        {"smoother": {"span": 0}},
        [1],
    ):
        with pytest.raises(ValueError):
            validate_overlay_spec(bad)
    assert validate_overlay_spec(None) == {} and validate_overlay_spec({"line": None}) == {}


def test_route_returns_per_series_results_and_refusals() -> None:
    x, y = _data(20)
    body = {
        "x": x.tolist(),
        "series": [{"label": "A", "y": y.tolist()}, {"label": "B", "y": [None] * 19 + [1.0]}],
        "overlays": {"line": {"band": "none"}},
    }
    r = TestClient(create_app()).post("/api/plot/overlays", json=body)
    assert r.status_code == 200
    a, b = r.json()["series"]
    assert a["line"]["n"] == 20 and "line" in b["refused"]
    bad = TestClient(create_app()).post(
        "/api/plot/overlays", json={**body, "overlays": {"line": {"band": "x"}}}
    )
    assert bad.status_code == 422


def _svg(overrides: dict | None, **kw: object) -> str:
    x, y = _data(40)
    out = render_figure(x, [("sample", y)], fmt="svg", overrides=overrides, **kw)  # type: ignore[arg-type]
    return out.decode() if isinstance(out, bytes) else str(out)


def test_export_draws_overlays_and_names_them() -> None:
    off = _svg(None)
    on = _svg({"overlays": ALL})
    assert "Line of fit" not in off and "data ellipse" not in off
    for text in ("Line of fit", "LOWESS smoother", "data ellipse", "confidence band"):
        assert text in on
    assert len(on) > len(off)


def test_export_names_a_refused_overlay_instead_of_drawing_it() -> None:
    out = render_figure(
        np.array([1.0, 2.0]),
        [("s", np.array([1.0, 2.0]))],
        fmt="svg",
        overrides={"overlays": {"line": {}}},
    )
    text = out.decode() if isinstance(out, bytes) else str(out)
    assert "line not drawn" in text and "at least 3" in text


def test_export_refuses_log_axis_and_exchange() -> None:
    with pytest.raises(ValueError, match="linear"):
        _svg({"overlays": ALL}, x_scale="log")
    with pytest.raises(ValueError, match="exchange"):
        _svg({"overlays": ALL, "exchange_xy": True})


def test_smoother_cap_is_shared_by_the_curves_of_one_request() -> None:
    from quantized.calc.figure_overlays import SMOOTHER_MAX_POINTS, series_overlays

    x = np.arange(3000.0)
    spec = validate_overlay_spec({"smoother": {}})
    first, second = series_overlays([("A", x % 7), ("B", x % 5)], x, spec)
    assert first["smoother"]["n"] == 3000
    assert "smoother" not in second and str(SMOOTHER_MAX_POINTS) in second["refused"]["smoother"]
    assert "2000 left" in second["refused"]["smoother"]


def test_export_overlays_do_not_widen_the_final_limits() -> None:
    import matplotlib

    matplotlib.use("Agg")
    from matplotlib.figure import Figure

    from quantized.calc.figure_overlays_draw import apply_overlays

    x, y = _data(40)
    ax = Figure().add_subplot()
    line = ax.plot(x, y)[0]
    before = (ax.get_xlim(), ax.get_ylim())
    ov = {"overlays": {"ellipse": {"level": 0.99}, "line": {"band": "prediction"}}}
    apply_overlays(ax, x, [("s", y)], None, ov, [line], "linear", "linear")
    assert (ax.get_xlim(), ax.get_ylim()) == before


def test_export_refuses_horizontal_bars_and_x_breaks() -> None:
    styles = [{"bars": "horizontal"}]
    with pytest.raises(ValueError, match="horizontal bars"):
        _svg({"overlays": ALL}, series_styles=styles)
    assert _svg(None, series_styles=styles)  # the bars alone still export
    with pytest.raises(ValueError, match="x_breaks"):
        _svg({"overlays": ALL, "x_breaks": [[4.0, 5.0]]})

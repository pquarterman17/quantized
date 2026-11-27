"""What the plot's curve-measurement gadget sends, checked against numpy by hand.

The gadget clips both curves to the ROI band (its rows, in the curve's own X),
sends them to /api/curve-measure, and draws markers from the answer: a ring at
every crossing (x, y) and guides at the levels. These tests clip the same way
and compare every number the gadget shows with an independent numpy
computation (a sign-change scan with the linear-interpolation formula; a ramp
whose 10/90 and 20/80 positions are known in closed form), plus the Origin
oracle fixtures `intersect` and `levelcrossing` through the same ROI clip
(skipped when the private corpus is absent).
"""

from __future__ import annotations

import csv
import json
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient


def _roi(x: np.ndarray, *ys: np.ndarray, lo: float, hi: float) -> list[np.ndarray]:
    keep = (x >= lo) & (x <= hi)
    return [x[keep], *[y[keep] for y in ys]]


def _numpy_crossings(x: np.ndarray, y: np.ndarray, level: float) -> list[float]:
    """Every sign change of y - level, positioned by linear interpolation."""
    d = y - level
    out = []
    for k in np.flatnonzero(d[:-1] * d[1:] < 0):
        out.append(x[k] + (level - y[k]) * (x[k + 1] - x[k]) / (y[k + 1] - y[k]))
    return out


def test_level_crossings_in_a_roi_match_numpy(client: TestClient) -> None:
    x = np.linspace(0.0, 12.0, 1201)
    y = np.sin(x)
    xr, yr = _roi(x, y, lo=2.0, hi=9.0)
    level = 0.25
    r = client.post(
        "/api/curve-measure/level-crossings",
        json={"x": xr.tolist(), "y": yr.tolist(), "level": level},
    )
    assert r.status_code == 200, r.text
    got = r.json()
    np.testing.assert_allclose(
        [c["x"] for c in got["crossings"]], _numpy_crossings(xr, yr, level), atol=1e-12
    )
    assert got["level"] == level
    # The ring the gadget draws sits on the curve at its crossing.
    for c in got["crossings"]:
        assert np.interp(c["x"], xr, yr) == pytest.approx(level, abs=1e-12)
    # Closed form: falling at pi - asin(0.25), rising at 2 pi + asin(0.25);
    # the next falling one (9.17) is outside [2, 9].
    assert [c["direction"] for c in got["crossings"]] == ["falling", "rising"]
    np.testing.assert_allclose(
        [c["x"] for c in got["crossings"]],
        [np.pi - np.arcsin(0.25), 2 * np.pi + np.arcsin(0.25)],
        atol=1e-4,
    )


def test_mid_range_level_is_the_regions_own_midpoint(client: TestClient) -> None:
    """An empty level in the chip means (min + max) / 2 of the rows in the ROI."""
    x = np.linspace(0.0, 12.0, 1201)
    y = 3.0 * np.sin(x) + 1.0
    xr, yr = _roi(x, y, lo=0.0, hi=9.0)
    level = (float(yr.min()) + float(yr.max())) / 2.0
    assert level == pytest.approx((yr.max() + yr.min()) / 2.0, abs=0)
    r = client.post(
        "/api/curve-measure/level-crossings",
        json={"x": xr.tolist(), "y": yr.tolist(), "level": level},
    )
    np.testing.assert_allclose(
        [c["x"] for c in r.json()["crossings"]], _numpy_crossings(xr, yr, level), atol=1e-12
    )


def test_intersect_in_a_roi_matches_numpy_and_the_ring_is_on_both_curves(
    client: TestClient,
) -> None:
    x = np.linspace(0.0, 10.0, 2001)
    a, b = np.sin(x), np.cos(x)
    xr, ar, br = _roi(x, a, b, lo=2.0, hi=9.0)
    body = {"x1": xr.tolist(), "y1": ar.tolist(), "x2": xr.tolist(), "y2": br.tolist()}
    got = client.post("/api/curve-measure/intersect", json=body).json()["intersections"]
    np.testing.assert_allclose(
        [p["x"] for p in got], _numpy_crossings(xr, ar - br, 0.0), atol=1e-12
    )
    for p in got:
        assert p["y"] == pytest.approx(float(np.interp(p["x"], xr, ar)), abs=1e-9)
        assert p["y"] == pytest.approx(float(np.interp(p["x"], xr, br)), abs=1e-9)
    # sin = cos at pi/4 + k pi: 3.93 and 7.07 lie in [2, 9] (to the sampling of the grid).
    np.testing.assert_allclose([p["x"] for p in got], [5 * np.pi / 4, 9 * np.pi / 4], atol=1e-5)


def test_intersect_against_a_curve_of_another_worksheet(client: TestClient) -> None:
    """Curve B has its own X (another worksheet): the crossing is still exact."""
    xa = np.linspace(0.0, 4.0, 401)
    xb = np.linspace(0.0, 4.0, 97)
    ya = xa  # y = x
    yb = 4.0 - xb  # y = 4 - x, meets at (2, 2)
    got = client.post(
        "/api/curve-measure/intersect",
        json={"x1": xa.tolist(), "y1": ya.tolist(), "x2": xb.tolist(), "y2": yb.tolist()},
    ).json()["intersections"]
    assert len(got) == 1
    assert got[0]["x"] == pytest.approx(2.0, abs=1e-9)
    assert got[0]["y"] == pytest.approx(2.0, abs=1e-9)


def _ramp() -> tuple[np.ndarray, np.ndarray]:
    """0 until x = 2, a ramp to 10 at x = 4, then flat: 20 % / 80 % are at 2.4 and 3.6."""
    x = np.arange(0.0, 6.0001, 0.25)
    y = np.interp(x, [0.0, 2.0, 4.0, 6.0], [0.0, 0.0, 10.0, 10.0])
    return x, y


@pytest.mark.parametrize(
    ("lo", "hi", "t_lo", "t_hi"),
    [(0.1, 0.9, 2.2, 3.8), (0.2, 0.8, 2.4, 3.6), (0.25, 0.75, 2.5, 3.5)],
)
def test_rise_time_presets_match_the_closed_form(
    client: TestClient, lo: float, hi: float, t_lo: float, t_hi: float
) -> None:
    x, y = _ramp()
    r = client.post(
        "/api/curve-measure/step-time",
        json={
            "x": x.tolist(),
            "y": y.tolist(),
            "low_fraction": lo,
            "high_fraction": hi,
            "edge": "auto",
        },
    ).json()
    assert r["edge"] == "rise"
    assert r["x_low"] == pytest.approx(t_lo, abs=1e-12)
    assert r["x_high"] == pytest.approx(t_hi, abs=1e-12)
    assert r["time"] == pytest.approx(t_hi - t_lo, abs=1e-12)
    # The guides the gadget draws are the two measured levels of the 0..10 step.
    assert r["low_level"] == pytest.approx(10.0 * lo, abs=1e-12)
    assert r["high_level"] == pytest.approx(10.0 * hi, abs=1e-12)
    assert np.interp(r["x_low"], x, y) == pytest.approx(r["low_level"], abs=1e-12)


def test_rise_time_with_fixed_reference_levels(client: TestClient) -> None:
    """Given levels replace the plateau estimate; a high level of 20 is never reached."""
    x, y = _ramp()
    ok = client.post(
        "/api/curve-measure/step-time",
        json={
            "x": x.tolist(),
            "y": y.tolist(),
            "low_level": 0.0,
            "high_level": 10.0,
            "low_fraction": 0.2,
            "high_fraction": 0.8,
        },
    ).json()
    assert ok["plateaus_estimated"] == [False, False]
    assert ok["time"] == pytest.approx(1.2, abs=1e-12)
    far = client.post(
        "/api/curve-measure/step-time",
        json={"x": x.tolist(), "y": y.tolist(), "low_level": 0.0, "high_level": 20.0},
    )
    assert far.status_code == 422  # the ramp never reaches 18: refused, not a wrong time


def _fixture(corpus: Path, name: str) -> tuple[np.ndarray, dict]:  # type: ignore[type-arg]
    folder = corpus / "origin" / "analysis_oracle" / name
    if not (folder / "input.csv").is_file():
        pytest.skip(f"{folder} not present")
    with (folder / "input.csv").open(encoding="utf-8") as fh:
        rows = np.array([[float(v) for v in r] for r in list(csv.reader(fh))[1:]])
    return rows, json.loads((folder / "truth.json").read_text(encoding="utf-8"))


@pytest.mark.realdata
def test_origin_levelcrossing_fixture_through_a_roi(client: TestClient, corpus_dir: Path) -> None:
    rows, truth = _fixture(corpus_dir, "levelcrossing")
    planted = np.array(truth["planted"]["crossings_x"])
    lo, hi = float(planted[1]) - 0.5, float(planted[4]) + 0.5  # a band holding crossings 2..5
    xr, yr = _roi(rows[:, 0], rows[:, 1], lo=lo, hi=hi)
    got = client.post(
        "/api/curve-measure/level-crossings",
        json={"x": xr.tolist(), "y": yr.tolist(), "level": truth["planted"]["level"]},
    ).json()["crossings"]
    assert [c["x"] for c in got] == pytest.approx(planted[1:5].tolist(), abs=0.05)


@pytest.mark.realdata
def test_origin_intersect_fixture_through_a_roi(client: TestClient, corpus_dir: Path) -> None:
    rows, truth = _fixture(corpus_dir, "intersect")
    planted = np.array(truth["planted"]["crossings_x"])
    lo, hi = float(planted[0]) - 0.5, float(planted[1]) + 0.5
    xr, a, b = _roi(rows[:, 0], rows[:, 1], rows[:, 2], lo=lo, hi=hi)
    got = client.post(
        "/api/curve-measure/intersect",
        json={"x1": xr.tolist(), "y1": a.tolist(), "x2": xr.tolist(), "y2": b.tolist()},
    ).json()["intersections"]
    assert [p["x"] for p in got] == pytest.approx(planted[:2].tolist(), abs=0.05)

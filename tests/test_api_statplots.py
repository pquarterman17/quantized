"""Integration tests for /api/statplots (TestClient). Math is golden in
test_calc_statplots; here we prove transport + serialization + validation."""

from __future__ import annotations

from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)


def test_box_roundtrip_and_fliers() -> None:
    resp = client.post(
        "/api/statplots/box",
        json={"groups": [[1, 2, 3, 4, 5, 6, 7, 8, 9, 100], [2, 3, 4, 5]],
              "labels": ["A", "B"]},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["n_groups"] == 2
    assert body["boxes"][0]["fliers"] == [100.0]
    assert body["boxes"][0]["label"] == "A"


def test_violin_roundtrip() -> None:
    resp = client.post(
        "/api/statplots/violin",
        json={"data": [1.0, 2.0, 2.5, 3.0, 3.5, 4.0, 5.0, 6.0], "n_points": 64},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["x"]) == 64 and len(body["density"]) == 64
    assert body["bandwidth"] > 0


def test_violin_constant_data_422() -> None:
    resp = client.post("/api/statplots/violin", json={"data": [3.0, 3.0, 3.0]})
    assert resp.status_code == 422


def test_violin_extreme_bw_method_is_422_not_500() -> None:
    """Regression: an absurd (but finite) bw_method scale factor drives
    scipy.stats.gaussian_kde's covariance scaling to OverflowError, which the
    route's old `except (ValueError, IndexError)` did not catch."""
    resp = client.post(
        "/api/statplots/violin",
        json={"data": [1.0, 2.0, 3.0, 4.0, 5.0], "bw_method": 1e300},
    )
    assert resp.status_code == 422, resp.text


def test_violin_singular_bw_method_is_422_with_ascii_detail() -> None:
    """bw_method=0.0 collapses gaussian_kde's covariance to a singular
    matrix, raising numpy.linalg.LinAlgError. It happens to subclass
    ValueError in the numpy version this repo pins (see
    test_routes_errors.py::test_calc_errors_includes_linalg_error), so this
    already returns 422 today -- this test anchors that outcome end-to-end
    and checks the detail text is ASCII."""
    resp = client.post(
        "/api/statplots/violin",
        json={"data": [1.0, 2.0, 3.0, 4.0, 5.0], "bw_method": 0.0},
    )
    assert resp.status_code == 422, resp.text
    detail = resp.json()["detail"]
    assert all(ord(c) < 128 for c in detail), detail


def test_qq_roundtrip() -> None:
    data = [(-2.0), -1.0, -0.5, 0.0, 0.3, 0.7, 1.1, 2.0, 1.5, -1.2]
    resp = client.post("/api/statplots/qq", json={"data": data})
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["theoretical_quantiles"]) == len(data)
    assert 0.0 <= body["r_squared"] <= 1.0


def test_histogram_roundtrip_with_fit() -> None:
    data = [float(x) for x in range(50)]
    resp = client.post(
        "/api/statplots/histogram",
        json={"data": data, "bins": "sturges", "fit": "norm"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["n_bins"] >= 1
    assert sum(body["counts"]) == 50
    assert body["fit"]["dist"] == "norm" and len(body["fit"]["pdf"]) == 256


def test_violin_rejects_absurd_n_points_without_hanging() -> None:
    """Regression: calc.statplots.violin_kde evaluates gaussian_kde at
    n_points grid locations; n_points=1e9 used to wedge the worker thread
    forever. Bounded by Field(ge=1, le=100_000) it must reject fast."""
    import threading

    box: dict[str, object] = {}

    def call() -> None:
        r = client.post(
            "/api/statplots/violin",
            json={"data": [1.0, 2.0, 3.0, 4.0, 5.0], "n_points": 1_000_000_000},
        )
        box["status"] = r.status_code

    t = threading.Thread(target=call, daemon=True)
    t.start()
    t.join(30.0)
    assert not t.is_alive(), "POST /api/statplots/violin with n_points=1e9 never returned"
    assert box.get("status") == 422


def test_histogram_rejects_absurd_bins_without_hanging() -> None:
    """Regression: calc.statplots.histogram passes an int `bins` straight to
    np.histogram, which allocates `bins + 1` edges; bins=1e9 used to wedge
    the worker thread forever. Bounded by Field(ge=1, le=100_000) it must
    reject fast."""
    import threading

    box: dict[str, object] = {}

    def call() -> None:
        r = client.post(
            "/api/statplots/histogram",
            json={"data": [float(x) for x in range(50)], "bins": 1_000_000_000},
        )
        box["status"] = r.status_code

    t = threading.Thread(target=call, daemon=True)
    t.start()
    t.join(30.0)
    assert not t.is_alive(), "POST /api/statplots/histogram with bins=1e9 never returned"
    assert box.get("status") == 422

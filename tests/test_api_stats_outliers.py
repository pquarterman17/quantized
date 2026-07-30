"""Integration tests for /api/stats outlier-screening endpoints (TestClient).

Math is golden in test_calc_stats_outliers; here we prove the transport +
422-on-ValueError contract (routes/stats_outliers.py, JMP_GAP_PLAN J9).
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)

_ROSNER_EXAMPLE = [
    -0.25, 0.68, 0.94, 1.15, 1.20, 1.26, 1.26, 1.34, 1.38, 1.43,
    1.49, 1.49, 1.55, 1.56, 1.58, 1.65, 1.69, 1.70, 1.76, 1.77,
    1.81, 1.91, 1.94, 1.96, 1.99, 2.06, 2.09, 2.10, 2.14, 2.15,
    2.23, 2.24, 2.26, 2.35, 2.37, 2.40, 2.47, 2.54, 2.62, 2.64,
    2.90, 2.92, 2.92, 2.93, 3.21, 3.26, 3.30, 3.59, 3.68, 4.30,
    4.64, 5.34, 5.42, 6.01,
]


def test_grubbs_roundtrip_flags_the_outlier() -> None:
    x = [199.31, 199.53, 200.19, 200.82, 201.92, 201.95, 202.18, 245.57]
    resp = client.post("/api/stats/grubbs", json={"x": x})
    assert resp.status_code == 200
    out = resp.json()
    assert out["flagged"] is True
    assert out["index"] == 7
    assert abs(out["G"] - 2.469) < 1e-3


def test_grubbs_too_few_points_is_422_not_500() -> None:
    resp = client.post("/api/stats/grubbs", json={"x": [1.0, 2.0]})
    assert resp.status_code == 422


def test_rosner_nist_worked_example_roundtrip() -> None:
    resp = client.post("/api/stats/rosner", json={"x": _ROSNER_EXAMPLE, "k": 10})
    assert resp.status_code == 200
    out = resp.json()
    assert out["num_outliers"] == 3
    assert out["flagged_values"] == [6.01, 5.42, 5.34]
    assert out["flagged_indices"] == [53, 52, 51]


def test_rosner_bad_k_is_422_not_500() -> None:
    resp = client.post("/api/stats/rosner", json={"x": [1.0, 2.0, 3.0], "k": 0})
    assert resp.status_code == 422


def test_dixon_q_roundtrip() -> None:
    x = [10.0, 10.2, 10.3, 10.5, 15.0]
    resp = client.post("/api/stats/dixon-q", json={"x": x})
    assert resp.status_code == 200
    out = resp.json()
    assert out["ratio"] == "r10"
    assert out["flagged"] is True
    assert out["index"] == 4


def test_dixon_q_out_of_range_n_is_422_not_500() -> None:
    resp = client.post("/api/stats/dixon-q", json={"x": [1.0, 2.0]})
    assert resp.status_code == 422
    resp2 = client.post("/api/stats/dixon-q", json={"x": list(range(31))})
    assert resp2.status_code == 422


def test_mad_outliers_roundtrip() -> None:
    x = [1.0, 2.0, 3.0, 4.0, 10.0]
    resp = client.post("/api/stats/mad-outliers", json={"x": x})
    assert resp.status_code == 200
    out = resp.json()
    assert out["flagged_indices"] == [4]
    assert abs(out["mad"] - 1.0) < 1e-12
    assert len(out["modified_z_scores"]) == 5


def test_mad_outliers_excluded_nan_serializes_as_null() -> None:
    resp = client.post(
        "/api/stats/mad-outliers", json={"x": [1.0, 2.0, None, 3.0, 100.0]}
    )
    # pydantic coerces `None` in a `list[float]` field to a validation error
    # (422) rather than reaching the calc layer -- confirms the boundary
    # rejects malformed JSON before calc ever sees it.
    assert resp.status_code == 422


def test_mad_outliers_bad_threshold_is_422_not_500() -> None:
    resp = client.post("/api/stats/mad-outliers", json={"x": [1.0, 2.0], "threshold": 0})
    assert resp.status_code == 422

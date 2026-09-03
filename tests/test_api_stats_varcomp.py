"""Integration tests for /api/stats nested-anova + variance-components (TestClient).

Math is golden in test_calc_stats_varcomp; here we prove the transport +
422-on-ValueError contract (routes/stats_varcomp.py, JMP_GAP_PLAN J8).
"""

from __future__ import annotations

from fastapi.testclient import TestClient

_BALANCED = [
    [[2.0, 4.0, 6.0], [4.0, 6.0, 8.0]],
    [[6.0, 8.0, 10.0], [8.0, 10.0, 12.0]],
    [[10.0, 12.0, 14.0], [12.0, 14.0, 16.0]],
]


def test_nested_anova_roundtrip(client: TestClient) -> None:
    resp = client.post("/api/stats/nested-anova", json={"groups": _BALANCED})
    assert resp.status_code == 200
    out = resp.json()
    rows = {r["source"]: r for r in out["table"]}
    assert rows["A"]["SS"] == 192.0
    assert rows["B(A)"]["SS"] == 18.0
    assert rows["Error"]["SS"] == 48.0
    assert out["balanced"] is True


def test_nested_anova_single_a_level_is_422_not_500(client: TestClient) -> None:
    resp = client.post(
        "/api/stats/nested-anova", json={"groups": [[[1.0, 2.0], [3.0, 4.0]]]}
    )
    assert resp.status_code == 422


def test_variance_components_roundtrip(client: TestClient) -> None:
    resp = client.post("/api/stats/variance-components", json={"groups": _BALANCED})
    assert resp.status_code == 200
    out = resp.json()
    assert abs(out["sigma2_error"] - 4.0) < 1e-9
    assert abs(out["sigma2_B_within_A"] - 2.0 / 3.0) < 1e-9
    assert abs(out["sigma2_A"] - 15.0) < 1e-9
    assert out["method"].startswith("ANOVA/EMS")


def test_variance_components_non_estimable_is_422_not_500(client: TestClient) -> None:
    resp = client.post(
        "/api/stats/variance-components",
        json={"groups": [[[1.0, 2.0]], [[3.0, 4.0]]]},
    )
    assert resp.status_code == 422


def test_variability_summary_roundtrip(client: TestClient) -> None:
    resp = client.post("/api/stats/variability-summary", json={"groups": _BALANCED})
    assert resp.status_code == 200
    out = resp.json()
    assert out["grand_mean"] == 9.0
    assert out["grand_n"] == 18
    assert len(out["cells"]) == 6
    assert len(out["a_groups"]) == 3


def test_variability_summary_bad_shape_is_422_not_500(client: TestClient) -> None:
    resp = client.post("/api/stats/variability-summary", json={"groups": [[[1.0]]]})
    assert resp.status_code == 422

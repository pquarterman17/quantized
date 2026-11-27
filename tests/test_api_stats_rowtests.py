"""Routes: row-wise t-tests, Mann-Kendall and the Steel-Dwass posthoc method."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app)


def test_row_t_tests_route_pooled_default_and_welch() -> None:
    body = {"a": [[1, 2, 3], [2, 3, None]], "b": [[4, 5, 6, 7], [1, 2, 3, 4]]}
    default = client.post("/api/stats/row-t-tests", json=body).json()
    assert default["variance"] == "welch"
    pooled = client.post("/api/stats/row-t-tests", json={**body, "variance": "pooled"}).json()
    assert pooled["variance"] == "pooled" and "pooled" in pooled["method"]
    assert pooled["rows"][0]["df"] == 5.0
    welch = default
    assert welch["rows"][0]["df"] != 5.0
    assert pooled["rows"][1]["n1"] == 2


def test_row_t_tests_route_errors_are_422() -> None:
    r = client.post("/api/stats/row-t-tests", json={"a": [[1, 2]], "design": "paired"})
    assert r.status_code == 422 and "group B" in r.json()["detail"]
    bad = client.post("/api/stats/row-t-tests", json={"a": [[1]], "design": "x"})
    assert bad.status_code == 422


def test_mann_kendall_route() -> None:
    r = client.post("/api/stats/mann-kendall", json={"y": [1, 2, 2, 3]})
    assert r.status_code == 200 and r.json()["S"] == 5
    assert client.post("/api/stats/mann-kendall", json={"y": [1, 2]}).status_code == 422


def test_posthoc_steel_dwass_route() -> None:
    body = {"groups": [[1, 2, 3], [4, 5, 6], [7, 8, 9.5]], "method": "steel-dwass"}
    r = client.post("/api/stats/posthoc", json=body)
    assert r.status_code == 200
    out = r.json()
    assert out["key"] == "steel-dwass" and len(out["pairs"]) == 3
    assert client.post("/api/stats/posthoc", json={**body, "method": "nope"}).status_code == 422


@pytest.mark.parametrize("route", ["/api/stats/anova"])
def test_anova_route_keeps_old_keys_and_adds_effect_sizes(route: str) -> None:
    out = client.post(route, json={"groups": [[1, 2, 3], [2, 3, 4], [5, 6, 7]]}).json()
    assert {"fStat", "pValue", "ssBetween", "reject"} <= set(out)
    assert out["effectSizes"][0]["source"] == "Between"


def test_seasonal_mann_kendall_route_and_refusals() -> None:
    y = [3, 5, 2, 8, 4, 6, 2, 9, 4, 7, 3, 9, 6, 7, 5, 12, 5, 8, 4, 11]
    r = client.post("/api/stats/mann-kendall-seasonal", json={"y": y, "period": 4}).json()
    assert r["S"] == 30 and r["n_seasons"] == 4 and r["Z"] == pytest.approx(3.6633608566393576)
    seasons = [f"s{i % 4}" for i in range(20)]
    labelled = {"y": y, "x": [i // 4 for i in range(20)], "season": seasons}
    by_label = client.post("/api/stats/mann-kendall-seasonal", json=labelled).json()
    assert by_label["S"] == 30
    assert [s["season"] for s in by_label["seasons"]] == ["s0", "s1", "s2", "s3"]
    bad = client.post("/api/stats/mann-kendall-seasonal", json={"y": y})
    assert bad.status_code == 422 and "either as a column" in bad.json()["detail"]
    thin = {"y": [1, 2, 3, 4], "x": [0, 1, 2, 3], "season": [1, 2, 3, 4]}
    few = client.post("/api/stats/mann-kendall-seasonal", json=thin)
    assert few.status_code == 422 and "at least 2 observations" in few.json()["detail"]

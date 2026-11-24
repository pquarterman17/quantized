"""Transport tests: stats-extras lane (EWMA/CUSUM/Nelson, Dunn-Sidak, Mood, Poisson, Wilks)."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

G = [[1.0, 2.0, 3.5, 2.2], [4.0, 5.5, 6.1, 5.0, 4.4], [2.0, 8.0, 5.0, 9.5]]
X = [10.0, 10.4, 9.7, 10.1, 10.3, 9.9, 11.5, 11.8, 12.1, 12.0, 12.4, 12.2]


@pytest.mark.parametrize(
    ("path", "body", "key"),
    [
        ("posthoc", {"groups": G, "method": "dunn-sidak"}, "pairs"),
        ("mood-median", {"groups": G}, "grand_median"),
        ("poisson-rate", {"x1": 12, "t1": 3.0, "rate0": 2.0}, "ci_low"),
        ("poisson-rate", {"x1": 11, "t1": 800, "x2": 21, "t2": 3011}, "ratio"),
        (
            "tolerance-interval-np",
            {"x": list(range(60)), "sides": "upper", "coverage": 0.95},
            "upper",
        ),
    ],
)
def test_route_roundtrip(client: TestClient, path: str, body: dict[str, Any], key: str) -> None:
    resp = client.post(f"/api/stats/{path}", json=body)
    assert resp.status_code == 200, resp.text
    assert key in resp.json()


def test_dunn_route_shape_matches_posthoc_contract(client: TestClient) -> None:
    body = client.post("/api/stats/posthoc", json={"groups": G, "method": "dunn-sidak"}).json()
    assert body["key"] == "dunn-sidak" and body["adjusted"] is True
    pair = body["pairs"][0]
    assert {"i", "j", "diff", "p", "significant", "se", "statistic"} <= set(pair)
    assert pair["df"] is None and pair["ciLow"] is None


def test_poisson_unbounded_ci_is_null(client: TestClient) -> None:
    r = client.post(
        "/api/stats/poisson-rate", json={"x1": 9, "t1": 2, "alternative": "greater"}
    ).json()
    assert r["ci_high"] is None and r["ci_low"] > 0


@pytest.mark.parametrize(
    ("path", "body"),
    [
        ("mood-median", {"groups": [[2.0, 2.0], [2.0, 2.0]]}),
        ("poisson-rate", {"x1": 2.5}),
        ("poisson-rate", {"x1": 3, "x2": 1}),
        ("tolerance-interval-np", {"x": list(range(10))}),
        ("posthoc", {"groups": [[1.0, 1.0], [1.0, 1.0]], "method": "dunn-sidak"}),
    ],
)
def test_refusals_are_422(client: TestClient, path: str, body: dict[str, Any]) -> None:
    assert client.post(f"/api/stats/{path}", json=body).status_code == 422


def test_ewma_and_cusum_routes(client: TestClient) -> None:
    e = client.post("/api/stats/control-chart", json={"chart": "ewma", "values": X}).json()
    assert [p["name"] for p in e["panels"]] == ["EWMA"]
    assert e["params"]["lambda"] == 0.2 and e["params"]["L"] == 3.0
    c = client.post(
        "/api/stats/control-chart",
        json={"chart": "cusum", "values": X, "target": 10.0, "sigma": 0.3, "cusum_h": 4.0},
    ).json()
    assert [p["name"] for p in c["panels"]] == ["CUSUM C+", "CUSUM C-"]
    assert c["signals"][0]["side"] == "upper"
    bad = client.post(
        "/api/stats/control-chart", json={"chart": "ewma", "values": X, "ewma_lambda": 0}
    )
    assert bad.status_code == 422


def test_nelson_rule_ids_accepted(client: TestClient) -> None:
    r = client.post(
        "/api/stats/control-chart",
        json={
            "chart": "imr",
            "values": [1, 2, 3, 4, 5, 6, 7, 8.5, 3, 4],
            "rules": ["nel5", "nel8"],
        },
    )
    assert r.status_code == 200, r.text

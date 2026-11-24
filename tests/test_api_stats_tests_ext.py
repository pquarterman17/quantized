"""Transport tests for the G6 hypothesis-test routes (math is in test_calc_stats_tests_ext)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

G = [[1.0, 2.0, 3.5, 2.2], [4.0, 5.5, 6.1, 5.0, 4.4], [2.0, 8.0, 5.0, 9.5]]


@pytest.mark.parametrize(
    ("path", "body", "key"),
    [
        ("welch-anova", {"groups": G}, "F"),
        ("posthoc", {"groups": G, "method": "games-howell"}, "pairs"),
        ("posthoc", {"groups": G, "method": "scheffe"}, "pairs"),
        ("variance-test", {"groups": G, "method": "bartlett"}, "statistic"),
        ("variance-test", {"groups": G[:2], "method": "f-test"}, "ratio"),
        ("tost-one", {"x": G[1], "mu0": 5.0, "margin": 2.0}, "equivalent"),
        ("tost-two", {"x": G[0], "y": G[1], "low": -5.0, "high": 1.0}, "p"),
        ("tolerance-interval", {"x": G[1], "sides": "upper"}, "upper"),
        ("binomial-test", {"successes": 7, "trials": 20}, "p"),
        ("two-proportions", {"x1": 30, "n1": 100, "x2": 45, "n2": 100}, "p"),
        ("fisher-2x2", {"x1": 3, "n1": 4, "x2": 1, "n2": 4}, "odds_ratio"),
    ],
)
def test_route_roundtrip(client: TestClient, path: str, body: dict, key: str) -> None:  # type: ignore[type-arg]
    resp = client.post(f"/api/stats/{path}", json=body)
    assert resp.status_code == 200, resp.text
    assert key in resp.json()


@pytest.mark.parametrize(
    ("path", "body"),
    [
        ("welch-anova", {"groups": [[1.0, 1.0], [1.0, 2.0]]}),
        ("tost-one", {"x": G[1]}),
        ("variance-test", {"groups": G, "method": "f-test"}),
        ("two-proportions", {"x1": 1, "n1": 10, "x2": 3, "n2": 10}),
        ("tolerance-interval", {"x": [1.0, 2.0]}),
    ],
)
def test_refusals_are_422_not_500(client: TestClient, path: str, body: dict) -> None:  # type: ignore[type-arg]
    assert client.post(f"/api/stats/{path}", json=body).status_code == 422


def test_unknown_method_is_422(client: TestClient) -> None:
    assert client.post("/api/stats/posthoc", json={"groups": G, "method": "x"}).status_code == 422

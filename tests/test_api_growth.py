"""/api/growth routes (thin adapters over calc.growth_mode / calc.wulff)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


def test_bauer_route(client: TestClient) -> None:
    r = client.post(
        "/api/growth/bauer",
        json={
            "gamma_substrate": 2.0,
            "gamma_film": 1.2,
            "gamma_int_min": 0,
            "gamma_int_max": 2,
            "n": 5,
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert [p["verdict"] for p in body["points"]] == ["FvdM", "FvdM", "VW", "VW", "VW"]
    assert body["boundaries"][0]["gamma_int"] == pytest.approx(0.8)


def test_bauer_route_rejects_bad_input(client: TestClient) -> None:
    base = {"gamma_substrate": 2.0, "gamma_film": 1.2, "gamma_int_min": 0, "gamma_int_max": 2}
    assert client.post("/api/growth/bauer", json={**base, "gamma_substrate": 0}).status_code == 422
    assert client.post("/api/growth/bauer", json={**base, "n": 1}).status_code == 422

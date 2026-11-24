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


def test_wulff_route_cube_and_section(client: TestClient) -> None:
    r = client.post(
        "/api/growth/wulff",
        json={"facets": [{"hkl": [1, 0, 0], "gamma": 1.0}], "section_hkl": [0, 0, 1]},
    )
    assert r.status_code == 200
    body = r.json()
    assert len(body["facets"]) == 6 and len(body["vertices"]) == 8
    assert body["volume"] == pytest.approx(8.0)
    assert body["section"]["area"] == pytest.approx(4.0)


def test_wulff_route_fails_closed(client: TestClient) -> None:
    unbounded = {"facets": [{"hkl": [1, 0, 0], "gamma": 1.0}], "symmetry": "none"}
    assert client.post("/api/growth/wulff", json=unbounded).status_code == 422
    bad_cell = {"facets": [{"hkl": [1, 0, 0], "gamma": 1.0}], "cell": [3, 3, 5, 90, 90, 90]}
    assert client.post("/api/growth/wulff", json=bad_cell).status_code == 422
    assert client.post("/api/growth/wulff", json={"facets": []}).status_code == 422

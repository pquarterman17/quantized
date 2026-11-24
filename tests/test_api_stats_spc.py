"""Transport tests for the SPC routes (math is in test_calc_spc)."""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

X = [49.6, 47.6, 49.9, 51.3, 47.8, 51.2, 52.6, 52.4, 53.6, 52.1]


def test_control_chart_roundtrip(client: TestClient) -> None:
    r = client.post(
        "/api/stats/control-chart", json={"chart": "imr", "values": X, "rules": ["we1"]}
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert [p["name"] for p in body["panels"]] == ["Individuals", "Moving range"]
    assert abs(body["panels"][0]["ucl"][0] - 55.8041) < 1e-3


def test_capability_roundtrip_and_refusals(client: TestClient) -> None:
    ok = client.post("/api/stats/capability", json={"values": X, "lsl": 40, "usl": 60})
    assert ok.status_code == 200, ok.text
    assert ok.json()["overall"]["ppk"] > 0
    bad: list[dict[str, Any]] = [
        {"values": X},  # no spec limits: refused, no default
        {"values": X, "lsl": 60, "usl": 40},
        {"values": [1.0, 2.0], "lsl": 0, "usl": 3},
    ]
    for body in bad:
        assert client.post("/api/stats/capability", json=body).status_code == 422


def test_control_chart_refusals(client: TestClient) -> None:
    for body in (
        {"chart": "xbar-r", "subgroups": [[1, 2], [1, 2, 3]]},
        {"chart": "p", "counts": [1, 2]},
        {"chart": "bogus", "values": X},
        {"chart": "imr", "values": X, "rules": ["we9"]},
    ):
        assert client.post("/api/stats/control-chart", json=body).status_code == 422

"""Integration tests for /api/stats/fit-model/{profile,contour,desirability}
(routes/model_evaluate.py, GAP_AUDIT_9 G7): transport, JSON shape, 422 refusals."""

from __future__ import annotations

import math

from fastapi.testclient import TestClient

_Y = [4.1, 5.0, 6.2, 7.9, 9.1, 9.8, 3.0, 5.5, 6.6, 8.0]
_A = ["1", "1", "2", "2", "3", "3", "1", "2", "3", "1"]
_X = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 1.5, 3.5, 5.5, 2.5]
_Z = [0.3, 0.1, 0.9, 0.4, 0.8, 0.2, 0.7, 0.5, 0.6, 0.0]


def _model(client: TestClient) -> dict[str, object]:
    body = {
        "response_name": "Hc", "response": _Y,
        "factors": [
            {"name": "A", "kind": "nominal", "values": _A},
            {"name": "x", "kind": "continuous", "values": _X},
            {"name": "z", "kind": "continuous", "values": _Z},
        ],
        "terms": [["A"], ["x"], ["z"], ["x", "z"]],
    }
    resp = client.post("/api/stats/fit-model", json=body)
    assert resp.status_code == 200, resp.text
    return resp.json()["model"]  # type: ignore[no-any-return]


def test_profile_matches_predict_and_is_one_call(client: TestClient) -> None:
    model = _model(client)
    assert model["ranges"] == {"x": [1.0, 6.0], "z": [0.0, 0.9]}  # type: ignore[comparison-overlap]
    resp = client.post("/api/stats/fit-model/profile",
                       json={"model": model, "n_points": 11,
                             "current": {"A": "2", "x": 3.0, "z": 0.5}})
    assert resp.status_code == 200, resp.text
    out = resp.json()
    assert [f["name"] for f in out["factors"]] == ["A", "x", "z"]
    fx = out["factors"][1]
    assert len(fx["x"]) == 11 and fx["lower"][0] < fx["predicted"][0] < fx["upper"][0]
    assert out["factors"][0]["levels"] == ["1", "2", "3"]
    pred = client.post("/api/stats/fit-model/predict", json={
        "model": model, "settings": {"A": ["2"] * 11, "x": fx["x"], "z": [0.5] * 11}}).json()
    same = zip(fx["predicted"], pred["predicted"], strict=True)
    assert all(math.isclose(a, b, rel_tol=1e-12) for a, b in same)
    half = out["t_crit"] * out["current"]["se"]
    assert math.isclose(out["current"]["upper"] - out["current"]["predicted"], half, rel_tol=1e-12)


def test_contour_and_desirability(client: TestClient) -> None:
    model = _model(client)
    c = client.post("/api/stats/fit-model/contour",
                    json={"model": model, "x_factor": "x", "y_factor": "z", "n_x": 6, "n_y": 4})
    assert c.status_code == 200, c.text
    assert len(c.json()["z"]) == 4 and len(c.json()["z"][0]) == 6
    d = client.post("/api/stats/fit-model/desirability",
                    json={"model": model, "goal": {"goal": "maximize", "lower": 3, "upper": 12}})
    assert d.status_code == 200, d.text
    assert 0 < d.json()["desirability"] <= 1 and set(d.json()["settings"]) == {"A", "x", "z"}


def test_refusals_are_422(client: TestClient) -> None:
    model = _model(client)
    bad = [
        ("profile", {"model": model, "current": {"A": "nope"}}),
        ("contour", {"model": model, "x_factor": "A", "y_factor": "x"}),
        ("contour", {"model": model, "x_factor": "x", "y_factor": "x"}),
        ("desirability", {"model": model,
                          "goal": {"goal": "target", "lower": 0, "upper": 10, "target": 20}}),
        ("profile", {"model": {"factors": []}}),
    ]
    for route, body in bad:
        resp = client.post(f"/api/stats/fit-model/{route}", json=body)
        assert resp.status_code == 422, (route, resp.text)

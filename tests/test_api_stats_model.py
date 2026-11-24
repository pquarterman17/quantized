"""Integration tests for /api/stats/fit-model (+ /predict) (TestClient).

The math is oracle-checked in test_stats_linear_model; here: transport, the
JSON shape the frontend reads, nominal labels that look numeric staying
labels, and 422-not-500 on every refusal (routes/stats_model.py, GAP_AUDIT_9 G1).
"""

from __future__ import annotations

import math

from fastapi.testclient import TestClient

_Y = [4.1, 5.0, 6.2, 7.9, 9.1, 9.8, 3.0, 5.5]
_A = ["1", "1", "2", "2", "3", "3", "1", "2"]
_X = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 1.5, 3.5]


def _body(**over: object) -> dict[str, object]:
    body: dict[str, object] = {
        "response_name": "Hc",
        "response": _Y,
        "factors": [
            {"name": "A", "kind": "nominal", "values": _A},
            {"name": "x", "kind": "continuous", "values": _X},
        ],
        "terms": [["A"], ["x"]],
    }
    body.update(over)
    return body


def test_fit_model_roundtrip_and_predict(client: TestClient) -> None:
    resp = client.post("/api/stats/fit-model", json=_body())
    assert resp.status_code == 200, resp.text
    out = resp.json()
    assert out["n"] == 8 and out["response"] == "Hc"
    assert [r["term"] for r in out["parameter_estimates"]] == ["Intercept", "A[1]", "A[2]", "x"]
    assert [e["effect"] for e in out["effect_tests"]] == ["A", "x"]
    assert out["ls_means"][0]["effect"] == "A" and len(out["ls_means"][0]["rows"]) == 3
    assert [r["source"] for r in out["anova"]] == ["Model", "Error", "C. Total"]
    assert len(out["predicted"]) == 8
    pred = client.post("/api/stats/fit-model/predict",
                       json={"model": out["model"], "settings": {"A": _A, "x": _X}})
    assert pred.status_code == 200, pred.text
    got = pred.json()["predicted"]
    want = out["predicted"]
    assert all(math.isclose(a, b, rel_tol=1e-12) for a, b in zip(got, want, strict=True))


def test_missing_values_are_null_and_dropped(client: TestClient) -> None:
    y = list(_Y)
    y[2] = None  # type: ignore[call-overload]
    out = client.post("/api/stats/fit-model", json=_body(response=y)).json()
    assert out["n"] == 7 and out["n_dropped_missing"] == 1
    assert out["predicted"][2] is None


def test_refusals_are_422(client: TestClient) -> None:
    cases = [
        _body(terms=[["A"], ["x"], ["A", "x"], ["x", "x"], ["A", "x", "x"]]),  # 9 parameters, 8 rows
        _body(factors=[{"name": "A", "kind": "nominal", "values": ["a"] * 8}], terms=[["A"]]),
        _body(terms=[]),
        _body(terms=[["A", "A"]]),
    ]
    for body in cases:
        resp = client.post("/api/stats/fit-model", json=body)
        assert resp.status_code == 422, (body["terms"], resp.text)
    bad = client.post("/api/stats/fit-model/predict",
                      json={"model": {"factors": []}, "settings": {}})
    assert bad.status_code == 422

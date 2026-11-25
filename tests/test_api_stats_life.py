"""Transport tests for the life-distribution routes (math is in test_calc_life)."""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

# NIST/SEMATECH e-Handbook 8.4.1.3 example: 10 failures, 10 censored at 500 h.
T = [54, 187, 216, 240, 244, 335, 361, 373, 375, 386] + [500] * 10
C = [0] * 10 + [1] * 10


def test_life_distribution_roundtrip(client: TestClient) -> None:
    r = client.post(
        "/api/stats/life-distribution",
        json={
            "time": T,
            "censor": C,
            "compare": True,
            "eval_times": [300],
            "quantile_probs": [0.1],
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert abs(body["parameters"][0]["estimate"] - 606.528) < 0.01
    assert {c["distribution"] for c in body["comparison"]} == {
        "weibull",
        "lognormal",
        "exponential",
        "loglogistic",
        "sev",
    }
    assert body["quantiles"][0]["p"] == 0.1
    assert body["plot"]["x_log"] is True and len(body["plot"]["points"]) == 10


def test_life_distribution_refusals(client: TestClient) -> None:
    bad: list[dict[str, Any]] = [
        {"time": [1, 2, 3], "censor": [0, 1, 1]},  # one failure
        {"time": [1, -2, 3, 4], "censor": [0, 0, 0, 0]},
        {"time": [1, 2, 3, 4], "censor": [0, 0, 2, 0]},
        {"time": T, "censor": C, "distribution": "gamma"},
        {"time": T, "censor": C, "alpha": 2.0},
    ]
    for body in bad:
        assert client.post("/api/stats/life-distribution", json=body).status_code == 422


def test_life_by_x_roundtrip_and_refusals(client: TestClient) -> None:
    t = [900, 1100, 1500, 1800, 400, 520, 610, 700, 150, 190, 220, 260]
    x = [100] * 4 + [125] * 4 + [150] * 4
    ok = client.post(
        "/api/stats/life-by-x", json={"time": t, "censor": [0] * 12, "x": x, "use_x": 55}
    )
    assert ok.status_code == 200, ok.text
    body = ok.json()
    assert body["parameters"][1]["estimate"] > 0 and len(body["acceleration"]) == 3
    one_level = client.post(
        "/api/stats/life-by-x", json={"time": t, "censor": [0] * 12, "x": [100] * 12}
    )
    assert one_level.status_code == 422


def test_life_distribution_ci_method_option(client: TestClient) -> None:
    base = {"time": T, "censor": C, "quantile_probs": [0.1]}
    wald = client.post("/api/stats/life-distribution", json=base).json()
    lr = client.post(
        "/api/stats/life-distribution", json={**base, "ci_method": "likelihood-ratio"}
    ).json()
    assert wald["ci_method"].startswith("Wald") and lr["ci_method"].startswith("Likelihood")
    assert lr["parameters"][0]["estimate"] == wald["parameters"][0]["estimate"]
    assert lr["parameters"][0]["ci_low"] != wald["parameters"][0]["ci_low"]
    r = client.post("/api/stats/life-distribution", json={**base, "ci_method": "bootstrap"})
    assert r.status_code == 422


def test_life_interval_roundtrip_and_refusals(client: TestClient) -> None:
    lower = [0, 10, 20, 30, 40, 55, 70, 90, 60]
    upper = [15, 25, 35, 45, 60, 55, 100, None, 90]  # left, intervals, exact (55), right (null)
    r = client.post(
        "/api/stats/life-interval",
        json={"lower": lower, "upper": upper, "ci_method": "likelihood-ratio", "compare": True},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["n"], body["n_exact"], body["n_left"], body["n_right"]) == (9, 1, 1, 1)
    assert body["turnbull"]["converged"] and body["plot"]["method"] == "turnbull"
    assert body["turnbull"]["upper"][-1] is None or body["turnbull"]["upper"][-1] > 0
    assert len(body["comparison"]) == 5
    bad = [
        {"lower": [5, 1, 2], "upper": [4, 2, 3]},  # lower > upper
        {"lower": [1, 2, 3], "upper": [None, None, None]},  # all right-censored
        {"lower": [1, 2], "upper": [2]},  # length mismatch
        {"lower": lower, "upper": upper, "distribution": "normal"},
    ]
    for body_bad in bad:
        assert client.post("/api/stats/life-interval", json=body_bad).status_code == 422


def test_life_figure_export(client: TestClient) -> None:
    res = client.post("/api/stats/life-distribution", json={"time": T, "censor": C}).json()
    r = client.post("/api/stats/life-figure", json={"plot": res["plot"], "title": "NIST"})
    assert r.status_code == 200 and r.content[:4] == b"%PDF"
    svg = client.post("/api/stats/life-figure", json={"plot": res["plot"], "fmt": "svg"})
    assert svg.status_code == 200 and b"<svg" in svg.content[:400] + svg.content
    ires = client.post(
        "/api/stats/life-interval",
        json={"lower": [0, 10, 20, 30, 40, 55, 70], "upper": [15, 25, 35, 45, 60, 55, 100]},
    ).json()
    ok = client.post("/api/stats/life-figure", json={"plot": ires["plot"], "fmt": "png"})
    assert ok.status_code == 200 and ok.content[:4] == b"\x89PNG"
    assert client.post("/api/stats/life-figure", json={"plot": {"points": []}}).status_code == 422

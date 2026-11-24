"""Integration tests for /api/doe (TestClient): transport, the worksheet shape
the frontend reads, 422-not-500 on every refusal (routes/doe.py, GAP_AUDIT_9 J16)."""

from __future__ import annotations

from fastapi.testclient import TestClient


def _body(**over: object) -> dict[str, object]:
    body: dict[str, object] = {
        "design": "full_factorial",
        "factors": [
            {"name": "Temp", "low": 100, "high": 200, "unit": "C"},
            {"name": "Time", "low": 5, "high": 15, "unit": "min"},
            {"name": "Dose", "low": 0, "high": 1},
        ],
        "response_name": "Hc",
    }
    body.update(over)
    return body


def test_generate_factorial_worksheet(client: TestClient) -> None:
    resp = client.post("/api/doe/generate", json=_body(center_points=2, randomize=True, seed=3))
    assert resp.status_code == 200, resp.text
    out = resp.json()
    ds = out["dataset"]
    assert ds["labels"][:2] == ["StdOrder", "PointType"] and ds["labels"][-1] == "Hc"
    assert len(ds["time"]) == 10 and ds["cat_levels"]["1"] == ["factorial", "axial", "center"]
    assert all(row[-1] is None for row in ds["values"])  # empty response column
    assert out["doe"]["seed"] == 3 and ds["metadata"]["doe"]["model"] == "interaction"
    assert ds["units"][5:8] == ["C", "min", ""]


def test_generate_fraction_reports_alias_structure(client: TestClient) -> None:
    factors = [{"name": n} for n in "ABCDEFG"]
    out = client.post(
        "/api/doe/generate", json=_body(design="fractional_factorial", p=4, factors=factors)
    ).json()
    assert out["doe"]["resolution"] == 3 and out["doe"]["generators"][0] == "D = AB"
    assert ["A", "BD", "CE", "FG"] in out["doe"]["aliases"]


def test_generate_rsm_and_screening(client: TestClient) -> None:
    ccd = client.post(
        "/api/doe/generate", json=_body(design="ccd", alpha="orthogonal", ccd_inscribed=True)
    ).json()
    assert ccd["doe"]["model"] == "quadratic" and ccd["doe"]["runs"] == 20
    bb = client.post("/api/doe/generate", json=_body(design="box_behnken")).json()
    assert bb["doe"]["runs"] == 15
    pb = client.post("/api/doe/generate", json=_body(design="plackett_burman", runs=12)).json()
    assert pb["doe"]["runs"] == 12 and pb["doe"]["model"] == "main"


def test_generate_refusals_are_422(client: TestClient) -> None:
    cases = [
        _body(design="fractional_factorial"),  # no p
        _body(design="fractional_factorial", p=2),  # no 2^(3-2)
        _body(design="plackett_burman"),
        _body(design="plackett_burman", runs=16),
        _body(design="ccd", alpha="bogus"),
        _body(design="box_behnken", factors=[{"name": n} for n in "ABCDEF"]),
        _body(replicates=0),
        _body(factors=[{"name": "A"}, {"name": "A"}]),
        _body(factors=[{"name": "A", "low": 1, "high": 1}, {"name": "B"}]),
        _body(randomize=True, seed=-5),
    ]
    for body in cases:
        assert client.post("/api/doe/generate", json=body).status_code == 422, body


def test_fractions_listing(client: TestClient) -> None:
    out = client.get("/api/doe/fractions/7").json()
    assert [(f["p"], f["runs"], f["resolution"]) for f in out["fractions"]] == [
        (1, 64, 7),
        (2, 32, 4),
        (3, 16, 4),
        (4, 8, 3),
    ]
    assert out["center_points"]["box_behnken"] == 5  # not tabulated: provisional fallback


def test_effects_route(client: TestClient) -> None:
    a = [-1.0, 1.0, -1.0, 1.0, -1.0, 1.0, -1.0, 1.0]
    b = [-1.0, -1.0, 1.0, 1.0, -1.0, -1.0, 1.0, 1.0]
    c = [-1.0, -1.0, -1.0, -1.0, 1.0, 1.0, 1.0, 1.0]
    y = [10 + 3 * i - 2 * j for i, j in zip(a, b, strict=True)]
    resp = client.post(
        "/api/doe/effects",
        json={
            "factor_columns": {"A": a, "B": b, "C": c},
            "response": y,
            "terms": [["A"], ["B"], ["C"], ["A", "B"]],
        },
    )
    assert resp.status_code == 200, resp.text
    eff = {r["term"]: r["effect"] for r in resp.json()["effects"]}
    assert eff["A"] == 6.0 and eff["B"] == -4.0 and eff["C"] == 0.0 and eff["A*B"] == 0.0
    bad = client.post(
        "/api/doe/effects",
        json={"factor_columns": {"A": a}, "response": y[:3], "terms": [["A"]]},
    )
    assert bad.status_code == 422

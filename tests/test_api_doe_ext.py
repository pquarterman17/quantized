"""/api/doe/generate: blocking and D-optimal designs (transport, worksheet shape,
422-not-500). The numerics are tested in test_doe_blocking / test_doe_optimal."""

from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient


def _body(k: int = 3, **over: object) -> dict[str, object]:
    body: dict[str, object] = {
        "design": "full_factorial",
        "factors": [{"name": n, "low": 0, "high": 10} for n in "ABCDEFGH"[:k]],
        "response_name": "Y",
    }
    body.update(over)
    return body


def test_blocked_factorial_with_standard_generators(client: TestClient) -> None:
    out = client.post("/api/doe/generate", json=_body(4, blocks=2, randomize=True, seed=1)).json()
    ds, meta = out["dataset"], out["doe"]
    assert ds["labels"][:3] == ["StdOrder", "PointType", "Block"]
    assert ds["cat_levels"]["2"] == ["1", "2"]
    assert meta["block_generators"] == ["ABCD"] and meta["confounded"] == ["ABCD"]
    assert meta["blocks"] == 2 and meta["block_label"] == "Block"
    blk = [row[2] for row in ds["values"]]
    assert blk == sorted(blk) and set(blk) == {0.0, 1.0}


def test_blocked_with_user_generators_and_fraction(client: TestClient) -> None:
    out = client.post(
        "/api/doe/generate", json=_body(4, blocks=4, block_generators=["ABC", "BCD"])
    ).json()
    assert set(out["doe"]["confounded"]) == {"ABC", "BCD", "AD"}
    frac = client.post(
        "/api/doe/generate",
        json=_body(5, design="fractional_factorial", p=1, blocks=2, block_generators=["ABC"]),
    ).json()
    assert frac["doe"]["confounded"] == ["DE = ABC"] and frac["doe"]["resolution"] == 5


@pytest.mark.parametrize(
    "over",
    [
        {"blocks": 3},
        {"blocks": 2, "block_generators": ["A"]},  # a main effect
        {"blocks": 2, "block_generators": ["ABC", "BC"]},  # wrong count
        {"blocks": 1, "block_generators": ["ABC"]},
        {"blocks": 2, "design": "box_behnken"},
        {"blocks": 16},  # too many for 8 runs
    ],
)
def test_blocking_refusals_are_422(client: TestClient, over: dict[str, object]) -> None:
    assert client.post("/api/doe/generate", json=_body(3, **over)).status_code == 422


def test_blocked_effects_are_free_of_the_block_shift(client: TestClient) -> None:
    out = client.post("/api/doe/generate", json=_body(3, blocks=2, replicates=2)).json()
    ds = out["dataset"]
    lab = ds["labels"]
    x = np.array([[r[lab.index(f"{n} (coded)")] for n in "ABC"] for r in ds["values"]])
    blk = np.array([r[2] for r in ds["values"]])
    y = 5 + 3 * x[:, 0] - 1 * x[:, 1] + 20 * blk
    body = {
        "factor_columns": {f"{n} (coded)": x[:, i].tolist() for i, n in enumerate("ABC")},
        "response": y.tolist(),
        "terms": [t for t in out["doe"]["terms_coded"] if len(t) <= 2],
    }
    res = client.post("/api/doe/effects", json=body)
    assert res.status_code == 200, res.text
    eff = {r["term"]: r["effect"] for r in res.json()["effects"]}
    assert eff["A (coded)"] == pytest.approx(6.0) and eff["B (coded)"] == pytest.approx(-2.0)
    assert abs(eff["C (coded)"]) < 1e-9


def test_d_optimal_continuous(client: TestClient) -> None:
    out = client.post(
        "/api/doe/generate", json=_body(3, design="d_optimal", model="main", n_runs=8)
    ).json()
    meta = out["doe"]
    assert meta["kind"] == "d_optimal" and meta["runs"] == 8
    assert meta["d_efficiency"] == pytest.approx(100.0, abs=1e-6)
    assert meta["model"] == "main" and meta["error_df"] == 4
    again = client.post(
        "/api/doe/generate", json=_body(3, design="d_optimal", model="main", n_runs=8)
    ).json()
    assert again["dataset"]["values"] == out["dataset"]["values"]  # fixed default seed


def test_d_optimal_categorical_and_candidates(client: TestClient) -> None:
    factors = [
        {"name": "T", "low": 10, "high": 30, "unit": "C"},
        {"name": "Cat", "levels": ["a", "b", "c"]},
    ]
    cand = [[t, c] for t in (10, 20, 30) for c in ("a", "b", "c")]
    out = client.post(
        "/api/doe/generate",
        json={
            "design": "d_optimal",
            "factors": factors,
            "model": "interaction",
            "n_runs": 7,
            "method": "fedorov",
            "candidates": cand,
            "response_name": "Y",
        },
    )
    assert out.status_code == 200, out.text
    ds, meta = out.json()["dataset"], out.json()["doe"]
    assert ds["cat_levels"]["5"] == ["a", "b", "c"] and meta["factors"][1]["levels"] == [
        "a",
        "b",
        "c",
    ]
    assert meta["error_df"] == 7 - 6


@pytest.mark.parametrize(
    "over",
    [
        {"n_runs": None},
        {"n_runs": 2},
        {"n_runs": 8, "replicates": 2},
        {"n_runs": 8, "center_points": 1},
        {"n_runs": 8, "method": "coordinate", "candidates": [[0, 0, 0]]},
        {"n_runs": 8, "candidates": [[0, 0]], "method": "fedorov"},
        {"n_runs": 8, "candidates": [[99, 0, 0]], "method": "fedorov"},
        {"n_runs": 8, "blocks": 2},
    ],
)
def test_d_optimal_refusals_are_422(client: TestClient, over: dict[str, object]) -> None:
    body = _body(3, design="d_optimal", model="main", **over)
    assert client.post("/api/doe/generate", json=body).status_code == 422


def test_categorical_levels_refused_outside_d_optimal(client: TestClient) -> None:
    body = _body(2)
    body["factors"] = [{"name": "A", "levels": ["x", "y"]}, {"name": "B"}]
    assert client.post("/api/doe/generate", json=body).status_code == 422

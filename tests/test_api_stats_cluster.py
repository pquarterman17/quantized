"""/api/stats/kmeans and /api/stats/hierarchical: shape, determinism and 422 refusals."""

from __future__ import annotations

import json

import numpy as np
from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app, raise_server_exceptions=False)


def _x() -> list[list[float]]:
    rng = np.random.default_rng(0)
    return np.vstack([rng.normal(0, 0.2, (10, 2)), rng.normal(4, 0.2, (10, 2))]).tolist()


def test_kmeans_route_is_reproducible() -> None:
    body = {"x": _x(), "k": 2, "seed": 4}
    a = client.post("/api/stats/kmeans", json=body)
    b = client.post("/api/stats/kmeans", json=body)
    assert a.status_code == 200 and a.json() == b.json()
    d = a.json()
    assert d["counts"] == [10, 10] and len(d["labels"]) == 20 and d["seed"] == 4
    assert len(d["centroids"]) == 2 and d["silhouette"] > 0.9


def test_hierarchical_route() -> None:
    r = client.post("/api/stats/hierarchical", json={"x": _x(), "method": "ward", "k": 2})
    assert r.status_code == 200
    d = r.json()
    assert d["counts"] == [10, 10] and len(d["linkage"]) == 19 and d["cophenetic_correlation"] > 0.9
    assert len(d["dendrogram"]["segments"]) == 19
    r2 = client.post(
        "/api/stats/hierarchical", json={"x": _x(), "cut_distance": 1.0, "method": "single"}
    )
    assert r2.status_code == 200 and r2.json()["cut_by"] == "distance"


def test_refusals_are_422_never_500() -> None:
    x = _x()
    nan = [row[:] for row in x]
    nan[3][1] = float("nan")
    cases = [
        ("kmeans", {"x": nan, "k": 2}),
        ("kmeans", {"x": x[:1], "k": 2}),
        ("kmeans", {"x": x[:3], "k": 5}),
        ("kmeans", {"x": [["a", "b"]] * 5, "k": 2}),
        ("kmeans", {"x": x, "k": 1}),
        ("kmeans", {"x": x, "k": 2, "seed": -1}),
        ("kmeans", {"x": [[1.0, 2.0], [2.0]], "k": 2}),
        ("hierarchical", {"x": nan, "k": 2}),
        ("hierarchical", {"x": x, "method": "ward", "metric": "cityblock", "k": 2}),
        ("hierarchical", {"x": x}),
        ("hierarchical", {"x": x, "k": 2, "cut_distance": 1.0}),
        ("hierarchical", {"x": x[:2], "k": 2}),
        ("hierarchical", {"x": x, "k": 2, "method": "bogus"}),
        ("hierarchical", {"x": "nope", "k": 2}),
    ]
    for route, body in cases:
        r = client.post(
            f"/api/stats/{route}",
            content=json.dumps(body),
            headers={"content-type": "application/json"},
        )
        assert r.status_code == 422, (route, body, r.status_code)
    r = client.post(
        "/api/stats/hierarchical", json={"x": x, "method": "ward", "metric": "correlation", "k": 2}
    )
    assert "Euclidean" in str(r.json())

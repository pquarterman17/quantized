"""Routes for PLS / LDA / spectra PCA (G12): thin adapters, 422 on bad input, no NaN on the wire."""

from __future__ import annotations

import numpy as np
from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app, raise_server_exceptions=False)


def _xy() -> tuple[list[list[float]], list[list[float]]]:
    rng = np.random.default_rng(0)
    x = rng.normal(size=(30, 5))
    y = x @ rng.normal(size=(5, 1)) + 0.1 * rng.normal(size=(30, 1))
    return x.tolist(), y.tolist()


def test_pls_route_shapes_and_determinism() -> None:
    x, y = _xy()
    body = {"x": x, "y": y, "folds": 5, "seed": 1}
    a = client.post("/api/stats/pls", json=body)
    assert a.status_code == 200, a.text
    r = a.json()
    assert len(r["scores"]) == 30 and len(r["coef"]) == 5 and len(r["vip"]) == 5
    assert client.post("/api/stats/pls", json=body).json() == r


def test_pls_route_refusals() -> None:
    x, y = _xy()
    assert client.post("/api/stats/pls", json={"x": x, "y": y[:-1]}).status_code == 422
    assert (
        client.post("/api/stats/pls", json={"x": x, "y": y, "n_components": 9}).status_code == 422
    )
    assert (
        client.post("/api/stats/pls", json={"x": x, "y": y, "preprocess": "bogus"}).status_code
        == 422
    )


def test_lda_route_numeric_and_string_labels() -> None:
    rng = np.random.default_rng(1)
    x = np.vstack([rng.normal(size=(15, 3)), rng.normal(size=(15, 3)) + 3]).tolist()
    for labels in ([1.0] * 15 + [2.0] * 15, ["a"] * 15 + ["b"] * 15):
        r = client.post("/api/stats/lda", json={"x": x, "labels": labels, "cv_folds": 3})
        assert r.status_code == 200, r.text
        assert len(r["scores"] if False else r.json()["scores"]) == 30
    assert client.post("/api/stats/lda", json={"x": x, "labels": [1.0] * 30}).status_code == 422


def test_pca_spectra_route_grid_policy() -> None:
    g = np.linspace(0, 1, 20)
    ys = [np.sin(3 * g + k).tolist() for k in range(4)]
    ok = client.post(
        "/api/stats/pca-spectra", json={"spectra_x": [g.tolist()] * 4, "spectra_y": ys}
    )
    assert ok.status_code == 200 and len(ok.json()["score"]) == 4
    off = [g.tolist()] * 3 + [(g + 0.01).tolist()]
    assert (
        client.post("/api/stats/pca-spectra", json={"spectra_x": off, "spectra_y": ys}).status_code
        == 422
    )
    assert (
        client.post(
            "/api/stats/pca-spectra", json={"spectra_x": off, "spectra_y": ys, "resample": True}
        ).status_code
        == 200
    )

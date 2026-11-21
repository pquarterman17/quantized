"""Lean fit responses and diagnostics by result id (P4 large-payload lane,
plans/LARGE_PAYLOAD_PLAN.md; routes/_fitresults.py).

Three contracts:

* SIZE: a lean ``/fit`` / ``/equation/fit`` body carries ONE per-point array
  (``yFit``), not two; ``/diagnostics`` by ``result_id`` posts no arrays and,
  with ``qq_points``, returns a bounded Q-Q payload. Each bound failed before
  the change (the extra request fields were ignored, so the full response
  came back / the id-only request was a 422).
* IDENTITY: every parameter and statistic is byte-identical between the
  lean and the full response, and ``y - yFit`` rebuilds ``residuals``
  exactly; diagnostics by id equal diagnostics by arrays exactly.
* FULL RESOLUTION: ``yFit`` (what Freeze / write-to-sheet / the overlay use)
  stays full length and identical.
"""

from __future__ import annotations

import json
import math
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.routes import _fitresults

client = TestClient(app)

N = 50_000


def _data(n: int = N) -> tuple[list[float], list[float], list[float]]:
    rng = np.random.default_rng(4)
    x = np.linspace(0.0, 100.0, n)
    y = 1000 * np.exp(-(((x - 50) / 3) ** 2)) + 2 * x + 5 + rng.normal(0, 5, n)
    dy = 4.0 + rng.random(n)
    return x.tolist(), y.tolist(), dy.tolist()


def _post(path: str, body: dict[str, Any]) -> tuple[dict[str, Any], int]:
    r = client.post(path, json=body)
    assert r.status_code == 200, r.text
    return r.json(), len(r.content)


def _rebuilt(y: list[float], y_fit: list[float | None]) -> list[float | None]:
    """The client's rule (frontend/src/lib/fitResiduals.ts), in Python."""
    out: list[float | None] = []
    for v, f in zip(y, y_fit, strict=True):
        d = None if f is None else v - f
        out.append(d if d is not None and math.isfinite(d) else None)
    return out


CASES = [
    ("/api/fitting/fit", {"model": "Gaussian"}),
    ("/api/fitting/fit", {"model": "Linear", "weighted": True}),
    ("/api/fitting/equation/fit", {"equation": "a*x+b"}),
]


@pytest.mark.parametrize(("path", "spec"), CASES)
def test_lean_fit_is_one_array_and_identical(path: str, spec: dict[str, Any]) -> None:
    x, y, dy = _data()
    body: dict[str, Any] = {k: v for k, v in spec.items() if k != "weighted"}
    body |= {"x": x, "y": y}
    if spec.get("weighted"):
        body["dy"] = dy
    full, full_bytes = _post(path, body)
    lean, lean_bytes = _post(path, {**body, "return_residuals": False})

    # SIZE: residuals leave the wire (failed before: they came back). What
    # stays per-point is yFit, plus obsVar for a weighted fit (the band's
    # per-point variance; deferred in the plan).
    kept = [full["yFit"]] + ([full["obsVar"]] if spec.get("weighted") else [])
    kept_bytes = sum(len(json.dumps(a, separators=(",", ":"))) for a in kept)
    assert lean_bytes < kept_bytes * 1.15, (lean_bytes, kept_bytes, full_bytes)
    assert "residuals" not in lean

    # IDENTITY: params/errors/statistics byte-identical; residuals rebuild exactly.
    assert isinstance(lean["resultId"], str)
    assert {k: v for k, v in lean.items() if k != "resultId"} == {
        k: v for k, v in full.items() if k != "residuals"
    }
    assert _rebuilt(y, lean["yFit"]) == full["residuals"]
    # FULL RESOLUTION: the curve the overlay / Freeze / write-to-sheet use.
    assert len(lean["yFit"]) == N


def test_default_response_unchanged_and_stores_nothing() -> None:
    _fitresults.clear_fit_results()
    x, y, _ = _data(200)
    out, _ = _post("/api/fitting/fit", {"model": "Linear", "x": x, "y": y})
    assert "residuals" in out and "resultId" not in out
    assert _fitresults.store_stats()["entries"] == 0


@pytest.mark.parametrize("weighted", [False, True])
@pytest.mark.parametrize("use_weights", [False, True])
def test_diagnostics_by_id_equal_by_arrays(weighted: bool, use_weights: bool) -> None:
    x, y, dy = _data()
    body: dict[str, Any] = {"model": "Gaussian", "x": x, "y": y}
    if weighted:
        body["dy"] = dy
    full, _ = _post("/api/fitting/fit", body)
    lean, _ = _post("/api/fitting/fit", {**body, "return_residuals": False})
    by_arrays: dict[str, Any] = {
        "y": y,
        "residuals": [math.nan if v is None else v for v in full["residuals"]],
        "n_params": 4,
    }
    if weighted and use_weights:
        by_arrays["weights"] = [1 / (d * d) for d in dy]  # FitDiagnosticsSection's rule
    expected, array_bytes = _post("/api/fitting/diagnostics", by_arrays)
    id_body = {"result_id": lean["resultId"], "n_params": 4, "use_weights": use_weights}
    got, id_bytes = _post("/api/fitting/diagnostics", id_body)
    assert got == expected
    assert len(json.dumps(id_body)) < 200  # posted no arrays (vs ~1.9 MB here)
    assert id_bytes == array_bytes


def test_diagnostics_qq_points_bounds_the_payload_not_the_statistics() -> None:
    x, y, _ = _data()
    fitted, _ = _post("/api/fitting/fit", {"model": "Gaussian", "x": x, "y": y})
    # By arrays, so this bound is independent of the result-id path above.
    resid = [math.nan if v is None else v for v in fitted["residuals"]]
    body = {"y": y, "residuals": resid, "n_params": 4}
    full, full_bytes = _post("/api/fitting/diagnostics", body)
    thin, thin_bytes = _post("/api/fitting/diagnostics", {**body, "qq_points": 512})
    assert thin_bytes < 64_000 < full_bytes  # failed before: qq_points was ignored
    assert len(thin["residuals"]["qqY"]) <= 2 * 512
    assert thin["compare"] == full["compare"]
    stats = {k: v for k, v in full["residuals"].items() if k not in ("qqX", "qqY")}
    assert {k: v for k, v in thin["residuals"].items() if k not in ("qqX", "qqY")} == stats
    # A thinned Q-Q is a subset of the full one, ends included.
    pairs = set(zip(full["residuals"]["qqX"], full["residuals"]["qqY"], strict=True))
    thin_pairs = list(zip(thin["residuals"]["qqX"], thin["residuals"]["qqY"], strict=True))
    assert set(thin_pairs) <= pairs
    assert thin["residuals"]["qqY"][0] == full["residuals"]["qqY"][0]
    assert thin["residuals"]["qqY"][-1] == full["residuals"]["qqY"][-1]


def test_unknown_result_id_is_409_and_missing_input_is_422() -> None:
    r = client.post("/api/fitting/diagnostics", json={"result_id": "0" * 32, "n_params": 2})
    assert r.status_code == 409
    assert r.json()["detail"] == "unknown_fit_result"
    assert client.post("/api/fitting/diagnostics", json={"n_params": 2}).status_code == 422


def test_store_is_bounded() -> None:
    _fitresults.clear_fit_results()
    x, y, _ = _data(100)
    ids = [
        _post("/api/fitting/fit", {"model": "Linear", "x": x, "y": y,
                                   "return_residuals": False})[0]["resultId"]
        for _ in range(_fitresults._MAX_ENTRIES + 3)
    ]
    assert _fitresults.store_stats()["entries"] == _fitresults._MAX_ENTRIES
    first = client.post("/api/fitting/diagnostics", json={"result_id": ids[0], "n_params": 2})
    assert first.status_code == 409  # the oldest was evicted
    last = client.post("/api/fitting/diagnostics", json={"result_id": ids[-1], "n_params": 2})
    assert last.status_code == 200

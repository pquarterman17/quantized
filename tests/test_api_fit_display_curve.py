"""Display-curve fits (P4 phase 2, plans/LARGE_PAYLOAD_PLAN.md;
routes/_fitresults.py, ``/api/fitting/curve``, ``/bands`` by id).

Contracts:

* SIZE: with ``display_points`` a lean ``/fit`` carries no full-length array
  at all, and ``/bands`` by ``result_id`` posts no per-point arrays. Both
  failed before the change (``display_points`` / ``result_id`` were ignored:
  the full ``yFit`` came back, the band request had to carry ``obs_var``).
* IDENTITY: every parameter and statistic equals the full response; the
  full curve by id, and the fallback a client uses once the id is gone (the
  model evaluated at its own x, the weights resent for ``obsVar``), equal the
  full response's arrays exactly.
* OPT-IN: a request without ``return_residuals: false`` is unchanged.
"""

from __future__ import annotations

import json
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.decimate import display_row_indices
from quantized.routes import _fitresults

client = TestClient(app)

N = 50_000
POINTS = 2048


def _data(n: int = N) -> tuple[list[float], list[float], list[float]]:
    rng = np.random.default_rng(7)
    x = np.linspace(0.0, 100.0, n)
    y = 1000 * np.exp(-(((x - 50) / 3) ** 2)) + 2 * x + 5 + rng.normal(0, 5, n)
    dy = 4.0 + rng.random(n)
    return x.tolist(), y.tolist(), dy.tolist()


def _post(path: str, body: dict[str, Any]) -> tuple[dict[str, Any], int]:
    r = client.post(path, json=body)
    assert r.status_code == 200, r.text
    return r.json(), len(r.content)


def _bytes(a: Any) -> int:
    return len(json.dumps(a, separators=(",", ":")))


CASES: list[dict[str, Any]] = [
    {"model": "Gaussian"},
    {"model": "Gaussian", "weighted": True},
    {"model": "Linear", "weighted": "direct"},
    {"model": "Gaussian", "p0": [900, 50, 4, 0], "fixed": [False, True, False, False],
     "lower": [0, None, 0.1, None], "upper": [None, None, 20, None]},
]


def _body(spec: dict[str, Any]) -> dict[str, Any]:
    x, y, dy = _data()
    body = {k: v for k, v in spec.items() if k != "weighted"} | {"x": x, "y": y}
    if spec.get("weighted") is True:
        body["dy"] = dy
    elif spec.get("weighted") == "direct":
        body["weights"] = [1 / (d * d) for d in dy]
    return body


@pytest.mark.parametrize("spec", CASES)
def test_display_fit_is_bounded_and_identical(spec: dict[str, Any]) -> None:
    body = _body(spec)
    full, full_bytes = _post("/api/fitting/fit", body)
    disp, disp_bytes = _post(
        "/api/fitting/fit", {**body, "return_residuals": False, "display_points": POINTS})

    # SIZE (failed before: display_points was ignored, so yFit came back).
    assert "yFit" not in disp and "residuals" not in disp and "obsVar" not in disp
    assert disp_bytes < _bytes(full["yFit"]) / 4, (disp_bytes, full_bytes)
    rows, ys = disp["yFitDisplay"]["rows"], disp["yFitDisplay"]["y"]
    assert len(rows) <= 2 * POINTS + 2
    # The display curve IS the full curve at its rows, ends included.
    assert ys == [full["yFit"][r] for r in rows]
    assert rows == sorted(set(rows)) and rows[0] == 0 and rows[-1] == N - 1

    # IDENTITY: every parameter and statistic.
    left_out = {"yFit", "residuals", "obsVar"}
    assert {k: v for k, v in disp.items() if k not in ("resultId", "yFitDisplay")} == {
        k: v for k, v in full.items() if k not in left_out
    }

    # FULL RESOLUTION by id: exactly the full response's arrays.
    weighted = "weighted" in spec
    got, _ = _post("/api/fitting/curve", {"result_id": disp["resultId"], "obs_var": weighted})
    assert got["yFit"] == full["yFit"]
    if weighted:
        assert got["obsVar"] == full["obsVar"]

    # EVICTION FALLBACK: the model evaluated at the fit's own x (/bands,
    # covar null) is bit-identical to the fit's yFit.
    evaluated, _ = _post("/api/fitting/bands", {
        "model": body["model"], "params": disp["params"], "covar": None, "x": body["x"],
        "n_points": N, "n_free": disp["nFree"]})
    assert evaluated["yFit"] == full["yFit"]


def test_opt_in_only_and_default_unchanged() -> None:
    _fitresults.clear_fit_results()
    x, y, _ = _data(500)
    base = {"model": "Linear", "x": x, "y": y}
    plain, _ = _post("/api/fitting/fit", base)
    ignored, _ = _post("/api/fitting/fit", {**base, "display_points": 64})
    assert ignored == plain  # display_points alone changes nothing
    assert _fitresults.store_stats()["entries"] == 0


@pytest.mark.parametrize("mode", ["dy", "weights"])
def test_weighted_band_by_id_and_its_fallback_equal_by_arrays(mode: str) -> None:
    x, y, dy = _data()
    w = [1 / (d * d) for d in dy]
    body = {"model": "Gaussian", "x": x, "y": y, **({"dy": dy} if mode == "dy" else {"weights": w})}
    full, _ = _post("/api/fitting/fit", body)
    disp, _ = _post("/api/fitting/fit", {**body, "return_residuals": False, "display_points": 512})
    grid = np.linspace(0, 100, 256).tolist()
    common = {"model": "Gaussian", "params": full["params"], "covar": full["covar"], "x": grid,
              "n_points": full["nPoints"], "n_free": full["nFree"], "mse": full["MSE"]}
    by_arrays_body = {**common, "x_data": x, "obs_var": full["obsVar"]}
    expected, _ = _post("/api/fitting/bands", by_arrays_body)
    id_body = {**common, "result_id": disp["resultId"]}
    by_id, _ = _post("/api/fitting/bands", id_body)
    assert by_id == expected
    # SIZE (failed before: result_id was ignored, so the band fell back to
    # the scalar mse -- a different band -- unless obs_var was posted).
    assert _bytes(id_body) < 10_000 < _bytes(by_arrays_body)
    s2 = full["chiSqRed"] if full["errorsScaled"] else 1.0
    resend = {"obs_dy": dy} if mode == "dy" else {"obs_weights": w}
    fallback, _ = _post("/api/fitting/bands", {**common, "x_data": x, **resend, "obs_scale": s2})
    assert fallback == expected


def test_unknown_or_phase1_id_is_409() -> None:
    gone = client.post("/api/fitting/curve", json={"result_id": "0" * 32})
    assert gone.status_code == 409 and gone.json()["detail"] == "unknown_fit_result"
    x, y, _ = _data(300)
    lean, _ = _post("/api/fitting/fit", {"model": "Linear", "x": x, "y": y,
                                         "return_residuals": False})
    # A phase-1 lean fit kept no display arrays: /curve and /bands by id miss.
    curve = client.post("/api/fitting/curve", json={"result_id": lean["resultId"]})
    assert curve.status_code == 409
    band = {"model": "Linear", "params": lean["params"], "x": [0.0, 1.0], "n_points": 300,
            "n_free": 2, "result_id": lean["resultId"]}
    assert client.post("/api/fitting/bands", json=band).status_code == 409
    # ...while its diagnostics by id still answer (phase 1 unchanged).
    diag_body = {"result_id": lean["resultId"], "n_params": 2}
    diag = client.post("/api/fitting/diagnostics", json=diag_body)
    assert diag.status_code == 200


def test_display_rows_keep_every_gap_edge() -> None:
    y = np.sin(np.linspace(0, 20, 10_000))
    y[1000:1003] = np.nan
    y[7000] = np.inf
    rows = display_row_indices(y, 64)
    assert {1000, 1002, 7000} <= set(rows.tolist())
    assert rows.size <= 2 * 64 + 4
    assert np.all(np.diff(rows) > 0)

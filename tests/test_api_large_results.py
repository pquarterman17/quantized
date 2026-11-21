"""Baselines, peak backgrounds and signal-op results by id (P4 phase 4,
plans/LARGE_PAYLOAD_PLAN.md; routes/_arrayresults.py, ``/api/results/*``).

Contracts:

* SIZE: a lean SNIP / ModPoly / peak-find response carries no full-length
  array (only a per-bucket display), a lean sigop response no dataset rows,
  and ``/peaks/fit`` by ``find_result_id`` posts no background. All failed
  before the change (the opt-in fields were ignored and the arrays came back).
* IDENTITY: the full result fetched by id equals the full response exactly
  (deterministic calc), and a by-id peak fit equals the ``snip_bg`` fit.
* OPT-IN: a request without the new fields is byte-identical to before.
* 409: an unknown id, an id of another kind, and a find id used with other x/y.
"""

from __future__ import annotations

import json
from typing import Any

import numpy as np
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.routes import _arrayresults

client = TestClient(app)

N = 60_000
POINTS = 512


def _xy(n: int = N) -> tuple[list[float], list[float]]:
    rng = np.random.default_rng(3)
    x = np.linspace(10.0, 80.0, n)
    y = 800 * np.exp(-(((x - 40) / 0.4) ** 2)) + 0.5 * x + 20 + rng.normal(0, 2, n)
    return x.tolist(), y.tolist()


def _post(path: str, body: dict[str, Any], status: int = 200) -> tuple[Any, int]:
    r = client.post(path, json=body)
    assert r.status_code == status, r.text
    return r.json(), len(r.content)


def _fetch(rid: str, kind: str) -> list[Any]:
    out, _ = _post("/api/results/array", {"result_id": rid, "kind": kind})
    return out["values"]  # type: ignore[no-any-return]


def test_lean_snip_is_bounded_and_identical() -> None:
    x, y = _xy()
    body = {"x": x, "y": y, "method": "snip"}
    full, full_bytes = _post("/api/baseline/estimate", body)
    lean, lean_bytes = _post(
        "/api/baseline/estimate", {**body, "return_baseline": False, "display_points": POINTS})
    assert "baseline" not in lean and len(full["baseline"]) == N
    assert lean_bytes < full_bytes / 20
    assert lean_bytes < 60_000
    assert _fetch(lean["resultId"], "baseline") == full["baseline"]
    rows = lean["baselineDisplay"]["rows"]
    assert lean["baselineDisplay"]["y"] == [full["baseline"][i] for i in rows]


def test_lean_modpoly_keeps_info_and_is_identical() -> None:
    _, y = _xy()
    body = {"y": y, "order": 3}
    full, _ = _post("/api/baseline/modpoly", body)
    lean, lean_bytes = _post("/api/baseline/modpoly", {**body, "return_baseline": False})
    assert lean["info"] == full["info"] and "baseline" not in lean
    assert lean_bytes < 2_000  # no display requested: only the id and info
    assert _fetch(lean["resultId"], "baseline") == full["baseline"]


def test_default_requests_are_unchanged() -> None:
    x, y = _xy(2000)
    for path, body in (
        ("/api/baseline/estimate", {"x": x, "y": y}),
        ("/api/baseline/modpoly", {"y": y}),
        ("/api/peaks/find", {"x": x, "y": y}),
    ):
        out, _ = _post(path, body)
        assert "resultId" not in out
        # display_points alone (no return_* opt-in) is ignored too
        again, _ = _post(path, {**body, "display_points": 64})
        assert again == out
    assert set(_post("/api/baseline/modpoly", {"y": y})[0]) == {"baseline", "info"}


def test_lean_find_and_fit_by_id_match_by_array() -> None:
    x, y = _xy()
    find_body = {"x": x, "y": y, "max_peaks": 5}
    full, _ = _post("/api/peaks/find", find_body)
    lean, lean_bytes = _post(
        "/api/peaks/find", {**find_body, "return_background": False, "display_points": POINTS})
    assert lean["peaks"] == full["peaks"] and "background" not in lean
    assert lean_bytes < 60_000
    bg = _fetch(lean["resultId"], "background")
    assert bg == full["background"]

    fit = {"x": x, "y": y, "x_lo": 38.0, "x_hi": 42.0, "seed_center": 40.0, "model": "Gaussian"}
    by_array, array_bytes = _post("/api/peaks/fit", {**fit, "snip_bg": full["background"]})
    by_id, id_bytes = _post("/api/peaks/fit", {**fit, "find_result_id": lean["resultId"]})
    assert by_id == by_array
    plain, _ = _post("/api/peaks/fit", fit)
    assert plain != by_array  # the background really is subtracted by id
    # the request no longer carries the background: one array of N floats less
    body_id = len(json.dumps({**fit, "find_result_id": lean["resultId"]}))
    body_array = len(json.dumps({**fit, "snip_bg": full["background"]}))
    assert body_array - body_id > 0.25 * body_array


def test_find_id_is_409_for_other_data_unknown_or_wrong_kind() -> None:
    x, y = _xy(4000)
    lean, _ = _post("/api/peaks/find", {"x": x, "y": y, "return_background": False})
    fit = {"x_lo": 38.0, "x_hi": 42.0, "seed_center": 40.0, "find_result_id": lean["resultId"]}
    y2 = list(y)
    y2[5] += 1e-9
    _post("/api/peaks/fit", {**fit, "x": x, "y": y2}, status=409)
    _post("/api/peaks/fit", {**fit, "x": x, "y": y})
    _post("/api/peaks/fit", {**fit, "find_result_id": "0" * 32, "x": x, "y": y}, status=409)
    base, _ = _post("/api/baseline/modpoly", {"y": y, "return_baseline": False})
    _post("/api/peaks/fit", {**fit, "find_result_id": base["resultId"], "x": x, "y": y}, status=409)
    _post("/api/results/array", {"result_id": lean["resultId"], "kind": "baseline"}, status=409)
    _post("/api/results/dataset", {"result_id": lean["resultId"]}, status=409)


def _dataset(n: int) -> dict[str, Any]:
    rng = np.random.default_rng(5)
    t = np.linspace(0, 10, n)
    vals = np.column_stack([np.sin(t) + rng.normal(0, 0.1, n), np.cos(t) + rng.normal(0, 0.1, n)])
    return {"time": t.tolist(), "values": vals.tolist(), "labels": ["a", "b"],
            "units": ["", ""], "metadata": {}}


def test_lean_sigop_is_bounded_and_identical() -> None:
    body = {"dataset": _dataset(N), "method": "median", "channels": [0, 1], "args": {"window": 5}}
    full, full_bytes = _post("/api/transform/sigop", body)
    lean, lean_bytes = _post(
        "/api/transform/sigop", {**body, "return_dataset": False, "display_points": POINTS})
    assert lean["dataset"]["time"] == [] and lean["dataset"]["values"] == []
    assert lean["rows_out"] == full["rows_out"] == N
    assert lean["dataset"]["labels"] == full["dataset"]["labels"]
    assert lean_bytes < full_bytes / 10 and lean_bytes < 200_000
    whole, _ = _post("/api/results/dataset", {"result_id": lean["resultId"]})
    assert whole["dataset"] == full["dataset"]
    disp = lean["datasetDisplay"]
    assert disp["values"] == [full["dataset"]["values"][i] for i in disp["rows"]]
    assert disp["time"] == [full["dataset"]["time"][i] for i in disp["rows"]]


def test_default_sigop_is_unchanged() -> None:
    body = {"dataset": _dataset(500), "method": "median", "channels": [0], "args": {"window": 5}}
    out, _ = _post("/api/transform/sigop", body)
    assert set(out) == {"dataset", "warnings", "flagged", "rows_in", "rows_out"}
    again, _ = _post("/api/transform/sigop", {**body, "display_points": 64})
    assert again == out


def test_store_is_bounded_and_lru() -> None:
    _arrayresults.clear_results()
    y = np.arange(1000.0)
    ids = [_arrayresults.lean_array_fields("baseline", "baseline", y, None)["resultId"]
           for _ in range(_arrayresults._MAX_ENTRIES + 4)]
    assert _arrayresults.store_stats()["entries"] == _arrayresults._MAX_ENTRIES
    _post("/api/results/array", {"result_id": ids[0], "kind": "baseline"}, status=409)
    _post("/api/results/array", {"result_id": ids[-1], "kind": "baseline"})
    _arrayresults.clear_results()

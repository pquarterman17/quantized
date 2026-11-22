"""Inputs by dataset handle for the remaining heavy routes, weights by channel
and lean responses for the other baselines (lane D, plans/LARGE_PAYLOAD_PLAN.md;
routes/_datasetrows.py).

Same contract as ``test_api_fit_by_handle.py`` (whose dataset and client
selection rules are reused): per client rule, the by-handle response is the
byte-identical body of the array request; a miss is 409; mixing is 422; the
old request shape is unchanged (no handle header). New here:

* ``y``-only (ALS, rolling ball, ModPoly) and ``x``-only (descriptive) sources;
* ``dy_channel`` / ``weights_channel`` equal the ``dy`` / ``weights`` arrays the
  client builds (``dyForFit``: ``|error column|``, or the weight column);
* sigop by ``dataset_handle`` equals the posted dataset, ``-0`` and Inf included;
* the lean ALS / rolling ball / anchor / Shirley / region responses.
"""

from __future__ import annotations

import json
import math
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.datastruct import DataStruct
from quantized.routes import _datasetcache
from test_api_fit_by_handle import DATA, RULES, N, _by_rows, _client_selection, _col, _handle

client = TestClient(app)

# A well-seeded fit converges; a badly seeded one runs to its wall-clock
# deadline and is not deterministic.
PEAK = {"peaks": [{"center": 45.0, "fwhm": 8.0, "height": 900.0}], "model": "Gaussian"}
XY_ROUTES: dict[str, dict[str, Any]] = {
    "/api/baseline/estimate": {"method": "snip"},
    "/api/baseline/anchor": {"anchors": [[0.0, 5.0], [40.0, 90.0], [90.0, 190.0]]},
    "/api/baseline/shirley": {},
    "/api/baseline/region": {"x_min": 0.0, "x_max": 30.0, "order": 2},
    "/api/baseline/xrdlowangle": {},
    "/api/peaks/fit-multi": PEAK,
    "/api/stats/regression": {"order": 2, "band_x": [1.0, 5.0, 9.0]},
}
Y_ROUTES: dict[str, dict[str, Any]] = {
    "/api/baseline/als": {},
    "/api/baseline/rollingball": {"radius": 50},
    "/api/baseline/modpoly": {},
}
MAY_REFUSE = ("/api/baseline/xrdlowangle", "/api/baseline/shirley", "/api/baseline/region")


def _same(a: Any, b: Any) -> None:
    assert a.status_code == b.status_code, (a.text, b.text)
    assert a.content == b.content
    assert "X-Dataset-Handle" not in a.headers


def _runs(rows: list[int]) -> list[list[int]]:
    out: list[list[int]] = []
    for r in rows:
        if out and out[-1][0] + out[-1][1] == r:
            out[-1][1] += 1
        else:
            out.append([r, 1])
    return out


@pytest.mark.parametrize("route", XY_ROUTES)
@pytest.mark.parametrize("rule", RULES)
def test_xy_routes_by_handle_are_identical(route: str, rule: str) -> None:
    xc, yc, kw = RULES[rule]
    x, y, rows = _client_selection(xc, yc, **kw)
    body = XY_ROUTES[route]
    if route == "/api/peaks/fit-multi" and yc != 1:  # seed the peak the channel holds
        body = {**PEAK, "peaks": [{"center": 30.0, "fwhm": 6.0, "height": 600.0}]}
    a = client.post(route, json={**body, "x": x, "y": y})
    b = client.post(route, json=_by_rows(body, xc, yc, rows, handle=_handle()))
    _same(a, b)
    if route not in MAY_REFUSE:
        assert a.status_code == 200, a.text


def _y_only(body: dict[str, Any], yc: int, rows: list[int], handle: str) -> dict[str, Any]:
    return {**body, "dataset_handle": handle, "y_channel": yc, "rows": _runs(rows)}


@pytest.mark.parametrize("route", Y_ROUTES)
@pytest.mark.parametrize("rule", RULES)
def test_y_routes_by_handle_are_identical(route: str, rule: str) -> None:
    xc, yc, kw = RULES[rule]
    _, y, rows = _client_selection(xc, yc, **kw)
    body = Y_ROUTES[route]
    a = client.post(route, json={**body, "y": y})
    b = client.post(route, json=_y_only(body, yc, rows, _handle()))
    _same(a, b)
    assert a.status_code == 200, a.text


def test_descriptive_by_handle_keeps_gaps_like_null() -> None:
    col = _col(1)  # R1 has NaN rows: posted as null
    rows = list(range(50, 400))
    posted = [None if math.isnan(col[r]) else col[r] + 0.0 for r in rows]
    a = client.post("/api/stats/descriptive", json={"x": posted})
    b = client.post("/api/stats/descriptive", json={
        "dataset_handle": _handle(), "x_channel": 1, "rows": [[50, 350]]})
    _same(a, b)
    assert sum(v is None for v in posted) == 60


def test_old_requests_are_unchanged_and_mixing_is_422() -> None:
    small = client.post("/api/baseline/als", json={"y": [1.0, 2.0, 3.0, 2.0, 1.0]})
    assert small.status_code == 200
    sel = {"dataset_handle": "h", "y_channel": 1, "x_channel": 1, "rows": [[0, 1]]}
    cases = (("/api/baseline/als", {"y": [1.0]}), ("/api/stats/descriptive", {"x": [1.0]}))
    for route, body in cases:
        assert client.post(route, json={**body, **sel}).status_code == 422
        assert client.post(route, json={}).status_code == 422
    assert client.post("/api/baseline/anchor", json={"x": [1.0], "anchors": []}).status_code == 422


@pytest.mark.parametrize("route", [*XY_ROUTES, *Y_ROUTES, "/api/stats/descriptive"])
def test_unknown_handle_is_409(route: str) -> None:
    body = {**XY_ROUTES.get(route, Y_ROUTES.get(route, {})),
            "dataset_handle": "0" * 32, "x_channel": 0, "y_channel": 1, "rows": [[0, 10]]}
    if route in Y_ROUTES:
        body.pop("x_channel")
    if route == "/api/stats/descriptive":
        body.pop("y_channel")
    assert client.post(route, json=body).status_code == 409


def test_posted_dataset_is_cached_and_answered_with_a_handle() -> None:
    _datasetcache.clear_cache()
    body = {"dataset": DATA, "y_channel": 1, "rows": [[200, 400]]}
    first = client.post("/api/baseline/als", json=body)
    assert first.status_code == 200
    again = client.post("/api/baseline/als", json={
        "dataset_handle": first.headers["X-Dataset-Handle"], "y_channel": 1, "rows": [[200, 400]]})
    assert again.content == first.content


# -- weights by channel -------------------------------------------------------

def _with_error_columns() -> dict[str, Any]:
    """DATA plus E (positive sigma), En (the same, negative) and W (weights
    with zeros): columns 4..6."""
    n = len(DATA["time"])
    sig = [3.0 + (i % 5) * 0.25 for i in range(n)]
    wts = [0.0 if i % 11 == 0 else 1.0 + (i % 3) for i in range(n)]
    values = [[*row, sig[i], -sig[i], wts[i]] for i, row in enumerate(DATA["values"])]
    return {**DATA, "values": values, "labels": [*DATA["labels"], "E", "En", "W"],
            "units": [*DATA["units"], "", "", ""]}


DATA7 = _with_error_columns()


def _handle7() -> str:
    r = client.post("/api/fitting/fit", json={"model": "Linear", "dataset": DATA7, "x_channel": 0,
                                                "y_channel": 1, "rows": [[0, 1]]})
    assert r.status_code == 200, r.text
    return str(r.headers["X-Dataset-Handle"])


def _post7(route: str, body: dict[str, Any], rows: list[int], xc: int = 0, yc: int = 1) -> Any:
    return client.post(route, json={**body, "dataset_handle": _handle7(), "x_channel": xc,
                                    "y_channel": yc, "rows": _runs(rows)})


@pytest.mark.parametrize("route", ["/api/fitting/fit", "/api/fitting/equation/fit"])
@pytest.mark.parametrize("rule", ["analysis view", "exclusions", "selection", "gap drop"])
@pytest.mark.parametrize(
    ("channel_field", "column", "array_field", "fn"),
    [("dy_channel", 4, "dy", abs), ("dy_channel", 5, "dy", abs),
     ("weights_channel", 6, "weights", float)],
)
def test_weights_by_channel_equal_the_arrays(
    route: str, rule: str, channel_field: str, column: int, array_field: str, fn: Any
) -> None:
    xc, yc, kw = RULES[rule]
    x, y, rows = _client_selection(xc, yc, **kw)
    vec = [fn(DATA7["values"][r][column]) + 0.0 for r in rows]
    if "equation" in route:
        base: dict[str, Any] = {"equation": "a*exp(-((x-b)/c)^2)+d*x+f",
                                "guesses": [900.0, 45.0, 4.0, 2.0, 5.0]}
    else:
        base = {"model": "Gaussian"}
    for extra in ({}, {"return_residuals": False, "display_points": 512}):
        a = client.post(route, json={**base, **extra, "x": x, "y": y, array_field: vec})
        b = _post7(route, {**base, **extra, channel_field: column}, rows, xc, yc)
        assert a.status_code == b.status_code == 200, b.text
        ja, jb = a.json(), b.json()
        ja.pop("resultId", None)
        jb.pop("resultId", None)
        assert json.dumps(ja) == json.dumps(jb)


def test_weight_channel_guards() -> None:
    rows = list(range(100, 300))
    body = {"model": "Linear"}
    both = _post7("/api/fitting/fit", {**body, "dy": [1.0] * len(rows), "dy_channel": 4}, rows)
    assert both.status_code == 422 and "not both" in both.text
    posted = client.post("/api/fitting/fit", json={**body, "x": [1.0, 2.0, 3.0],
                                                    "y": [1.0, 2.0, 2.5],
                                                    "dy_channel": 4})
    assert posted.status_code == 422 and "row selection" in posted.text
    gap = _post7("/api/fitting/fit", {**body, "dy_channel": 1}, list(range(90, 110)))
    assert gap.status_code == 422  # R1 has NaN rows 100-159
    bad = _post7("/api/fitting/fit", {**body, "dy_channel": 9}, rows)
    assert bad.status_code == 422 and "channel 9" in bad.text
    miss = client.post("/api/fitting/fit", json={**body, "dy_channel": 4,
                                                  "dataset_handle": "0" * 32,
                                                  "x_channel": 0, "y_channel": 1, "rows": [[0, 5]]})
    assert miss.status_code == 409


def test_weights_by_channel_size_is_independent_of_rows() -> None:
    x, y, rows = _client_selection(0, 1)
    arrays = len(json.dumps({"model": "Gaussian", "x": x, "y": y, "dy": [3.0] * len(rows)}))
    sel = _by_rows({"model": "Gaussian", "dy_channel": 4}, 0, 1, rows, handle="h" * 32)
    assert arrays > 1_000_000
    assert len(json.dumps(sel)) < 3_000


# -- sigop ----------------------------------------------------------------------

SIGOP = {"method": "median", "channels": [0, 1], "args": {"window": 5}}


def test_sigop_by_handle_is_identical() -> None:
    handle = _handle()
    a = client.post("/api/transform/sigop", json={**SIGOP, "dataset": DATA})
    b = client.post("/api/transform/sigop", json={**SIGOP, "dataset_handle": handle})
    _same(a, b)
    assert a.status_code == 200
    lean = {**SIGOP, "return_dataset": False, "display_points": 256}
    la = client.post("/api/transform/sigop", json={**lean, "dataset": DATA})
    lb = client.post("/api/transform/sigop", json={**lean, "dataset_handle": handle})
    assert la.status_code == lb.status_code == 200
    ja, jb = la.json(), lb.json()
    ja.pop("resultId")
    jb.pop("resultId")
    assert ja == jb


def test_sigop_by_handle_reads_the_cached_dataset_as_json_would_carry_it() -> None:
    time = np.arange(20.0)
    vals = np.column_stack([np.sin(time), np.cos(time)])
    vals[3, 0] = -0.0
    vals[5, 1] = np.inf
    vals[7, 0] = np.nan
    ds = DataStruct.create(time=time, values=vals, labels=["a", "b"], units=["", ""], metadata={})
    handle = _datasetcache.cache_dataset(ds)
    assert handle
    posted = {"time": time.tolist(),
              "values": [[None if not math.isfinite(v) else v + 0.0 for v in r]
                         for r in vals.tolist()],
              "labels": ["a", "b"], "units": ["", ""], "metadata": {}}
    for method, ch in (("median", [0, 1]), ("lowess", [0])):
        body = {"method": method, "channels": ch, "args": {}}
        a = client.post("/api/transform/sigop", json={**body, "dataset": posted})
        b = client.post("/api/transform/sigop", json={**body, "dataset_handle": handle})
        _same(a, b)


def test_sigop_handle_miss_and_missing_dataset() -> None:
    miss = client.post("/api/transform/sigop", json={**SIGOP, "dataset_handle": "0" * 32})
    assert miss.status_code == 409
    assert client.post("/api/transform/sigop", json=SIGOP).status_code == 422
    both = client.post("/api/transform/sigop",
                       json={**SIGOP, "dataset": DATA, "dataset_handle": "0" * 32})
    assert both.status_code == 200  # the posted dataset wins; no handle is looked up


# -- lean baselines --------------------------------------------------------------

LEAN: dict[str, tuple[dict[str, Any], str]] = {
    "/api/baseline/als": ({}, "baseline"),
    "/api/baseline/rollingball": ({"radius": 50}, "baseline"),
    "/api/baseline/anchor": (XY_ROUTES["/api/baseline/anchor"], "baseline"),
    "/api/baseline/shirley": ({}, "baseline"),
    "/api/baseline/region": (XY_ROUTES["/api/baseline/region"], "background"),
}


@pytest.mark.parametrize("route", LEAN)
def test_lean_baselines_are_bounded_and_identical(route: str) -> None:
    body, full_key = LEAN[route]
    _, y, _ = _client_selection(0, 1)
    x = [i * 0.003 for i in range(len(y))]  # strictly monotone (Shirley needs it)
    if route.endswith("shirley"):  # a core-level shape it converges on: peak on a step
        peak = np.exp(-(((np.array(x) - 45.0) / 8.0) ** 2))
        y = (10 + 200 * peak + 50 * (1 - np.cumsum(peak) / peak.sum())).tolist()
    req = {**body, "y": y} if route in Y_ROUTES else {**body, "x": x, "y": y}
    full = client.post(route, json=req)
    assert full.status_code == 200, full.text
    lean = client.post(route, json={**req, "return_baseline": False, "display_points": 256})
    assert lean.status_code == 200, lean.text
    jl, jf = lean.json(), full.json()
    assert "baseline" not in jl and "background" not in jl
    assert len(lean.content) < len(full.content) / 4
    assert len(jl["baselineDisplay"]["rows"]) <= 1024
    whole = client.post(
        "/api/results/array", json={"result_id": jl["resultId"], "kind": "baseline"})
    assert whole.status_code == 200
    assert whole.json()["values"] == jf[full_key]
    for k, v in jf.items():  # every other field (info, coeffs, stats) is unchanged
        if k != full_key:
            assert jl[k] == v
    assert "resultId" not in jf and "baselineDisplay" not in jf  # the default is the old response


def test_lean_baseline_by_handle_matches_lean_by_arrays() -> None:
    _, y, rows = _client_selection(0, 1)
    lean = {"return_baseline": False, "display_points": 128}
    a = client.post("/api/baseline/als", json={"y": y, **lean})
    b = client.post("/api/baseline/als", json={**_y_only({}, 1, rows, _handle()), **lean})
    ja, jb = a.json(), b.json()
    assert ja.pop("resultId") and jb.pop("resultId")
    assert ja == jb
    assert N > 0

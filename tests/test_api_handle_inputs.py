"""``/autoguess``, ``/equation/fit`` and ``/peaks/find`` inputs by dataset
handle (lane P8, plans/LARGE_PAYLOAD_PLAN.md; routes/_datasetrows.XYSource).

The same contract as ``test_api_fit_by_handle.py`` (whose dataset and client
selection rules are reused): per client rule, the by-handle response is the
byte-identical body of the array request; the old request shape is unchanged
(no handle header); a miss is 409; the 422 guards hold; the request is small.
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.routes import _datasetcache
from test_api_fit_by_handle import (
    RULES,
    _by_rows,
    _client_selection,
    _handle,
    _strip_id,
)

client = TestClient(app)

EQUATION = {"equation": "a*exp(-((x-b)/c)^2)+d*x+f", "guesses": [900.0, 45.0, 4.0, 2.0, 5.0]}
EQUATION_FITS: list[dict[str, Any]] = [
    EQUATION,
    {**EQUATION, "return_residuals": False, "display_points": 512},
]
ROUTES = ["/api/fitting/autoguess", "/api/fitting/equation/fit", "/api/peaks/find"]


def _body_for(route: str) -> dict[str, Any]:
    if "autoguess" in route:
        return {"model": "Linear"}
    return {"equation": "a*x+b"} if "equation" in route else {}


def _pair(route: str, body: dict[str, Any], rule: str) -> tuple[Any, Any]:
    xc, yc, kw = RULES[rule]
    x, y, rows = _client_selection(xc, yc, **kw)
    by_arrays = client.post(route, json={**body, "x": x, "y": y})
    by_handle = client.post(route, json=_by_rows(body, xc, yc, rows, handle=_handle()))
    assert by_arrays.status_code == by_handle.status_code == 200, by_handle.text
    assert "X-Dataset-Handle" not in by_arrays.headers
    return by_arrays, by_handle


@pytest.mark.parametrize("model", ["Gaussian", "Linear"])
@pytest.mark.parametrize("rule", list(RULES))
def test_autoguess_by_handle_is_identical(rule: str, model: str) -> None:
    a, b = _pair("/api/fitting/autoguess", {"model": model}, rule)
    assert a.content == b.content


@pytest.mark.parametrize("fit", EQUATION_FITS, ids=["full", "display"])
@pytest.mark.parametrize("rule", list(RULES))
def test_equation_fit_by_handle_is_identical(rule: str, fit: dict[str, Any]) -> None:
    a, b = _pair("/api/fitting/equation/fit", fit, rule)
    if fit.get("return_residuals") is False:
        assert _strip_id(b.json()) == _strip_id(a.json())
        assert b.json()["resultId"]
    else:
        assert b.content == a.content


def test_equation_fit_weighted_and_auto_start_by_handle_is_identical() -> None:
    x, y, rows = _client_selection(0, 1)
    dy = [3.0 + (i % 5) * 0.25 for i in range(len(rows))]
    # A blank start is derived from the data (auto_start): it must see the same x/y.
    body = {"equation": EQUATION["equation"], "guesses": [None, None, None, 2.0, 5.0], "dy": dy}
    a = client.post("/api/fitting/equation/fit", json={**body, "x": x, "y": y})
    b = client.post("/api/fitting/equation/fit", json=_by_rows(body, 0, 1, rows, handle=_handle()))
    assert a.status_code == b.status_code == 200, b.text
    assert a.content == b.content


@pytest.mark.parametrize("extra", [{}, {"bg_method": "polynomial"}, {"strict_prominence": True}])
@pytest.mark.parametrize("rule", list(RULES))
def test_peak_find_by_handle_is_identical(rule: str, extra: dict[str, Any]) -> None:
    a, b = _pair("/api/peaks/find", extra, rule)
    assert a.content == b.content


def test_lean_peak_find_by_handle_then_fit_by_id_on_posted_arrays() -> None:
    """The background id of a by-handle find is bound to the gathered x/y, so
    the same x/y posted as arrays to /peaks/fit accepts it (and a different
    selection does not)."""
    x, y, rows = _client_selection(0, 1)
    lean = {"return_background": False, "display_points": 256}
    found = client.post("/api/peaks/find", json={
        **lean, **_by_rows({}, 0, 1, rows, handle=_handle())})
    arr = client.post("/api/peaks/find", json={**lean, "x": x, "y": y})
    assert found.status_code == arr.status_code == 200
    assert _strip_id(found.json()) == _strip_id(arr.json())
    fit_body = {"x": x, "y": y, "x_lo": 33.0, "x_hi": 57.0, "seed_center": 45.0,
                "seed_fwhm": 6.0, "model": "Gaussian"}
    rid = found.json()["resultId"]
    ok = client.post("/api/peaks/fit", json={**fit_body, "find_result_id": rid})
    assert ok.status_code == 200, ok.text
    other = client.post("/api/peaks/fit", json={
        **fit_body, "x": x[1:], "y": y[1:], "find_result_id": rid})
    assert other.status_code == 409


@pytest.mark.parametrize("route", ROUTES)
def test_unknown_handle_is_409_and_a_posted_dataset_earns_one(route: str) -> None:
    body = _body_for(route)
    _, _, rows = _client_selection(0, 1)
    miss = client.post(route, json=_by_rows(body, 0, 1, rows, handle="0" * 32))
    assert miss.status_code == 409
    assert miss.json()["detail"] == "unknown_dataset_handle"
    _datasetcache.clear_cache()
    first = client.post(route, json=_by_rows(body, 0, 1, rows, dataset=True))
    assert first.status_code == 200, first.text
    handle = first.headers["X-Dataset-Handle"]
    again = client.post(route, json=_by_rows(body, 0, 1, rows, handle=handle))
    assert again.content == first.content


@pytest.mark.parametrize("route", ROUTES)
@pytest.mark.parametrize(
    ("patch", "needle"),
    [
        ({"x": [1.0, 2.0], "y": [1.0, 2.0]}, "not both"),
        ({"rows": [[99, 3]]}, "gap"),
        ({"y_channel": 4}, "channel 4"),
        ({"rows": [[10, 5], [12, 5]]}, "ascending"),
        ({"x_channel": None}, "x_channel"),
    ],
)
def test_bad_selection_is_422(route: str, patch: dict[str, Any], needle: str) -> None:
    full = {**_by_rows(_body_for(route), 0, 1, list(range(200, 400)), handle=_handle()), **patch}
    r = client.post(route, json=full)
    assert r.status_code == 422, r.text
    assert needle in r.text


@pytest.mark.parametrize("route", ROUTES)
def test_missing_xy_is_still_422(route: str) -> None:
    assert client.post(route, json={**_body_for(route), "x": [1.0]}).status_code == 422
    assert client.post(route, json=_body_for(route)).status_code == 422


def test_request_size_is_independent_of_rows() -> None:
    x, y, rows = _client_selection(0, 3)
    arrays = len(json.dumps({"equation": "a*x+b", "x": x, "y": y}))
    by_rows = len(json.dumps(_by_rows({"equation": "a*x+b"}, 0, 3, rows, handle="h" * 32)))
    assert arrays > 900_000
    assert by_rows < 2_000

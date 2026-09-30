"""Dataset-bearing routes decode their JSON body off the event loop.

``routes/_offloop.py``'s ``OffloopJSONRoute`` moves ``json.loads`` of the body
into the threadpool (a 1M x 7 dataset is ~146 MB of JSON; decoding it on the
loop froze every other request for seconds). Two guards: every route whose
body carries a dataset uses it, and the decode really happens on a thread with
no running event loop -- with the result and error behaviour unchanged.
"""

from __future__ import annotations

import asyncio
import importlib
import json
import pkgutil
from typing import Any

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from pydantic import TypeAdapter

import quantized.routes as routes_pkg
from quantized.app import app
from quantized.routes import _offloop

client = TestClient(app)


def _api_routes() -> list[tuple[str, APIRoute]]:
    out: list[tuple[str, APIRoute]] = []
    for info in pkgutil.iter_modules(routes_pkg.__path__):
        router = getattr(importlib.import_module(f"quantized.routes.{info.name}"), "router", None)
        if router is None:
            continue
        out += [(info.name, r) for r in router.routes if isinstance(r, APIRoute)]
    return out


def _carries_dataset(route: APIRoute) -> bool:
    if route.body_field is None:
        return False
    schema = TypeAdapter(route.body_field.field_info.annotation).json_schema()
    return '"dataset' in json.dumps(schema)


DATASET_ROUTES = [(mod, r) for mod, r in _api_routes() if _carries_dataset(r)]


def test_the_dataset_route_list_is_not_empty() -> None:
    paths = {r.path for _, r in DATASET_ROUTES}
    assert {"/api/plot/series", "/api/plot/map", "/api/datasets/patch", "/api/rsm/box"} <= paths


@pytest.mark.parametrize(
    "route", [r for _, r in DATASET_ROUTES], ids=[f"{m}:{r.path}" for m, r in DATASET_ROUTES]
)
def test_every_dataset_route_decodes_off_the_event_loop(route: APIRoute) -> None:
    assert isinstance(route, _offloop.OffloopJSONRoute), (
        f"{route.path} takes a dataset; give its router route_class=OffloopJSONRoute"
    )


def _loop_running_here() -> bool:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return False
    return True


def test_body_is_decoded_on_a_thread_without_the_event_loop(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: list[bool] = []
    real = _offloop._loads

    def spy(body: Any) -> Any:
        seen.append(_loop_running_here())
        return real(body)

    monkeypatch.setattr(_offloop, "_loads", spy)
    ds = {"time": [0.0, 1.0], "values": [[1.0], [2.0]], "labels": ["a"], "units": [""]}
    resp = client.post("/api/plot/series", json={"dataset": ds})
    assert resp.status_code == 200, resp.text
    assert resp.json()["data"] == [[0.0, 1.0], [1.0, 2.0]]
    assert seen == [False]


def test_yielding_decoder_matches_json_loads_exactly() -> None:
    body = (
        '{"a": [0, 1, -0, 12345678901234567890, 0.1, -0.0, 1e308, 5e-324, 2.5E+3],'
        ' "b": [NaN, Infinity, -Infinity, null, true, "x"], "c": {"d": [[1.5, 2], []]}}'
    )
    got = _offloop._loads(body)
    want = json.loads(body)
    assert json.dumps(got) == json.dumps(want)
    assert [type(v) for v in got["a"]] == [type(v) for v in want["a"]]
    assert str(got["a"][5]) == "-0.0"
    # bytes, as the route passes them
    assert json.dumps(_offloop._loads(body.encode())) == json.dumps(want)


def test_malformed_json_is_still_a_422() -> None:
    resp = client.post(
        "/api/plot/series", content=b'{"dataset": ', headers={"content-type": "application/json"}
    )
    assert resp.status_code == 422
    assert resp.json()["detail"][0]["type"] == "json_invalid"

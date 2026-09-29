"""The Figure Builder preview's dataset-handle contract on
``/api/export/figure-hitmap`` (the ``CachedDatasetRequest`` pattern
``/api/plot/series`` already uses), plus the preview's skip-when-the-client-
has-gone rule under the render lock.

The preview re-rendered on every property edit and re-POSTed the whole
dataset each time; a handle lets every render after the first send a short
string instead.
"""

from __future__ import annotations

import asyncio
import threading
from collections.abc import Awaitable, Callable, Iterator
from typing import Any, cast

import pytest
from fastapi.testclient import TestClient
from starlette.requests import Request

from quantized.app import app
from quantized.routes import _datasetcache as dc
from quantized.routes import export_figures
from quantized.routes._disconnect import run_watching_disconnect

client = TestClient(app)


@pytest.fixture(autouse=True)
def _clear_cache_between_tests() -> Iterator[None]:
    dc.clear_cache()
    yield
    dc.clear_cache()


def _ds() -> dict[str, Any]:
    return {
        "time": [1.0, 2.0, 3.0, 4.0],
        "values": [[1.0, 2.0], [4.0, 3.0], [9.0, 5.0], [16.0, 7.0]],
        "labels": ["a", "b"],
        "units": ["V", "V"],
        "metadata": {},
    }


def _spec(**extra: Any) -> dict[str, Any]:
    return {"title": "T", "dpi": 60, "y_keys": [0, 1], **extra}


def test_hitmap_echoes_a_handle_and_a_handle_render_matches_the_full_one() -> None:
    first = client.post("/api/export/figure-hitmap", json=_spec(dataset=_ds()))
    assert first.status_code == 200
    handle = first.headers.get("x-dataset-handle")
    assert handle

    second = client.post("/api/export/figure-hitmap", json=_spec(dataset_handle=handle))
    assert second.status_code == 200
    assert second.headers.get("x-dataset-handle") == handle
    assert second.json() == first.json()


def test_hitmap_unknown_handle_is_409_so_the_client_resends() -> None:
    resp = client.post("/api/export/figure-hitmap", json=_spec(dataset_handle="nope"))
    assert resp.status_code == 409
    assert resp.json()["detail"] == "unknown_dataset_handle"


def test_figure_request_needs_a_dataset_or_a_handle() -> None:
    assert client.post("/api/export/figure-hitmap", json=_spec()).status_code == 422
    assert client.post("/api/export/figure", json=_spec(fmt="svg")).status_code == 422


def test_one_shot_figure_export_does_not_fill_the_cache() -> None:
    # A download is not a repeat-fetch loop: a full `dataset` on /figure must
    # not evict the datasets the plot and preview are reusing.
    resp = client.post("/api/export/figure", json=_spec(dataset=_ds(), fmt="svg"))
    assert resp.status_code == 200
    assert dc.cache_stats()["entries"] == 0
    assert "x-dataset-handle" not in resp.headers


def test_one_shot_figure_export_rejects_a_stale_handle_as_bad_input() -> None:
    # No client transport retries /figure on a 409, so a stale handle there
    # is a plain 422 -- and the same ValueError is what a report turns into a
    # named placeholder instead of failing the whole export.
    resp = client.post("/api/export/figure", json=_spec(dataset_handle="gone", fmt="svg"))
    assert resp.status_code == 422
    assert "dataset_handle" in resp.json()["detail"]


def test_figure_export_accepts_a_handle_from_the_preview() -> None:
    handle = client.post("/api/export/figure-hitmap", json=_spec(dataset=_ds())).headers[
        "x-dataset-handle"
    ]
    resp = client.post("/api/export/figure", json=_spec(dataset_handle=handle, fmt="svg"))
    assert resp.status_code == 200
    assert resp.content.lstrip().startswith(b"<?xml")


def _fake_watch(already_gone: bool) -> Any:
    async def run(request: Request, fn: Callable[[threading.Event], Any]) -> Any:
        gone = threading.Event()
        if already_gone:
            gone.set()
        return fn(gone)

    return run


def test_hitmap_skips_the_render_when_the_client_already_aborted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # A superseded preview the browser aborted while it waited on the render
    # lock must not spend a render the next preview is queued behind.
    from quantized.calc import figure as figure_mod

    rendered: list[int] = []
    real = figure_mod.render_figure_map

    def spy(*args: Any, **kwargs: Any) -> Any:
        rendered.append(1)
        return real(*args, **kwargs)

    monkeypatch.setattr(figure_mod, "render_figure_map", spy)
    monkeypatch.setattr(export_figures, "run_watching_disconnect", _fake_watch(True))
    resp = client.post("/api/export/figure-hitmap", json=_spec(dataset=_ds()))
    assert resp.status_code == 499
    assert rendered == []

    monkeypatch.setattr(export_figures, "run_watching_disconnect", _fake_watch(False))
    assert client.post("/api/export/figure-hitmap", json=_spec(dataset=_ds())).status_code == 200
    assert rendered == [1]


class _FakeRequest:
    def __init__(self, receive: Callable[[], Awaitable[dict[str, Any]]]) -> None:
        self.receive = receive


def test_watcher_sets_gone_when_the_client_disconnects() -> None:
    async def disconnect() -> dict[str, Any]:
        return {"type": "http.disconnect"}

    async def main() -> bool:
        req = cast(Request, _FakeRequest(disconnect))
        return await run_watching_disconnect(req, lambda gone: gone.wait(5.0))

    assert asyncio.run(main()) is True


def test_watcher_leaves_gone_clear_and_returns_while_the_client_stays() -> None:
    async def never() -> dict[str, Any]:
        await asyncio.Event().wait()
        raise AssertionError("unreachable")

    async def main() -> tuple[bool, str]:
        req = cast(Request, _FakeRequest(never))
        return await run_watching_disconnect(req, lambda gone: (gone.is_set(), "done"))

    assert asyncio.run(main()) == (False, "done")

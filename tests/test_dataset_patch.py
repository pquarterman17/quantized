"""Cell-patch uploads: ``POST /api/datasets/patch``.

A worksheet cell edit mints a new DataStruct that differs from one the server
already holds in a handful of cells. The client sends the parent's handle plus
the changed cells instead of the whole dataset; the server clones the cached
parent, applies the cells and caches the result under its own content hash.

The load-bearing property is that a patch lands on EXACTLY the entry a full
upload of the same child would: same content hash, same rendered output.
"""

from __future__ import annotations

import copy
import math

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.datastruct import DataStruct
from quantized.routes import _datasetcache as dc

client = TestClient(app)


@pytest.fixture(autouse=True)
def _clear_cache_between_tests():
    dc.clear_cache()
    yield
    dc.clear_cache()


def _parent() -> dict:
    rng = np.random.default_rng(7)
    values = rng.normal(size=(12, 3)).tolist()
    values[4][1] = None  # a missing cell already in the parent (NaN on the wire)
    return {
        "time": [float(i) for i in range(12)],
        "values": values,
        # Labels whose dedupe is not idempotent (-> "a", "a (2)", "a (2)", and a
        # second pass renames the third) -- a patch must NOT re-run the dedupe.
        "labels": ["a", "a", "a (2)"],
        "units": ["V", "A", ""],
        "metadata": {"x_column_name": "t"},
        "cat_levels": {"2": ["lo", "mid", "hi"]},
    }


def _upload(ds: dict) -> str:
    resp = client.post("/api/plot/series", json={"dataset": ds})
    assert resp.status_code == 200, resp.text
    handle = resp.headers.get("X-Dataset-Handle")
    assert handle
    return handle


def _patch(handle: str, patches: list[dict]) -> dict:
    resp = client.post("/api/datasets/patch", json={"dataset_handle": handle, "patches": patches})
    assert resp.status_code == 200, resp.text
    return resp.json()


PATCHES = [
    {"row": 0, "col": 0, "value": 3.25},
    {"row": 4, "col": 1, "value": 1.5},  # overwrite a NaN
    {"row": 5, "col": 0, "value": None},  # clear to NaN
    {"row": 6, "col": 1, "value": -0.0},  # -0 must survive exactly as a full upload stores it
    {"row": 3, "col": -1, "value": 99.0},  # the time column
    {"row": 7, "col": 2, "value": 2.0},  # a categorical code
]


def _child(parent: dict) -> dict:
    child = copy.deepcopy(parent)
    for p in PATCHES:
        if p["col"] == -1:
            child["time"][p["row"]] = p["value"]
        else:
            child["values"][p["row"]][p["col"]] = p["value"]
    return child


def test_patched_handle_equals_full_upload_of_the_child() -> None:
    parent = _parent()
    patched = _patch(_upload(parent), PATCHES)["dataset_handle"]

    dc.clear_cache()  # prove the full upload lands on the same content hash independently
    assert patched == _upload(_child(parent))


def test_patched_dataset_matches_full_upload_bit_for_bit() -> None:
    parent = _parent()
    patched = dc.resolve_dataset(_patch(_upload(parent), PATCHES)["dataset_handle"])
    full = DataStruct.from_dict(_child(parent))

    assert patched.time.tobytes() == full.time.tobytes()
    assert patched.values.tobytes() == full.values.tobytes()  # NaN and the -0 sign bit included
    assert math.copysign(1.0, patched.values[6, 1]) == -1.0
    assert np.isnan(patched.values[5, 0])
    assert patched.labels == full.labels == ("a", "a (2)", "a (2)")
    assert patched.units == full.units
    assert dict(patched.metadata) == dict(full.metadata)
    assert patched.cat_levels == full.cat_levels


def test_parent_entry_is_left_untouched() -> None:
    parent = _parent()
    handle = _upload(parent)
    before = dc.resolve_dataset(handle).values.copy()
    _patch(handle, PATCHES)
    assert dc.resolve_dataset(handle).values.tobytes() == before.tobytes()


def test_patched_handle_serves_the_same_plot_as_a_full_upload() -> None:
    parent = _parent()
    patched = _patch(_upload(parent), PATCHES)["dataset_handle"]
    by_handle = client.post("/api/plot/series", json={"dataset_handle": patched})
    by_full = client.post("/api/plot/series", json={"dataset": _child(parent)})
    assert by_handle.status_code == by_full.status_code == 200
    assert by_handle.json() == by_full.json()


def test_empty_patch_list_returns_the_parent_handle() -> None:
    handle = _upload(_parent())
    assert _patch(handle, [])["dataset_handle"] == handle


def test_unknown_handle_is_409() -> None:
    resp = client.post("/api/datasets/patch", json={"dataset_handle": "0" * 32, "patches": PATCHES})
    assert resp.status_code == 409
    assert resp.json()["detail"] == "unknown_dataset_handle"


@pytest.mark.parametrize(
    "bad",
    [
        {"row": 12, "col": 0, "value": 1.0},  # past the last row
        {"row": 0, "col": 3, "value": 1.0},  # past the last channel
        {"row": 0, "col": -2, "value": 1.0},  # below the time column
        {"row": -1, "col": 0, "value": 1.0},
    ],
)
def test_out_of_range_cell_is_422(bad: dict) -> None:
    handle = _upload(_parent())
    resp = client.post("/api/datasets/patch", json={"dataset_handle": handle, "patches": [bad]})
    assert resp.status_code == 422


def test_oversize_patched_dataset_gets_no_handle(monkeypatch: pytest.MonkeyPatch) -> None:
    handle = _upload(_parent())
    monkeypatch.setattr(dc, "_MAX_TOTAL_BYTES", 1)
    assert _patch(handle, PATCHES)["dataset_handle"] is None

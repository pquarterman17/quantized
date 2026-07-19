"""Route-level guard: a malformed ``dataset`` is a 422, never a 500.

The 2026-07-19 bug-hunt round confirmed (against the real app, via
TestClient) that a non-numeric ``dataset.time``/``values`` escaped as an
unhandled HTTP 500 from every route that builds a ``DataStruct``. Those routes
catch ``(ValueError, KeyError, IndexError)`` but ``np.asarray(..., dtype=float)``
raises ``TypeError`` on a nested dict, and each route types the field as
``dict[str, Any]`` so pydantic lets it through.

The fix lives in ``DataStruct.create``. These tests exist to prove the fix
covers the ROUTES (not just the constructor) and to catch a future route that
re-opens the hole by building its arrays some other way — which is why they
sweep several modules rather than testing one.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from quantized.app import app

client = TestClient(app, raise_server_exceptions=False)

BAD_DATASET = {
    "time": {"not": "an array"},
    "values": [[1.0, 2.0], [3.0, 4.0]],
    "labels": ["a", "b"],
    "units": ["", ""],
    "metadata": {},
}

GOOD_DATASET = {
    "time": [0.0, 1.0],
    "values": [[1.0, 2.0], [3.0, 4.0]],
    "labels": ["a", "b"],
    "units": ["", ""],
    "metadata": {},
}

# (route, body-builder) pairs across the modules that build a DataStruct.
CASES = [
    ("/api/plot/series", lambda ds: {"dataset": ds, "x_key": 0, "y_keys": [1]}),
    ("/api/export/figure", lambda ds: {"dataset": ds, "y_keys": [1]}),
    ("/api/corrections/apply", lambda ds: {"dataset": ds}),
]


@pytest.mark.parametrize(("path", "body"), CASES)
def test_malformed_dataset_is_422_not_500(path: str, body) -> None:
    r = client.post(path, json=body(BAD_DATASET))
    assert r.status_code == 422, f"{path} returned {r.status_code}"


@pytest.mark.parametrize(("path", "body"), CASES)
def test_guard_does_not_over_fire_on_a_valid_dataset(path: str, body) -> None:
    """The paired sanity half — a well-formed payload must NOT become a 422."""
    r = client.post(path, json=body(GOOD_DATASET))
    assert r.status_code != 422, f"{path} rejected a valid dataset"


def test_semiconductor_underflowed_eg_is_422_not_500() -> None:
    r = client.post(
        "/api/semiconductor/fermi-level",
        json={"eg": 100.0, "me_star": 1.0, "mh_star": 1.0, "nd": 1e16, "na": 0.0, "t": 300.0},
    )
    assert r.status_code == 422


def test_fitting_empty_arrays_is_422_not_500() -> None:
    r = client.post(
        "/api/fitting/fit",
        json={"model": "Linear", "x": [], "y": [], "p0": [1.0, 0.0]},
    )
    assert r.status_code == 422

"""Route-level guard: a malformed ``dataset`` is a 422, never a 500.

The 2026-07-19 bug-hunt round confirmed (against the real app, via
TestClient) that a non-numeric ``dataset.time``/``values`` escaped as an
unhandled HTTP 500 from every route that builds a ``DataStruct``. Those routes
catch ``(ValueError, KeyError, IndexError)`` but ``np.asarray(..., dtype=float)``
raises ``TypeError`` on a nested dict, and each route types the field as
``dict[str, Any]`` so pydantic lets it through.

The fix lives in ``DataStruct.create``. These tests exist to prove the fix
covers the ROUTES (not just the constructor) and to catch a future route that
re-opens the hole by building its arrays some other way.

ROBUSTNESS #9 (2026-08-01): the swept-route list is no longer trusted to a
hand-maintained CASES list alone — ``test_sweep_covers_every_dataset_route``
walks the app's OpenAPI schema (public contract, no FastAPI internals) for
every POST route whose request body transitively contains a dataset-named
property, and fails in BOTH directions: a new dataset route missing from the
sweep, or a CASES/EXEMPT entry gone stale. Bodies stay hand-written on
purpose: the paired good-dataset half below proves each body is otherwise
valid, so the BAD probe's 422 is attributable to the dataset field — an
auto-generated body that trips a sibling field's validation would return a
vacuous 422 and silently stop testing this class. (When first enumerated,
the hand list covered 3 of 18 dataset-bearing routes.)
"""

from __future__ import annotations

from typing import Any

import numpy as np
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

# /api/plot/map regrids scattered (x, y, z) channels — its good half needs a
# non-degenerate 2-D point cloud (a 2x2 grid on the unit square), not the
# generic two-column dataset.
MAP_GOOD = {
    "time": [0.0, 1.0, 2.0, 3.0],
    "values": [[0.0, 0.0, 1.0], [1.0, 0.0, 2.0], [0.0, 1.0, 3.0], [1.0, 1.0, 4.0]],
    "labels": ["x", "y", "z"],
    "units": ["", "", ""],
    "metadata": {},
}


def _rsm_good() -> dict[str, Any]:
    """A minimal valid 2-D RSM dataset per ``calc.rsm_analyze
    .rsm_grids_from_datastruct``'s contract: ``is2D`` + ``map_shape``
    metadata, ``2Theta`` varying along columns, ``Omega`` along rows, and an
    ``Intensity`` channel carrying one Gaussian peak (so peak-based routes
    have something to find)."""
    n = m = 8
    tth = np.tile(np.linspace(20.0, 21.0, m), n)
    om = np.repeat(np.linspace(9.5, 10.5, n), m)
    inten = np.exp(-(((tth - 20.5) / 0.2) ** 2 + ((om - 10.0) / 0.2) ** 2))
    return {
        "time": list(range(n * m)),
        "values": np.column_stack([om, tth, inten]).tolist(),
        "labels": ["Omega", "2Theta", "Intensity"],
        "units": ["deg", "deg", "counts"],
        "metadata": {"is2D": True, "map_shape": [n, m], "axis1_name": "Omega"},
    }


RSM_GOOD = _rsm_good()

# (route, body-builder, good-payload) triples. The builder plants the given
# dataset dict wherever the route's schema carries it (top level, nested item
# list, or a nested figure payload); the third element is the dataset the
# sanity half sends — GOOD_DATASET unless the route demands a richer shape.
CASES = [
    ("/api/plot/series", lambda ds: {"dataset": ds, "x_key": 0, "y_keys": [1]}, GOOD_DATASET),
    (
        "/api/plot/map",
        lambda ds: {"dataset": ds, "x_key": 0, "y_key": 1, "z_key": 2},
        MAP_GOOD,
    ),
    ("/api/export/figure", lambda ds: {"dataset": ds, "y_keys": [1]}, GOOD_DATASET),
    ("/api/export/figure-hitmap", lambda ds: {"dataset": ds, "y_keys": [1]}, GOOD_DATASET),
    (
        "/api/export/figure-page",
        lambda ds: {
            "rows": 1,
            "cols": 1,
            "panels": [{"figure": {"dataset": ds, "y_keys": [1]}, "row": 0, "col": 0}],
        },
        GOOD_DATASET,
    ),
    ("/api/export/xrd-csv", lambda ds: {"dataset": ds}, GOOD_DATASET),
    ("/api/export/hdf5", lambda ds: {"dataset": ds}, GOOD_DATASET),
    ("/api/export/origin", lambda ds: {"dataset": ds}, GOOD_DATASET),
    (
        "/api/export/consolidated",
        lambda ds: {"datasets": [{"dataset": ds, "name": "a"}]},
        GOOD_DATASET,
    ),
    ("/api/export/opj", lambda ds: {"datasets": [{"dataset": ds, "name": "a"}]}, GOOD_DATASET),
    (
        "/api/export/origin-project",
        lambda ds: {"datasets": [{"dataset": ds, "name": "a"}]},
        GOOD_DATASET,
    ),
    (
        "/api/aggregate/algebra",
        lambda ds: {"dataset_a": ds, "dataset_b": GOOD_DATASET, "operation": "A+B"},
        GOOD_DATASET,
    ),
    ("/api/corrections/apply", lambda ds: {"dataset": ds}, GOOD_DATASET),
    ("/api/rsm/analyze", lambda ds: {"dataset": ds, "n_peaks": 1}, RSM_GOOD),
    ("/api/rsm/linecut", lambda ds: {"dataset": ds, "direction": "h", "value": 10.0}, RSM_GOOD),
    (
        "/api/rsm/cut-segment",
        lambda ds: {"dataset": ds, "p0": [20.0, 9.5], "p1": [21.0, 10.5], "n": 16},
        RSM_GOOD,
    ),
    ("/api/rsm/projection", lambda ds: {"dataset": ds}, RSM_GOOD),
]

# Routes the enumeration finds that the sweep deliberately does not probe.
# Every entry needs a reason; a stale entry fails the completeness test.
EXEMPT = {
    "/api/export/origin-com": (
        "the COM availability gate returns 409 before any dataset is parsed on "
        "non-Windows/CI machines, so the probe cannot reach from_dict here; "
        "its parse sits behind the same except tuple as the swept routes"
    ),
}

_CASE_PARAMS = [pytest.param(path, body, good, id=path) for path, body, good in CASES]


def _dataset_routes() -> set[str]:
    """Every POST route whose request-body schema transitively contains a
    property whose name mentions ``dataset`` (``dataset``, ``datasets``,
    ``dataset_a``, ``bg_dataset``, ...), resolved through ``$ref``s, arrays,
    and allOf/anyOf/oneOf composition."""
    spec = app.openapi()
    components = spec.get("components", {}).get("schemas", {})

    def has_dataset(schema: Any, seen: frozenset[str]) -> bool:
        if not isinstance(schema, dict):
            return False
        if "$ref" in schema:
            name = schema["$ref"].rsplit("/", 1)[-1]
            if name in seen:
                return False
            return has_dataset(components.get(name, {}), seen | {name})
        for key, sub in (schema.get("properties") or {}).items():
            if "dataset" in key or has_dataset(sub, seen):
                return True
        for comb in ("allOf", "anyOf", "oneOf"):
            if any(has_dataset(sub, seen) for sub in schema.get(comb) or []):
                return True
        if has_dataset(schema.get("items"), seen):
            return True
        extra = schema.get("additionalProperties")
        return isinstance(extra, dict) and has_dataset(extra, seen)

    found = set()
    for path, ops in spec.get("paths", {}).items():
        body_schema = (
            (ops.get("post") or {})
            .get("requestBody", {})
            .get("content", {})
            .get("application/json", {})
            .get("schema")
        )
        if body_schema and has_dataset(body_schema, frozenset()):
            found.add(path)
    return found


def test_sweep_covers_every_dataset_route() -> None:
    """The enumeration half: CASES + EXEMPT must equal the app's actual
    dataset-bearing POST routes — a new route lands in the sweep or names a
    reason, and a renamed/removed route can't linger here."""
    expected = _dataset_routes()
    covered = {path for path, _, _ in CASES} | set(EXEMPT)
    missing = sorted(expected - covered)
    assert not missing, (
        f"dataset-bearing route(s) not in the malformed-dataset sweep: {missing}; "
        "add a CASES entry with a minimal valid body (or an EXEMPT entry with a reason)"
    )
    stale = sorted(covered - expected)
    assert not stale, (
        f"swept route(s) no longer exist or no longer carry a dataset field: {stale}; "
        "remove or update the CASES/EXEMPT entry"
    )


@pytest.mark.parametrize(("path", "body", "good"), _CASE_PARAMS)
def test_malformed_dataset_is_422_not_500(path: str, body: Any, good: dict[str, Any]) -> None:
    r = client.post(path, json=body(BAD_DATASET))
    assert r.status_code == 422, f"{path} returned {r.status_code}"


@pytest.mark.parametrize(("path", "body", "good"), _CASE_PARAMS)
def test_guard_does_not_over_fire_on_a_valid_dataset(
    path: str, body: Any, good: dict[str, Any]
) -> None:
    """The paired sanity half — a well-formed payload must NOT become a 422.
    This is what makes the BAD probe attributable to the dataset field."""
    r = client.post(path, json=body(good))
    assert r.status_code != 422, f"{path} rejected a valid dataset: {r.text[:300]}"


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

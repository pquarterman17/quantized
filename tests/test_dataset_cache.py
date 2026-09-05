"""Tests for the dataset-handle cache (RSM_CUTS_PLAN item 18).

Two layers: direct unit tests of ``routes/_datasetcache.py`` (hashing,
bounded LRU eviction by count AND bytes, concurrency, the pydantic mixin),
and route-level integration tests via ``TestClient`` proving the whole
pipeline -- round trip, graceful miss recovery (409, never a 500 or a
silently wrong answer), and the measured payload-size win on a repeat call.
"""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pytest
from fastapi.testclient import TestClient

from fixtures.synthetic_rsm import make_synthetic_rsm
from quantized.app import app
from quantized.datastruct import DataStruct
from quantized.routes import _datasetcache as dc

client = TestClient(app)


def _ds(n: int = 3, seed: int = 0) -> DataStruct:
    rng = np.random.default_rng(seed)
    time = np.arange(n, dtype=float)
    values = rng.random((n, 2))
    return DataStruct.create(time, values, labels=["a", "b"], units=["", ""])


@pytest.fixture(autouse=True)
def _clear_cache_between_tests():
    dc.clear_cache()
    yield
    dc.clear_cache()


# ── hashing ──────────────────────────────────────────────────────────────


def test_hash_is_stable_and_content_addressed() -> None:
    a = _ds(seed=1)
    b = _ds(seed=1)  # same content, different object
    c = _ds(seed=2)  # different content
    assert dc.hash_dataset(a) == dc.hash_dataset(b)
    assert dc.hash_dataset(a) != dc.hash_dataset(c)


def test_hash_distinguishes_relabelled_data() -> None:
    a = _ds(seed=1)
    relabelled = DataStruct.create(a.time, a.values, labels=["x", "y"], units=["", ""])
    assert dc.hash_dataset(a) != dc.hash_dataset(relabelled)


def test_hash_agrees_on_identical_metadata_built_in_a_different_order() -> None:
    a = _ds(seed=1)
    same_content_a = DataStruct.create(
        a.time, a.values, labels=a.labels, units=a.units, metadata={"x": 1, "y": 2}
    )
    same_content_b = DataStruct.create(
        a.time, a.values, labels=a.labels, units=a.units, metadata={"y": 2, "x": 1}
    )
    assert dc.hash_dataset(same_content_a) == dc.hash_dataset(same_content_b)


def test_hash_distinguishes_metadata() -> None:
    """Reproduces the collision: build_series reads x_column_long/
    x_column_name/x_column_unit from ds.metadata (map/rsm read
    map_shape/is2D) -- two datasets identical everywhere else but differing
    only in metadata must NOT collide, or a held handle for one would
    silently return the other's x label/unit forever."""
    a = _ds(seed=1)
    b = DataStruct.create(a.time, a.values, labels=a.labels, units=a.units, metadata={"k": "v"})
    assert dc.hash_dataset(a) != dc.hash_dataset(b)


# ── cache / resolve round trip ──────────────────────────────────────────


def test_cache_then_resolve_round_trips() -> None:
    ds = _ds(seed=3)
    handle = dc.cache_dataset(ds)
    resolved = dc.resolve_dataset(handle)
    assert np.array_equal(resolved.values, ds.values)
    assert resolved.labels == ds.labels


def test_recaching_identical_content_is_idempotent() -> None:
    ds = _ds(seed=4)
    h1 = dc.cache_dataset(ds)
    h2 = dc.cache_dataset(_ds(seed=4))  # same content, fresh object
    assert h1 == h2
    assert dc.cache_stats()["entries"] == 1


def test_resolve_unknown_handle_raises_miss() -> None:
    with pytest.raises(dc.DatasetHandleMiss):
        dc.resolve_dataset("not-a-real-handle")


def test_cache_dataset_returns_none_when_evicted_by_its_own_insertion(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A single dataset larger than the total budget gets evicted in the
    SAME call that inserted it -- cache_dataset must not hand back a handle
    for an entry that is no longer resident (a "doomed" handle: the client
    would store it, and every later reference to it would 409 forever)."""
    monkeypatch.setattr(dc, "_MAX_TOTAL_BYTES", 100)  # smaller than any real dataset
    handle = dc.cache_dataset(_ds(n=1000, seed=0))
    assert handle is None
    assert dc.cache_stats() == {"entries": 0, "bytes": 0}


def test_clear_cache_empties_it() -> None:
    dc.cache_dataset(_ds(seed=5))
    assert dc.cache_stats()["entries"] == 1
    dc.clear_cache()
    assert dc.cache_stats() == {"entries": 0, "bytes": 0}


# ── bounded LRU eviction ─────────────────────────────────────────────────


def test_eviction_by_entry_count(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(dc, "_MAX_ENTRIES", 3)
    handles = [dc.cache_dataset(_ds(n=2, seed=i)) for i in range(5)]
    assert dc.cache_stats()["entries"] == 3
    # The oldest two (0, 1) were evicted; the newest three survive.
    with pytest.raises(dc.DatasetHandleMiss):
        dc.resolve_dataset(handles[0])
    with pytest.raises(dc.DatasetHandleMiss):
        dc.resolve_dataset(handles[1])
    dc.resolve_dataset(handles[4])  # newest -- still present


def test_resolving_an_entry_refreshes_its_lru_position(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(dc, "_MAX_ENTRIES", 2)
    h0 = dc.cache_dataset(_ds(n=2, seed=0))
    dc.cache_dataset(_ds(n=2, seed=1))
    dc.resolve_dataset(h0)  # touch h0 -> now the most-recently-used
    dc.cache_dataset(_ds(n=2, seed=2))  # evicts the LRU entry, which is now seed=1
    dc.resolve_dataset(h0)  # h0 survived because it was touched


def test_eviction_by_total_bytes(monkeypatch: pytest.MonkeyPatch) -> None:
    # Each dataset is exactly 2 float64 columns * n rows * 8 bytes + time.
    # n=1000 -> values 16000 bytes + time 8000 bytes = 24000 bytes/entry.
    monkeypatch.setattr(dc, "_MAX_ENTRIES", 1000)  # count bound not the one under test
    monkeypatch.setattr(dc, "_MAX_TOTAL_BYTES", 50_000)  # room for ~2 entries
    handles = [dc.cache_dataset(_ds(n=1000, seed=i)) for i in range(5)]
    stats = dc.cache_stats()
    assert stats["bytes"] <= 50_000
    assert stats["entries"] < 5
    with pytest.raises(dc.DatasetHandleMiss):
        dc.resolve_dataset(handles[0])  # oldest, evicted first


# ── concurrency: races on the cache must never corrupt it ───────────────


def test_concurrent_cache_writes_do_not_corrupt_state() -> None:
    """Many threads racing to cache DIFFERENT datasets: every one lands, the
    bound is respected, and every returned handle resolves."""
    def _write(i: int) -> str:
        return dc.cache_dataset(_ds(n=4, seed=i))

    with ThreadPoolExecutor(max_workers=16) as pool:
        handles = list(pool.map(_write, range(16)))

    assert len(handles) == 16
    stats = dc.cache_stats()
    assert stats["entries"] <= dc._MAX_ENTRIES
    # The most recent entries (within the bound) must all still resolve.
    for h in handles[-dc._MAX_ENTRIES :]:
        dc.resolve_dataset(h)  # must not raise


def test_concurrent_reads_of_the_same_handle_all_succeed() -> None:
    """Two+ requests racing on the SAME handle must both succeed (item 18's
    explicit concurrency requirement) -- not just survive, but return the
    identical, correct dataset every time."""
    ds = _ds(seed=42)
    handle = dc.cache_dataset(ds)

    def _read(_: int) -> np.ndarray:
        return dc.resolve_dataset(handle).values

    with ThreadPoolExecutor(max_workers=32) as pool:
        results = list(pool.map(_read, range(32)))

    for r in results:
        assert np.array_equal(r, ds.values)


# ── route-level: round trip, miss recovery, validation ───────────────────

_BOX_BOUNDS = {"x_min": 20.0, "x_max": 21.0, "y_min": 9.5, "y_max": 10.5}


def _rsm_dataset() -> dict:
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


# (path, extra body fields) for every cache-eligible endpoint currently
# defined -- kept in sync manually (a stale entry here would just under-
# test, not silently pass); see routes/rsm.py + routes/plot.py for the
# authoritative list.
CACHE_ELIGIBLE = [
    ("/api/rsm/analyze", {"n_peaks": 1}),
    ("/api/rsm/linecut", {"direction": "h", "value": 10.0}),
    ("/api/rsm/cut-segment", {"p0": [20.0, 9.5], "p1": [21.0, 10.5], "n": 16}),
    ("/api/rsm/projection", {}),
    ("/api/rsm/box", _BOX_BOUNDS),
    ("/api/rsm/box-stats", _BOX_BOUNDS),
    ("/api/plot/series", {}),
]


@pytest.mark.parametrize(("path", "extra"), CACHE_ELIGIBLE, ids=[p for p, _ in CACHE_ELIGIBLE])
def test_round_trip_handle_reproduces_identical_result(path: str, extra: dict) -> None:
    ds = _rsm_dataset()
    first = client.post(path, json={"dataset": ds, **extra})
    assert first.status_code == 200, first.text
    handle = first.headers.get("X-Dataset-Handle")
    assert handle

    second = client.post(path, json={"dataset_handle": handle, **extra})
    assert second.status_code == 200, second.text
    assert second.json() == first.json()
    # The server echoes the SAME handle back (content-addressed, not a
    # fresh random token per call).
    assert second.headers.get("X-Dataset-Handle") == handle


def test_sector_and_chi_profile_round_trip() -> None:
    ds, _peaks = make_synthetic_rsm(n=8, m=8)
    payload = ds.to_dict()
    for path in ("/api/rsm/sector", "/api/rsm/chi-profile"):
        first = client.post(path, json={"dataset": payload, "q_min": 0.0, "q_max": 10.0})
        assert first.status_code == 200, first.text
        handle = first.headers.get("X-Dataset-Handle")
        assert handle
        second = client.post(
            path, json={"dataset_handle": handle, "q_min": 0.0, "q_max": 10.0}
        )
        assert second.status_code == 200
        assert second.json() == first.json()


def test_plot_map_round_trip() -> None:
    map_ds = {
        "time": [0.0, 1.0, 2.0, 3.0],
        "values": [[0.0, 0.0, 1.0], [1.0, 0.0, 2.0], [0.0, 1.0, 3.0], [1.0, 1.0, 4.0]],
        "labels": ["x", "y", "z"],
        "units": ["", "", ""],
        "metadata": {},
    }
    body = {"x_key": 0, "y_key": 1, "z_key": 2, "method": "linear", "nx": 5, "ny": 5}
    first = client.post("/api/plot/map", json={"dataset": map_ds, **body})
    assert first.status_code == 200
    handle = first.headers.get("X-Dataset-Handle")
    assert handle

    second = client.post("/api/plot/map", json={"dataset_handle": handle, **body})
    assert second.status_code == 200
    assert second.json() == first.json()


@pytest.mark.parametrize(("path", "extra"), CACHE_ELIGIBLE, ids=[p for p, _ in CACHE_ELIGIBLE])
def test_unknown_handle_is_409_not_500_or_422(path: str, extra: dict) -> None:
    resp = client.post(path, json={"dataset_handle": "0" * 32, **extra})
    assert resp.status_code == 409
    assert resp.json()["detail"] == "unknown_dataset_handle"


@pytest.mark.parametrize(("path", "extra"), CACHE_ELIGIBLE, ids=[p for p, _ in CACHE_ELIGIBLE])
def test_neither_dataset_nor_handle_is_422(path: str, extra: dict) -> None:
    resp = client.post(path, json=extra)
    assert resp.status_code == 422


def test_dataset_wins_when_both_given() -> None:
    """A stale/bogus handle alongside a fresh `dataset` must not 409 -- the
    full payload always takes priority and is (re)cached."""
    ds = _rsm_dataset()
    resp = client.post(
        "/api/rsm/box-stats",
        json={"dataset": ds, "dataset_handle": "not-cached", **_BOX_BOUNDS},
    )
    assert resp.status_code == 200


def test_miss_after_eviction_is_409_the_client_can_recover_from(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The full eviction story at the route layer: cache one dataset under a
    1-entry bound, push it out with a second, then prove the now-stale
    handle comes back as a clean 409 (never a crash, never silently wrong
    data) -- exactly what lib/api/datasetCache.ts's retry answers."""
    monkeypatch.setattr(dc, "_MAX_ENTRIES", 1)
    ds_a = _rsm_dataset()
    ds_b = _rsm_dataset()
    ds_b["metadata"] = {**ds_b["metadata"], "note": "different content"}
    ds_b["values"][0][2] += 1000.0  # perturb so it hashes differently

    first = client.post("/api/rsm/box-stats", json={"dataset": ds_a, **_BOX_BOUNDS})
    handle_a = first.headers["X-Dataset-Handle"]

    client.post("/api/rsm/box-stats", json={"dataset": ds_b, **_BOX_BOUNDS})  # evicts A

    stale = client.post(
        "/api/rsm/box-stats", json={"dataset_handle": handle_a, **_BOX_BOUNDS}
    )
    assert stale.status_code == 409

    # The client's transparent recovery: resend the full payload once.
    recovered = client.post("/api/rsm/box-stats", json={"dataset": ds_a, **_BOX_BOUNDS})
    assert recovered.status_code == 200


def test_oversize_dataset_gets_no_handle_header(monkeypatch: pytest.MonkeyPatch) -> None:
    """Route-level doomed-handle reproduction: a dataset larger than the
    total budget must come back with NO X-Dataset-Handle header (never a
    handle the client would store and then 409 on forever), and the cache
    must be left empty -- the entry was evicted in the same call."""
    monkeypatch.setattr(dc, "_MAX_TOTAL_BYTES", 100)  # smaller than any real dataset
    ds = _rsm_dataset()
    resp = client.post("/api/rsm/box-stats", json={"dataset": ds, **_BOX_BOUNDS})
    assert resp.status_code == 200, resp.text
    assert "X-Dataset-Handle" not in resp.headers
    assert dc.cache_stats() == {"entries": 0, "bytes": 0}


def test_metadata_only_difference_gets_a_distinct_handle_and_own_x_label() -> None:
    """Route-level reproduction of the metadata-collision bug: two /api/plot/
    series datasets identical in time/values/labels/units but differing
    only in the x-column metadata build_series reads must get DIFFERENT
    handles, and each handle's own follow-up call must still return that
    dataset's own x label/unit -- never the other one's (which is exactly
    what happened when the hash excluded metadata and the second cache_dataset
    call silently overwrote the first entry under a colliding handle)."""
    base = {
        "time": [1.0, 2.0, 3.0, 4.0],
        "values": [[10.0], [20.0], [30.0], [40.0]],
        "labels": ["Counts"],
        "units": ["cps"],
    }
    ds_a = {**base, "metadata": {"x_column_long": "Theta", "x_column_unit": "deg"}}
    ds_b = {**base, "metadata": {"x_column_long": "Omega", "x_column_unit": "arcsec"}}

    resp_a = client.post("/api/plot/series", json={"dataset": ds_a})
    resp_b = client.post("/api/plot/series", json={"dataset": ds_b})
    assert resp_a.status_code == 200 and resp_b.status_code == 200

    handle_a = resp_a.headers["X-Dataset-Handle"]
    handle_b = resp_b.headers["X-Dataset-Handle"]
    assert handle_a != handle_b

    # Each handle must still resolve to ITS OWN dataset's x label -- a
    # collision would make one of these come back as the other's.
    replay_a = client.post("/api/plot/series", json={"dataset_handle": handle_a})
    replay_b = client.post("/api/plot/series", json={"dataset_handle": handle_b})
    assert replay_a.json()["x"]["label"] == "Theta"
    assert replay_a.json()["x"]["unit"] == "deg"
    assert replay_b.json()["x"]["label"] == "Omega"
    assert replay_b.json()["x"]["unit"] == "arcsec"


def test_concurrent_requests_on_the_same_handle_all_succeed() -> None:
    ds = _rsm_dataset()
    first = client.post("/api/rsm/box-stats", json={"dataset": ds, **_BOX_BOUNDS})
    handle = first.headers["X-Dataset-Handle"]

    def _call(_: int):
        return client.post(
            "/api/rsm/box-stats", json={"dataset_handle": handle, **_BOX_BOUNDS}
        )

    with ThreadPoolExecutor(max_workers=8) as pool:
        responses = list(pool.map(_call, range(8)))

    for r in responses:
        assert r.status_code == 200
        assert r.json() == first.json()


# ── measured payload-size win on a repeat call ────────────────────────────


def test_repeat_call_payload_is_dramatically_smaller() -> None:
    """A concrete before/after byte count, not just "it works" -- a repeat
    call sends a short handle instead of the whole dataset.

    Measured on this fixture (6,144 points, n=64/m=96): first-call body
    660,995 bytes, repeat-call body 114 bytes -- a 99.983% reduction. Scales
    with dataset size, so the real corpus's largest file (m3learning_rsm.xrdml,
    465,885 points / 45.5 MB) sees the same handle-sized repeat call.
    """
    ds, _peaks = make_synthetic_rsm(n=64, m=96)  # a few thousand points
    payload = ds.to_dict()
    # make_synthetic_rsm's default tt_range/omega_range -- not _BOX_BOUNDS,
    # which targets the unrelated _rsm_dataset() fixture's domain.
    bounds = {"x_min": 58.0, "x_max": 64.0, "y_min": 28.0, "y_max": 32.0}

    full_body = json.dumps({"dataset": payload, **bounds}).encode()
    first = client.post("/api/rsm/box-stats", json={"dataset": payload, **bounds})
    assert first.status_code == 200, first.text
    handle = first.headers["X-Dataset-Handle"]

    handle_body = json.dumps({"dataset_handle": handle, **bounds}).encode()
    second = client.post("/api/rsm/box-stats", json={"dataset_handle": handle, **bounds})
    assert second.status_code == 200

    assert len(full_body) > 100_000  # sanity: this fixture is non-trivial
    assert len(handle_body) < 200  # a hash + bounds, not a dataset
    reduction = 1 - (len(handle_body) / len(full_body))
    assert reduction > 0.999  # >99.9% smaller

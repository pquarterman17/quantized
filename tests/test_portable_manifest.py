"""Unit tests for ``quantized.portable.manifest.build_dry_run_manifest``
(P1.7 "Pack Project" PR 1)."""

from __future__ import annotations

import copy
from typing import Any

from quantized.portable.layout import is_bundle_relative
from quantized.portable.manifest import build_dry_run_manifest, manifest_json


def _path_source(path: str, **provenance: Any) -> dict[str, Any]:
    return {"kind": "path", "path": path, **provenance}


def _dataset(dataset_id: str, name: str, source: dict[str, Any] | None = None) -> dict[str, Any]:
    ds: dict[str, Any] = {"id": dataset_id, "name": name}
    if source is not None:
        ds["source"] = source
    return ds


def _payload(datasets: list[dict[str, Any]]) -> dict[str, Any]:
    return {"format": "quantized-workspace", "version": 4, "datasets": datasets}


def _counting_probe(fixed: dict[str, dict[str, Any]]):
    calls: list[str] = []

    def probe(path: str) -> dict[str, Any]:
        calls.append(path)
        return fixed.get(path, {"state": "missing", "path": path})

    return probe, calls


def _row_by_id(manifest: dict[str, Any], source_id: str) -> dict[str, Any]:
    for row in manifest["sources"]:
        if row["source_id"] == source_id:
            return row
    raise AssertionError(f"no source row {source_id!r}")


# ── shared source dedup ───────────────────────────────────────────────────


def test_shared_source_deduped_to_one_row_with_two_verdicts() -> None:
    payload = _payload(
        [
            _dataset(
                "d1", "A", _path_source("/data/run1.csv", checksum="sha256:aaa", mtime=1.0, size=10)
            ),
            _dataset(
                "d2", "B", _path_source("/data/run1.csv", checksum="sha256:bbb", mtime=1.0, size=10)
            ),
        ]
    )
    probe, calls = _counting_probe(
        {"/data/run1.csv": {"state": "ok", "size": 10, "mtime": 1.0, "checksum": "sha256:aaa"}}
    )
    manifest = build_dry_run_manifest(payload, "proj", probe)

    assert len(manifest["sources"]) == 1
    row = manifest["sources"][0]
    assert row["shared"] is True
    assert [m["dataset_id"] for m in row["shared_by"]] == ["d1", "d2"]
    assert row["shared_by"][0]["verdict"] == "unchanged"
    assert row["shared_by"][1]["verdict"] == "changed"
    assert row["changed"] is True
    assert calls == ["/data/run1.csv"]  # probed exactly once


def test_probe_called_exactly_once_per_unique_key_not_per_dataset() -> None:
    payload = _payload(
        [
            _dataset("d1", "A", _path_source("/data/run1.csv")),
            _dataset("d2", "B", _path_source("/data/run1.csv")),
            _dataset("d3", "C", _path_source("/DATA/RUN1.csv")),  # same key, case-variant
            _dataset("d4", "D", _path_source("/data/run2.csv")),
        ]
    )
    probe, calls = _counting_probe(
        {
            "/data/run1.csv": {"state": "ok", "size": 1, "mtime": 1.0},
            "/data/run2.csv": {"state": "ok", "size": 2, "mtime": 2.0},
        }
    )
    build_dry_run_manifest(payload, "proj", probe)
    assert len(calls) == 2  # one per unique path_key, not one per dataset


# ── destination collisions ────────────────────────────────────────────────


def test_identical_basenames_different_folders_get_visible_suffix() -> None:
    payload = _payload(
        [
            _dataset("d1", "A", _path_source("/one/run1.csv")),
            _dataset("d2", "B", _path_source("/two/run1.csv")),
        ]
    )
    probe, _ = _counting_probe(
        {
            "/one/run1.csv": {"state": "ok", "size": 1, "mtime": 1.0},
            "/two/run1.csv": {"state": "ok", "size": 2, "mtime": 2.0},
        }
    )
    manifest = build_dry_run_manifest(payload, "proj", probe)
    paths = sorted(r["bundle_path"] for r in manifest["sources"])
    assert paths == ["sources/run1 (2).csv", "sources/run1.csv"]

    kept = next(r for r in manifest["sources"] if r["bundle_path"] == "sources/run1.csv")
    renamed = next(r for r in manifest["sources"] if r["bundle_path"] == "sources/run1 (2).csv")
    assert kept["collision_group"] == renamed["collision_group"] is not None
    assert kept["renamed_from"] is None
    assert renamed["renamed_from"] == "run1.csv"
    assert "renamed_collision" in renamed["warnings"]
    renamed_warnings = [
        w
        for w in manifest["warnings"]
        if w["code"] == "renamed_collision" and w["source_id"] == renamed["source_id"]
    ]
    assert renamed_warnings


def test_case_variant_collision_still_suffixed() -> None:
    payload = _payload(
        [
            _dataset("d1", "A", _path_source("/one/Run1.CSV")),
            _dataset("d2", "B", _path_source("/two/run1.csv")),
        ]
    )
    probe, _ = _counting_probe(
        {
            "/one/Run1.CSV": {"state": "ok", "size": 1, "mtime": 1.0},
            "/two/run1.csv": {"state": "ok", "size": 2, "mtime": 2.0},
        }
    )
    manifest = build_dry_run_manifest(payload, "proj", probe)
    basenames = sorted(r["bundle_path"].split("/", 1)[1] for r in manifest["sources"])
    assert len(basenames) == 2
    assert basenames[0] != basenames[1]
    assert any("(2)" in b for b in basenames)
    assert all(r["collision_group"] is not None for r in manifest["sources"])


def test_three_way_collision_gets_sequential_suffixes() -> None:
    payload = _payload(
        [
            _dataset("d1", "A", _path_source("/a/run1.csv")),
            _dataset("d2", "B", _path_source("/b/run1.csv")),
            _dataset("d3", "C", _path_source("/c/run1.csv")),
        ]
    )
    ok = {"state": "ok", "size": 1, "mtime": 1.0}
    probe, _ = _counting_probe({"/a/run1.csv": ok, "/b/run1.csv": ok, "/c/run1.csv": ok})
    manifest = build_dry_run_manifest(payload, "proj", probe)
    names = sorted(r["bundle_path"] for r in manifest["sources"])
    assert names == ["sources/run1 (2).csv", "sources/run1 (3).csv", "sources/run1.csv"]


def test_shared_source_is_not_a_collision() -> None:
    # Byte-identical old paths sharing one source is dedup, never a collision.
    payload = _payload(
        [
            _dataset("d1", "A", _path_source("/data/run1.csv")),
            _dataset("d2", "B", _path_source("/data/run1.csv")),
        ]
    )
    probe, _ = _counting_probe({"/data/run1.csv": {"state": "ok", "size": 1, "mtime": 1.0}})
    manifest = build_dry_run_manifest(payload, "proj", probe)
    assert len(manifest["sources"]) == 1
    assert manifest["sources"][0]["collision_group"] is None
    assert manifest["sources"][0]["renamed_from"] is None


# ── per-source status / packability ───────────────────────────────────────


def test_missing_offline_permission_denied_invalid_not_consented_are_distinct() -> None:
    payload = _payload(
        [
            _dataset("d1", "A", _path_source("/x/missing.csv")),
            _dataset("d2", "B", _path_source("/x/offline.csv")),
            _dataset("d3", "C", _path_source("/x/denied.csv")),
            _dataset("d4", "D", _path_source("/x/invalid.csv")),
            _dataset("d5", "E", _path_source("/x/unconsented.csv")),
        ]
    )
    probe, _ = _counting_probe(
        {
            "/x/missing.csv": {"state": "missing"},
            "/x/offline.csv": {"state": "offline"},
            "/x/denied.csv": {"state": "permission_denied"},
            "/x/invalid.csv": {"state": "invalid"},
            "/x/unconsented.csv": {"state": "ok", "size": 5, "mtime": 1.0},
        }
    )

    def consented(path: str) -> bool:
        return path != "/x/unconsented.csv"

    manifest = build_dry_run_manifest(payload, "proj", probe, consented)
    by_path = {r["original_path"]: r for r in manifest["sources"]}
    assert by_path["/x/missing.csv"]["status"] == "missing"
    assert by_path["/x/offline.csv"]["status"] == "offline"
    assert by_path["/x/denied.csv"]["status"] == "permission_denied"
    assert by_path["/x/invalid.csv"]["status"] == "invalid"
    assert by_path["/x/unconsented.csv"]["status"] == "not_consented"
    for row in manifest["sources"]:
        assert row["packable"] is False
        assert row["blockers"] == [row["status"]]
    # not_consented nulls out every metadata field even though the probe had data
    assert by_path["/x/unconsented.csv"]["size"] is None
    assert by_path["/x/unconsented.csv"]["mtime"] is None
    assert by_path["/x/unconsented.csv"]["checksum"] is None


def test_ok_source_is_packable_with_no_blockers() -> None:
    payload = _payload([_dataset("d1", "A", _path_source("/x/ok.csv"))])
    probe, _ = _counting_probe(
        {"/x/ok.csv": {"state": "ok", "size": 5, "mtime": 1.0, "checksum": "sha256:c"}}
    )
    manifest = build_dry_run_manifest(payload, "proj", probe)
    row = manifest["sources"][0]
    assert row["status"] == "ok"
    assert row["packable"] is True
    assert row["blockers"] == []
    assert row["size"] == 5
    assert row["checksum"] == "sha256:c"


def test_changed_and_unverified_are_packable_with_warnings_not_blockers() -> None:
    payload = _payload(
        [
            _dataset(
                "d1", "A", _path_source("/x/changed.csv", checksum="sha256:old", mtime=1.0, size=1)
            ),
            _dataset("d2", "B", _path_source("/x/unverified.csv")),
        ]
    )
    probe, _ = _counting_probe(
        {
            "/x/changed.csv": {"state": "ok", "size": 1, "mtime": 1.0, "checksum": "sha256:new"},
            "/x/unverified.csv": {"state": "ok", "size": 1, "mtime": 1.0},
        }
    )
    manifest = build_dry_run_manifest(payload, "proj", probe)
    changed_row = _row_by_id(manifest, manifest["datasets"][0]["source_id"])
    unverified_row = _row_by_id(manifest, manifest["datasets"][1]["source_id"])

    assert changed_row["packable"] is True
    assert changed_row["blockers"] == []
    assert changed_row["changed"] is True
    assert "changed_since_import" in changed_row["warnings"]

    assert unverified_row["packable"] is True
    assert unverified_row["blockers"] == []
    assert unverified_row["unverified"] is True
    assert "unverified_provenance" in unverified_row["warnings"]


def test_relative_original_path_is_invalid() -> None:
    payload = _payload([_dataset("d1", "A", _path_source("relative/run1.csv"))])
    probe, calls = _counting_probe({})
    manifest = build_dry_run_manifest(payload, "proj", probe)
    assert manifest["sources"][0]["status"] == "invalid"
    assert calls == []  # never probed -- rejected before any I/O-shaped call


def test_nul_byte_in_original_path_is_invalid() -> None:
    payload = _payload([_dataset("d1", "A", _path_source("/data/run1\x00.csv"))])
    probe, calls = _counting_probe({})
    manifest = build_dry_run_manifest(payload, "proj", probe)
    assert manifest["sources"][0]["status"] == "invalid"
    assert calls == []


def test_windows_and_unc_paths_are_accepted_as_absolute() -> None:
    payload = _payload(
        [
            _dataset("d1", "A", _path_source("C:\\lab\\data\\ok.csv")),
            _dataset("d2", "B", _path_source("\\\\server\\share\\ok2.csv")),
        ]
    )
    probe, _ = _counting_probe(
        {
            "C:\\lab\\data\\ok.csv": {"state": "ok", "size": 1, "mtime": 1.0},
            "\\\\server\\share\\ok2.csv": {"state": "ok", "size": 1, "mtime": 1.0},
        }
    )
    manifest = build_dry_run_manifest(payload, "proj", probe)
    for row in manifest["sources"]:
        assert row["status"] == "ok"


# ── dataset notes ──────────────────────────────────────────────────────────


def test_dataset_without_source_is_embedded_only() -> None:
    payload = _payload([_dataset("d1", "A", None)])
    probe, calls = _counting_probe({})
    manifest = build_dry_run_manifest(payload, "proj", probe)
    entry = manifest["datasets"][0]
    assert entry["source_id"] is None
    assert entry["note"] == "embedded_only"
    assert calls == []


def test_unsupported_source_kind_is_noted() -> None:
    payload = _payload([_dataset("d1", "A", {"kind": "embedded"})])
    manifest = build_dry_run_manifest(payload, "proj", lambda p: {"state": "ok"})
    assert manifest["datasets"][0]["note"] == "unsupported_source_kind"
    assert manifest["datasets"][0]["source_id"] is None


def test_malformed_source_is_noted() -> None:
    payload = _payload(
        [
            _dataset("d1", "A", {"kind": "path", "path": ""}),
            _dataset("d2", "B", {"kind": "path"}),
            _dataset("d3", "C", {"kind": "path", "path": 123}),
        ]
    )
    manifest = build_dry_run_manifest(payload, "proj", lambda p: {"state": "ok"})
    for entry in manifest["datasets"]:
        assert entry["note"] == "malformed_source"
        assert entry["source_id"] is None


# ── determinism ─────────────────────────────────────────────────────────


def test_output_bundle_paths_are_always_bundle_relative() -> None:
    payload = _payload(
        [
            _dataset("d1", "A", _path_source("/one/run<>1.csv")),
            _dataset("d2", "B", _path_source("/two/run<>1.csv")),
            _dataset("d3", "C", _path_source("/three/" + "x" * 300 + ".csv")),
        ]
    )
    ok = {"state": "ok", "size": 1, "mtime": 1.0}
    probe = lambda p: ok  # noqa: E731
    manifest = build_dry_run_manifest(payload, "proj", probe)
    for row in manifest["sources"]:
        assert is_bundle_relative(row["bundle_path"])


def test_summary_counts() -> None:
    payload = _payload(
        [
            _dataset("d1", "A", _path_source("/x/ok.csv")),
            _dataset("d2", "B", _path_source("/x/missing.csv")),
            _dataset("d3", "C", None),
        ]
    )
    probe, _ = _counting_probe(
        {
            "/x/ok.csv": {"state": "ok", "size": 100, "mtime": 1.0},
            "/x/missing.csv": {"state": "missing"},
        }
    )
    manifest = build_dry_run_manifest(payload, "proj", probe)
    summary = manifest["summary"]
    assert summary["datasets"] == 3
    assert summary["sources"] == 2
    assert summary["packable"] == 1
    assert summary["blocked"] == 1
    assert summary["shared"] == 0
    assert summary["total_bytes"] == 100
    assert summary["warnings"] == 0


def test_manifest_json_is_stable_across_two_calls() -> None:
    payload = _payload([_dataset("d1", "A", _path_source("/x/ok.csv"))])
    probe, _ = _counting_probe({"/x/ok.csv": {"state": "ok", "size": 1, "mtime": 1.0}})
    m1 = build_dry_run_manifest(payload, "proj", probe)
    m2 = build_dry_run_manifest(payload, "proj", probe)
    assert manifest_json(m1) == manifest_json(m2)


def test_deterministic_regardless_of_non_shared_dataset_order() -> None:
    """Shuffling datasets that do NOT share a source must not change the
    `sources` list at all (order or content) -- only `datasets` order
    changes. (Datasets that DO share a source deliberately keep `shared_by`
    in payload order -- see the dedicated shared-source tests above -- so
    this test uses only independent, non-shared sources to isolate the
    order-independence claim `sources` itself must satisfy.)"""
    datasets = [
        _dataset("d1", "A", _path_source("/x/a.csv")),
        _dataset("d2", "B", _path_source("/x/b.csv")),
        _dataset("d3", "C", _path_source("/x/c.csv")),
        _dataset("d4", "D", None),
    ]
    paths = ("/x/a.csv", "/x/b.csv", "/x/c.csv")
    fixed = {p: {"state": "ok", "size": 1, "mtime": 1.0} for p in paths}

    payload1 = _payload(copy.deepcopy(datasets))
    shuffled = [datasets[2], datasets[0], datasets[3], datasets[1]]
    payload2 = _payload(copy.deepcopy(shuffled))

    probe1, _ = _counting_probe(fixed)
    probe2, _ = _counting_probe(fixed)
    m1 = build_dry_run_manifest(payload1, "proj", probe1)
    m2 = build_dry_run_manifest(payload2, "proj", probe2)

    assert m1["sources"] == m2["sources"]
    assert m1["datasets"] != m2["datasets"]  # order legitimately differs
    assert sorted(m1["datasets"], key=lambda d: d["dataset_id"]) == sorted(
        m2["datasets"], key=lambda d: d["dataset_id"]
    )

    # manifest_json differs only in the `datasets` array's order.
    j1 = build_dry_run_manifest(payload1, "proj", probe1)
    j2 = build_dry_run_manifest(payload2, "proj", probe2)
    j1["datasets"] = []
    j2["datasets"] = []
    assert manifest_json(j1) == manifest_json(j2)


def test_shared_by_preserves_payload_order() -> None:
    payload = _payload(
        [
            _dataset("d2", "Second", _path_source("/data/shared.csv", size=2)),
            _dataset("d1", "First", _path_source("/data/shared.csv", size=1)),
        ]
    )
    probe, _ = _counting_probe({"/data/shared.csv": {"state": "ok", "size": 1, "mtime": 1.0}})
    manifest = build_dry_run_manifest(payload, "proj", probe)
    row = manifest["sources"][0]
    assert [m["dataset_id"] for m in row["shared_by"]] == ["d2", "d1"]

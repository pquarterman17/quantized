"""G23: search a folder of saved projects (``io/workspace_search`` + the
``/api/project-search/folder`` route). Fixture projects are written in the test."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from quantized.app import create_app
from quantized.io.workspace_search import ScanLimits, scan_folder, search_workspace_text


def _doc(sample: str, **over: Any) -> dict[str, Any]:
    doc: dict[str, Any] = {
        "format": "quantized-workspace",
        "version": 4,
        "datasets": [
            {
                "id": "a",
                "name": f"{sample} fit.csv",
                "data": {
                    "time": [0, 1],
                    "values": [[1, 2], [3, 4]],
                    "labels": ["Rxy", "Hall"],
                    "units": ["ohm", "T"],
                    "metadata": {
                        "instrument": "PPMS",
                        "column_comments": {"Rxy": "bad contact on lead 3"},
                        "origin_books": {"huge": "NEEDLE-in-blob"},
                    },
                },
                "notes": f"grown on {sample}",
                "tags": ["cal"],
                "formulas": [{"name": "G", "expr": "1 / Rxy"}],
            }
        ],
        "reports": [{"id": "r", "name": "Summary report"}],
        "analysisResults": [{"id": "x", "name": "Linear fit result"}],
        "editableFigures": [
            {"id": "f", "name": "Fig1", "plot": {"view": {"plotTitle": "RT curve"}}}
        ],
    }
    doc.update(over)
    return doc


def _write(p: Path, doc: Any) -> Path:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(doc), encoding="utf-8")
    return p


def test_text_covers_names_columns_units_comments_metadata_notes_results_figures() -> None:
    d = _doc("2311-B")
    for q, kind in [
        ("2311-b fit", "dataset"),
        ("rxy", "column"),
        ("ohm", "unit"),
        ("lead 3", "comment"),
        ("ppms", "metadata"),
        ("grown on", "note"),
        ("1 / rxy", "formula"),
        ("summary", "report"),
        ("linear fit result", "result"),
        ("rt curve", "title"),
    ]:
        hits, total = search_workspace_text(d, q)
        assert total >= 1 and kind in {h.kind for h in hits}, q
    hits, _ = search_workspace_text(d, "rxy")
    assert any(h.location == 'dataset "2311-B fit.csv", column "Rxy"' for h in hits)
    # bulky Origin blobs are not searched
    assert search_workspace_text(d, "needle-in-blob") == ([], 0)


def test_scan_reads_v9_and_skips_v10(tmp_path: Path) -> None:
    _write(tmp_path / "v9.dwk", _doc("2311-B", version=9))
    _write(tmp_path / "v10.dwk", _doc("2311-B", version=10))
    res = scan_folder(str(tmp_path), "2311-B")
    assert [Path(m.path).name for m in res.matches] == ["v9.dwk"]
    reasons = {Path(s.path).name: s.reason for s in res.skipped}
    assert "newer than this build reads (1-9)" in reasons["v10.dwk"]


def test_scan_finds_the_right_project_and_lists_every_skip(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import builtins

    import quantized.io.workspace_search as ws

    _write(tmp_path / "a" / "one.dwk", _doc("2311-B"))
    _write(tmp_path / "b" / "two.dwk", _doc("9999-Z"))
    (tmp_path / "bad.dwk").write_text("{not json", encoding="utf-8")
    _write(tmp_path / "newer.dwk", _doc("2311-B", version=99))
    _write(tmp_path / "other.dwk", {"format": "something-else"})
    big = _write(tmp_path / "big.dwk", _doc("2311-B", notes="x" * 5000))
    locked = _write(tmp_path / "locked.dwk", _doc("2311-B"))
    (tmp_path / "link.dwk").symlink_to(tmp_path / "a" / "one.dwk")

    real_open = builtins.open

    def fake_open(path: Any, *a: Any, **k: Any) -> Any:
        if str(path) == str(locked):  # chmod 0 does not stop root, so simulate EACCES
            raise PermissionError(13, "Permission denied")
        return real_open(path, *a, **k)

    monkeypatch.setattr(ws, "open", fake_open, raising=False)
    res = scan_folder(str(tmp_path), "2311-B", ScanLimits(max_file_bytes=big.stat().st_size - 1))
    reasons = {Path(s.path).name: s.reason for s in res.skipped}
    assert [Path(m.path).name for m in res.matches] == ["one.dwk"]
    assert "bad JSON" in reasons["bad.dwk"]
    assert "newer than this build" in reasons["newer.dwk"]
    assert "not a quantized workspace" in reasons["other.dwk"]
    assert "limit" in reasons["big.dwk"]
    assert "symbolic link" in reasons["link.dwk"]
    assert "unreadable" in reasons["locked.dwk"]
    assert res.scanned == 7  # every .dwk but the symlink
    m = res.matches[0]
    assert m.relpath == os.path.join("a", "one.dwk") and m.hit_count >= 2


def test_limits_files_depth_hits_and_timeout(tmp_path: Path) -> None:
    for i in range(5):
        _write(tmp_path / f"p{i}.dwk", _doc("S"))
    assert scan_folder(str(tmp_path), "S", ScanLimits(max_files=2)).truncated == "max_files"
    _write(tmp_path / "d1" / "d2" / "deep.dwk", _doc("S"))
    shallow = scan_folder(str(tmp_path), "S", ScanLimits(max_depth=1))
    assert not any(m.path.endswith("deep.dwk") for m in shallow.matches)
    deeper = scan_folder(str(tmp_path), "S", ScanLimits(max_depth=2))
    assert any(m.path.endswith("deep.dwk") for m in deeper.matches)
    capped = scan_folder(str(tmp_path), "s", ScanLimits(max_hits_per_file=1))
    assert all(len(m.hits) == 1 and m.hit_count > 1 for m in capped.matches)
    t = iter(range(0, 1000, 50))
    slow = scan_folder(str(tmp_path), "S", ScanLimits(timeout_s=60), clock=lambda: float(next(t)))
    assert slow.truncated == "timeout"


def test_scan_never_executes_file_content(tmp_path: Path) -> None:
    marker = tmp_path / "ran"
    d = _doc("S", pipeline=[{"code": f"open({str(marker)!r}, 'w')"}])
    d["datasets"][0]["formulas"] = [
        {"name": "G", "expr": f"__import__('os').mkdir({str(marker)!r})"}
    ]
    _write(tmp_path / "x.dwk", d)
    res = scan_folder(str(tmp_path), "__import__")
    assert res.matches and not marker.exists()


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


def test_route_searches_and_confines(client: TestClient, tmp_path: Path) -> None:
    _write(tmp_path / "one.dwk", _doc("2311-B"))
    (tmp_path / "bad.dwk").write_text("nope", encoding="utf-8")
    r = client.post("/api/project-search/folder", json={"folder": str(tmp_path), "query": "2311-b"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert [m["relpath"] for m in body["matches"]] == ["one.dwk"]
    assert body["matches"][0]["hits"][0]["snippet"]
    assert [Path(s["path"]).name for s in body["skipped"]] == ["bad.dwk"]
    assert body["truncated"] is None


def test_route_refuses_outside_roots_and_bad_input(
    client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    for folder in ("/etc", "/", "/proc"):
        r = client.post("/api/project-search/folder", json={"folder": folder, "query": "x"})
        assert r.status_code == 403, folder
    r = client.post(
        "/api/project-search/folder", json={"folder": str(tmp_path / "nope"), "query": "x"}
    )
    assert r.status_code == 404
    for body in (
        {"folder": str(tmp_path), "query": ""},
        {"folder": str(tmp_path), "query": "  "},
        {"folder": str(tmp_path), "query": "x", "max_files": 10**9},
    ):
        assert client.post("/api/project-search/folder", json=body).status_code == 422
    # a symlink out of the allowed roots is resolved first, then refused
    link = tmp_path / "out"
    link.symlink_to("/etc")
    r = client.post("/api/project-search/folder", json={"folder": str(link), "query": "x"})
    assert r.status_code == 403

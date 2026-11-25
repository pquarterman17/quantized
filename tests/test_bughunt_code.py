"""Regression tests for the code bug-hunt (plans/BUGHUNT_CODE.md)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from quantized.app import create_app
from quantized.calc import figure_animation as anim

client = TestClient(create_app())


def _figure(dpi: int) -> dict[str, object]:
    return {
        "dataset": {
            "time": [0.0, 1.0, 2.0, 3.0],
            "values": [[v] for v in (1.0, 2.0, 4.0, 3.0)],
            "labels": ["signal"],
            "units": ["a.u."],
            "metadata": {},
        },
        "y_keys": [0],
        "dpi": dpi,
    }


def test_animation_zip_checks_every_frame_pixel_area(monkeypatch: pytest.MonkeyPatch) -> None:
    """BH-02: only frame 0 was measured, so a ZIP whose later frames are larger
    bypassed the per-frame and total pixel limits."""
    monkeypatch.setattr(anim, "MAX_FRAME_PIXELS", 200_000)
    body = {
        "frames": [{"figure": _figure(60)}, {"figure": _figure(120)}],
        "format": "zip",
    }
    r = client.post("/api/export/figure-animation", json=body)
    assert r.status_code == 422, r.status_code
    assert "megapixels" in r.json()["detail"]


def test_folder_scan_skips_a_malformed_file_instead_of_aborting(tmp_path: Path) -> None:
    """BH-01: one workspace with a wrongly typed field (``plot`` a string) raised
    AttributeError out of the whole scan (HTTP 500), hiding every other match."""
    from quantized.desktop_project_file import WORKSPACE_FORMAT, WORKSPACE_VERSIONS
    from quantized.io.workspace_search import scan_folder

    v = sorted(WORKSPACE_VERSIONS)[-1]
    head = {"format": WORKSPACE_FORMAT, "version": v}
    (tmp_path / "bad.dwk").write_text(
        json.dumps({**head, "editableFigures": [{"name": "fig", "plot": "oops"}]})
    )
    (tmp_path / "good.dwk").write_text(
        json.dumps({**head, "datasets": [{"name": "fig sample 2311-B", "data": {}}]})
    )
    res = scan_folder(str(tmp_path), "fig")
    assert [m.relpath for m in res.matches] == ["good.dwk"]
    assert [s.path.endswith("bad.dwk") for s in res.skipped] == [True]
    assert res.scanned == 2

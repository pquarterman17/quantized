"""Origin container completeness diagnostic (``io/origin_project/integrity.py``).

Audit 2026-11: the first third of a 4-book ``.opj`` imported with HTTP 200
as 3 books with partial columns and no warning. The reader's parse rules are
unchanged; the import now reports the file as truncated because it is
shorter than the size its own v4.3380 file header records (fh offset 115).
"""

from __future__ import annotations

import io

import numpy as np
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.datastruct import DataStruct
from quantized.io.origin_project.integrity import (
    apply_container_integrity,
    container_integrity,
)
from quantized.io.origin_project.writer import opj_bytes


def _project() -> bytes:
    books = [
        DataStruct(
            time=np.linspace(0, 1, 200), values=np.ones((200, 2)) * k, labels=("a", "b"),
            units=("", ""), metadata={"origin_book": f"Book{k}"},
        )
        for k in range(1, 5)
    ]
    return opj_bytes(books)


def test_complete_file_matches_its_header() -> None:
    raw = _project()
    got = container_integrity(raw, "opj")
    assert got["checked"] and got["complete"] is True
    assert got["declared_bytes"] == len(raw)


def test_truncated_file_is_reported() -> None:
    raw = _project()
    cut = raw[: len(raw) // 3]
    got = container_integrity(cut, "opj")
    assert got["checked"] and got["complete"] is False
    assert got["declared_bytes"] == len(raw) and got["file_bytes"] == len(cut)


def test_cut_inside_the_header_is_truncated() -> None:
    raw = _project()
    assert container_integrity(raw[:60], "opj")["complete"] is False


def test_longer_than_recorded_is_unverified_not_complete() -> None:
    got = container_integrity(_project() + b"extra", "opj")
    assert got["checked"] and got["complete"] is None


def test_versions_without_a_size_field_are_not_checked() -> None:
    raw = _project()
    old = b"CPYA 4.3227 188 #\n" + raw[raw.find(b"\n") + 1 :]
    assert container_integrity(old, "opj")["checked"] is False
    assert container_integrity(b"CPYUA 4.3811 188 W64 #\n", "opju")["checked"] is False


def test_manifest_gains_file_truncated_and_fails_closed() -> None:
    manifest = {
        "version": 1, "container": "opj", "status": "best_effort",
        "graph_records_total": 0, "graph_records_actionable": 0,
        "graph_records_filtered": 0, "omissions": ["no_graph_records"],
        "filtered_figures": [], "preview_diagnostics": [],
    }
    raw = _project()
    out = apply_container_integrity(manifest, raw[:5000], "opj")  # type: ignore[arg-type]
    assert out["omissions"] == ["file_truncated", "no_graph_records"]
    assert out["status"] == "unresolved"
    ok = apply_container_integrity(manifest, raw, "opj")  # type: ignore[arg-type]
    assert "file_truncated" not in ok["omissions"] and ok["status"] == "best_effort"


def test_truncated_upload_imports_what_it_can_and_says_it_is_incomplete() -> None:
    raw = _project()
    client = TestClient(app)
    full = client.post(
        "/api/parsers/upload", files={"file": ("multi.opj", io.BytesIO(raw))}
    ).json()
    assert full["origin_fidelity"]["container_integrity"]["complete"] is True
    assert "file_truncated" not in full["origin_fidelity"]["omissions"]

    cut = client.post(
        "/api/parsers/upload", files={"file": ("cut.opj", io.BytesIO(raw[: len(raw) // 3]))}
    )
    assert cut.status_code == 200  # parse rules unchanged: what decodes still imports
    fidelity = cut.json()["origin_fidelity"]
    assert "file_truncated" in fidelity["omissions"]
    assert fidelity["status"] == "unresolved"
    assert fidelity["container_integrity"]["declared_bytes"] == len(raw)

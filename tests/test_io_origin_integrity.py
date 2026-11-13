"""Origin container completeness diagnostic (``io/origin_project/integrity.py``).

Audit 2026-11: the first third of a 4-book ``.opj`` imported with HTTP 200
as 3 books with partial columns and no warning. The reader's parse rules are
unchanged; the import now reports the file as truncated because it is
shorter than the size its own v4.3380 file header records (fh offset 115).
"""

from __future__ import annotations

import io
import re
from collections import Counter
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.datastruct import DataStruct
from quantized.io.origin_project import read_origin_books
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
    body = raw[raw.find(b"\n") + 1 :]
    # Unmeasured versions -- older, NEWER, or in between -- are never judged.
    for version in (b"4.3227", b"4.3116", b"4.3400", b"4.3811", b"5.0000"):
        got = container_integrity(b"CPYA " + version + b" 188 #\n" + body[:5000], "opj")
        assert got["checked"] is False and got["complete"] is None, version
    # A measured version whose fh block is not the measured length: unchecked.
    odd = b"CPYA 4.3445 188 #\n" + body  # 4.3445 measured with a 124-byte fh
    assert container_integrity(odd[:5000], "opj")["checked"] is False
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


@pytest.mark.realdata
def test_real_corpus_has_zero_false_truncated_verdicts(corpus_dir: Path) -> None:
    """Every real ``.opj`` that parses must NOT be called truncated (none of
    the corpus files is), and every checked file must match its header
    exactly. Prints the per-version distribution (``pytest -s``) -- the
    numbers the gate in ``integrity._MEASURED`` was set from."""
    origin = corpus_dir / "origin"
    files = sorted(p for p in origin.rglob("*") if p.is_file() and p.suffix.lower() == ".opj")
    if not files:
        pytest.skip("no .opj files under the corpus")
    dist: dict[str, Counter[str]] = {}
    false_truncated: list[str] = []
    unverified: list[str] = []
    parsed = 0
    for path in files:
        raw = path.read_bytes()
        try:
            read_origin_books(path)
        except Exception:  # noqa: BLE001 - "files that parse" is the population
            continue
        parsed += 1
        m = re.match(rb"CPYA (\d+\.\d+)", raw)
        version = m.group(1).decode() if m else "?"
        got = container_integrity(raw, "opj")
        verdict = (
            "unchecked" if not got["checked"]
            else {True: "complete", False: "TRUNCATED", None: "longer"}[got["complete"]]
        )
        dist.setdefault(version, Counter())[verdict] += 1
        rel = str(path.relative_to(origin))
        if verdict == "TRUNCATED":
            false_truncated.append(rel)
        elif verdict == "longer":
            unverified.append(rel)
    for version in sorted(dist):
        print(f"CPYA {version}: {dict(dist[version])}")
    print(f"parsed {parsed}/{len(files)} .opj files")
    assert parsed > 0
    assert false_truncated == []
    assert unverified == []  # a checked real file matches its header exactly
    assert sum(c["complete"] for c in dist.values()) > 0  # the check really ran

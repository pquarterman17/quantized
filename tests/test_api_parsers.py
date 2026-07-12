"""Integration tests for the /api/parsers routes (TestClient)."""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.routes import parsers as parsers_mod

client = TestClient(app)
FIXTURE = Path(__file__).parent / "fixtures" / "qd_edp124.dat"


def test_import_qd_returns_datastruct() -> None:
    resp = client.post("/api/parsers/import", json={"path": str(FIXTURE)})
    assert resp.status_code == 200
    body = resp.json()
    assert body["labels"] == ["Moment"]
    assert body["units"] == ["emu"]
    assert len(body["time"]) == 401
    assert len(body["values"]) == 401
    assert body["metadata"]["parser_name"] == "import_qd_vsm"


def test_import_missing_file_404() -> None:
    resp = client.post("/api/parsers/import", json={"path": "definitely_not_here.dat"})
    assert resp.status_code == 404


def test_import_unknown_format_422(tmp_path: Path) -> None:
    bogus = tmp_path / "mystery.zzz"
    bogus.write_text("not a known format")
    resp = client.post("/api/parsers/import", json={"path": str(bogus)})
    assert resp.status_code == 422


def test_upload_qd_returns_datastruct() -> None:
    content = FIXTURE.read_bytes()
    resp = client.post(
        "/api/parsers/upload",
        files={"file": ("qd_edp124.dat", content, "application/octet-stream")},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["labels"] == ["Moment"]
    assert len(body["time"]) == 401
    assert body["metadata"]["parser_name"] == "import_qd_vsm"


def test_upload_unknown_format_422() -> None:
    resp = client.post(
        "/api/parsers/upload",
        files={"file": ("mystery.zzz", b"not a known format", "text/plain")},
    )
    assert resp.status_code == 422


def test_upload_strips_path_components() -> None:
    # A malicious filename with .. must be reduced to its basename.
    content = FIXTURE.read_bytes()
    resp = client.post(
        "/api/parsers/upload",
        files={"file": ("../../evil/qd_edp124.dat", content, "application/octet-stream")},
    )
    assert resp.status_code == 200


# ── /import path confinement (CodeQL py/path-injection hardening) ─────────────


def test_import_rejects_path_outside_allowed_roots(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A path resolving outside the allowed roots is rejected (403), not read."""
    allowed = tmp_path / "allowed"
    allowed.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    target = outside / "qd.dat"
    target.write_bytes(FIXTURE.read_bytes())
    monkeypatch.setattr(parsers_mod, "_allowed_roots", lambda: (os.path.realpath(allowed),))
    resp = client.post("/api/parsers/import", json={"path": str(target)})
    assert resp.status_code == 403


def test_import_blocks_traversal_escape(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A '..' that escapes the root after resolution is rejected (403)."""
    allowed = tmp_path / "allowed"
    allowed.mkdir()
    secret = tmp_path / "secret.dat"
    secret.write_bytes(FIXTURE.read_bytes())
    monkeypatch.setattr(parsers_mod, "_allowed_roots", lambda: (os.path.realpath(allowed),))
    escape = str(allowed / ".." / "secret.dat")
    resp = client.post("/api/parsers/import", json={"path": escape})
    assert resp.status_code == 403


def test_import_allows_path_inside_root(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A path inside an allowed root imports normally (200)."""
    allowed = tmp_path / "allowed"
    allowed.mkdir()
    target = allowed / "qd_edp124.dat"
    target.write_bytes(FIXTURE.read_bytes())
    monkeypatch.setattr(parsers_mod, "_allowed_roots", lambda: (os.path.realpath(allowed),))
    resp = client.post("/api/parsers/import", json={"path": str(target)})
    assert resp.status_code == 200
    assert resp.json()["metadata"]["parser_name"] == "import_qd_vsm"


def test_allowed_roots_includes_home_and_cwd() -> None:
    roots = parsers_mod._allowed_roots()
    assert os.path.realpath(Path.home()) in roots
    assert os.path.realpath(Path.cwd()) in roots


def test_allowed_roots_honours_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    extra = tmp_path / "data_root"
    extra.mkdir()
    monkeypatch.setenv("QZ_DATA_ROOTS", str(extra))
    assert os.path.realpath(extra) in parsers_mod._allowed_roots()


def test_upload_origin_project_returns_all_books(tmp_path):
    """A multi-book .opj upload carries a 'books' payload array (import-all UX)."""
    import numpy as np

    from quantized.datastruct import DataStruct
    from quantized.io.origin_project.writer import opj_bytes

    def mk(book, xlong):
        return DataStruct(
            time=np.array([1.0, 2.0]),
            values=np.array([[3.0], [4.0]]),
            labels=("M",),
            units=("emu",),
            metadata={"origin_book": book, "x_column_long": xlong},
        )

    data = opj_bytes([mk("LoopA", "Field"), mk("ScanB", "2Theta")])
    resp = client.post(
        "/api/parsers/upload", files={"file": ("two.opj", data, "application/octet-stream")}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "books" in body and len(body["books"]) == 2
    names = {b["metadata"]["origin_book"] for b in body["books"]}
    assert names == {"LoopA", "ScanB"}
    # non-project uploads stay unchanged (no books key)
    csv = b"x,y\n1,2\n3,4\n"
    resp2 = client.post("/api/parsers/upload", files={"file": ("plain.csv", csv, "text/csv")})
    assert resp2.status_code == 200
    assert "books" not in resp2.json()


def test_opj_import_filters_nonactionable_figure_records(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The presentation gate applies to old ``.opj`` as well as ``.opju``.

    Real ``XMCD.opj`` contains dozens of internal/hintless layer anchors; they
    belong in decoder diagnostics, not as disabled rows in the Library.
    """
    import numpy as np

    from quantized.datastruct import DataStruct

    project = tmp_path / "dead-figures.opj"
    project.write_bytes(b"CPYA synthetic route fixture")
    ds = DataStruct(
        time=np.array([1.0, 2.0]),
        values=np.array([[3.0], [4.0]]),
        labels=("Y",),
        units=("",),
        metadata={"origin_book": "Book1"},
    )
    monkeypatch.setattr(parsers_mod, "read_origin_project_all", lambda *_args, **_kw: (ds, [ds]))
    monkeypatch.setattr(
        parsers_mod,
        "extract_figures",
        lambda _raw: [
            {"name": "Graph1", "curves": [{"book": "Book1", "x": "A", "y": "B"}]},
            {"name": "SYSTEM", "curves": [], "source_hint": ""},
        ],
    )

    body = parsers_mod._import_with_books(project)

    assert [f["name"] for f in body["figures"]] == ["Graph1"]


@pytest.mark.realdata
def test_every_origin_corpus_file_imports_without_crashing(corpus_dir: Path) -> None:
    """Every real ``.opj``/``.opju`` in the corpus must import through the route
    with HTTP 200 — an integration crash-safety guard over the whole Origin
    pipeline (decode + figures + folder tree). Regression guard for the
    deep-nesting RecursionError and the EOF Y-transition-marker IndexError,
    both of which 500'd this route before being fixed. Auto-skips in CI
    (corpus is local-only)."""
    origin = corpus_dir / "origin"
    if not origin.is_dir():
        pytest.skip("origin corpus subdir absent")
    files = sorted(p for ext in ("*.opj", "*.opju") for p in origin.glob(ext))
    assert files, "no Origin corpus files found under test-data/origin"
    failures = []
    for p in files:
        resp = client.post("/api/parsers/import", json={"path": str(p)})
        if resp.status_code != 200:
            failures.append(f"{p.name}: HTTP {resp.status_code} — {resp.text[:120]}")
    assert not failures, "Origin imports that did not return 200:\n" + "\n".join(failures)

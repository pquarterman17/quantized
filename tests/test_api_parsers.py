"""Integration tests for the /api/parsers routes (TestClient)."""

from __future__ import annotations

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
    monkeypatch.setattr(parsers_mod, "_allowed_roots", lambda: (allowed.resolve(),))
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
    monkeypatch.setattr(parsers_mod, "_allowed_roots", lambda: (allowed.resolve(),))
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
    monkeypatch.setattr(parsers_mod, "_allowed_roots", lambda: (allowed.resolve(),))
    resp = client.post("/api/parsers/import", json={"path": str(target)})
    assert resp.status_code == 200
    assert resp.json()["metadata"]["parser_name"] == "import_qd_vsm"


def test_allowed_roots_includes_home_and_cwd() -> None:
    roots = parsers_mod._allowed_roots()
    assert Path.home().resolve() in roots
    assert Path.cwd().resolve() in roots


def test_allowed_roots_honours_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    extra = tmp_path / "data_root"
    extra.mkdir()
    monkeypatch.setenv("QZ_DATA_ROOTS", str(extra))
    assert extra.resolve() in parsers_mod._allowed_roots()

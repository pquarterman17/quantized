"""Integration tests for the /api/import/template routes (TestClient).

Mirrors ``test_api_parsers.py``'s structure (this route duplicates the same
path-confinement guard, see ``routes/import_template.py``'s module docstring
for why it isn't imported instead)."""

from __future__ import annotations

import os
import struct
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.routes import import_template as import_template_mod

client = TestClient(app)


def _block(payload: bytes) -> bytes:
    return struct.pack("<I", len(payload)) + b"\n" + payload + b"\n"


def _window_header(name: str) -> bytes:
    payload = b"\x00\x00" + name.encode("latin1") + b"\x00"
    payload += b"\x00" * (165 - len(payload))
    return _block(payload)


def _layer_block(x_from: float, x_to: float, y_from: float, y_to: float) -> bytes:
    payload = bytearray(240)
    payload[0:4] = bytes([0, 0, 0x1F, 0])
    struct.pack_into("<d", payload, 15, x_from)
    struct.pack_into("<d", payload, 23, x_to)
    struct.pack_into("<d", payload, 58, y_from)
    struct.pack_into("<d", payload, 66, y_to)
    return _block(bytes(payload))


def _otp_specimen() -> bytes:
    return b"CPYA 4.3380 188 W64 #\n" + _window_header("Graph1") + _layer_block(0.0, 1.0, 0.0, 2.0)


def test_get_template_by_path_returns_graph_template(tmp_path: Path) -> None:
    target = tmp_path / "specimen.otp"
    target.write_bytes(_otp_specimen())
    resp = client.get("/api/import/template", params={"path": str(target)})
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "specimen"
    assert body["style"] == "default"
    assert body["overrides"] == {"x_lim": [0.0, 1.0], "y_lim": [0.0, 2.0]}


def test_get_template_missing_file_404(tmp_path: Path) -> None:
    resp = client.get("/api/import/template", params={"path": str(tmp_path / "nope.otp")})
    assert resp.status_code == 404


def test_get_template_unrecognized_format_422(tmp_path: Path) -> None:
    bogus = tmp_path / "notes.txt"
    bogus.write_text("not a template")
    resp = client.get("/api/import/template", params={"path": str(bogus)})
    assert resp.status_code == 422


def test_get_template_bad_magic_422(tmp_path: Path) -> None:
    bogus = tmp_path / "fake.otp"
    bogus.write_bytes(b"not a real origin container at all, just padding text here")
    resp = client.get("/api/import/template", params={"path": str(bogus)})
    assert resp.status_code == 422


def test_upload_template_returns_graph_template() -> None:
    content = _otp_specimen()
    resp = client.post(
        "/api/import/template/upload",
        files={"file": ("specimen.otp", content, "application/octet-stream")},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "specimen"
    assert body["overrides"] == {"x_lim": [0.0, 1.0], "y_lim": [0.0, 2.0]}


def test_upload_template_unrecognized_format_422() -> None:
    resp = client.post(
        "/api/import/template/upload",
        files={"file": ("mystery.zzz", b"not a known format", "text/plain")},
    )
    assert resp.status_code == 422


# ── path confinement (mirrors test_api_parsers.py) ────────────────────────────


def test_rejects_path_outside_allowed_roots(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    allowed = tmp_path / "allowed"
    allowed.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    target = outside / "specimen.otp"
    target.write_bytes(_otp_specimen())
    monkeypatch.setattr(
        import_template_mod, "_allowed_roots", lambda: (os.path.realpath(allowed),)
    )
    resp = client.get("/api/import/template", params={"path": str(target)})
    assert resp.status_code == 403


def test_blocks_traversal_escape(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    allowed = tmp_path / "allowed"
    allowed.mkdir()
    secret = tmp_path / "secret.otp"
    secret.write_bytes(_otp_specimen())
    monkeypatch.setattr(
        import_template_mod, "_allowed_roots", lambda: (os.path.realpath(allowed),)
    )
    escape = str(allowed / ".." / "secret.otp")
    resp = client.get("/api/import/template", params={"path": escape})
    assert resp.status_code == 403


def test_allows_path_inside_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    allowed = tmp_path / "allowed"
    allowed.mkdir()
    target = allowed / "specimen.otp"
    target.write_bytes(_otp_specimen())
    monkeypatch.setattr(
        import_template_mod, "_allowed_roots", lambda: (os.path.realpath(allowed),)
    )
    resp = client.get("/api/import/template", params={"path": str(target)})
    assert resp.status_code == 200


def test_allowed_roots_includes_home_and_cwd() -> None:
    roots = import_template_mod._allowed_roots()
    assert os.path.realpath(Path.home()) in roots
    assert os.path.realpath(Path.cwd()) in roots

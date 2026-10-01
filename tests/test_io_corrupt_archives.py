"""Corrupt ZIP members and malformed XML in the archive-based parsers.

A damaged ``.brml`` / ``.xlsx`` (a flipped byte, a cut-off deflate stream,
XML that does not parse) raised ``BadZipFile``, ``zlib.error``, ``EOFError``
or an XML ``ParseError`` -- none a ``ValueError`` -- so the import routes
answered 500 for what is a bad input file. Each must be a ``ValueError``
naming the file, which the routes turn into a 422.
"""

from __future__ import annotations

import zipfile
from collections.abc import Callable
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.io.bruker_brml import import_bruker_brml
from quantized.io.excel import import_excel

openpyxl = pytest.importorskip("openpyxl")

no_raise_client = TestClient(app, raise_server_exceptions=False)

_BRML_MEMBER = "Experiment0/RawData0.xml"
_SHEET_MEMBER = "xl/worksheets/sheet1.xml"


def _brml(path: Path) -> str:
    body = b"<RawData><DataRoutes><DataRoute RouteFlag='Measured'>"
    body += b"<Datum>1,2,3</Datum>" * 3000 + b"</DataRoute></DataRoutes></RawData>"
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(_BRML_MEMBER, body)
    return _BRML_MEMBER


def _xlsx(path: Path) -> str:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["x", "y"])
    for i in range(3000):
        ws.append([float(i), float(i * i)])
    wb.save(path)
    return _SHEET_MEMBER


def _rewrite(path: Path, member: str, data: bytes) -> None:
    """Replace ``member`` with ``data`` (stored compressed, CRC consistent)."""
    with zipfile.ZipFile(path) as src:
        parts = [(info, src.read(info)) for info in src.infolist()]
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as dst:
        for info, raw in parts:
            dst.writestr(info.filename, data if info.filename == member else raw)


def _damage(path: Path, member: str, how: str) -> None:
    if how == "malformed_xml":
        _rewrite(path, member, b"<?xml version='1.0'?><root><unclosed>")
        return
    raw = bytearray(path.read_bytes())
    with zipfile.ZipFile(path) as zf:
        info = zf.getinfo(member)
    head = info.header_offset
    start = head + 30 + int.from_bytes(raw[head + 26 : head + 28], "little")
    start += int.from_bytes(raw[head + 28 : head + 30], "little")
    if how == "bad_crc":  # intact data, wrong checksum in both headers
        old = info.CRC.to_bytes(4, "little")
        raw = bytearray(bytes(raw).replace(old, (info.CRC ^ 1).to_bytes(4, "little")))
    elif how == "flipped_byte":  # an invalid deflate block, or a CRC mismatch
        raw[start + info.compress_size // 2] ^= 0xFF
    elif how == "garbage_stream":  # not a deflate stream at all
        raw[start : start + 16] = b"\xff" * 16
    path.write_bytes(bytes(raw))


_FORMATS: dict[str, tuple[str, Callable[[Path], str], Callable[[Path], object]]] = {
    "brml": (".brml", _brml, import_bruker_brml),
    "xlsx": (".xlsx", _xlsx, import_excel),
}
_DAMAGE = ["bad_crc", "flipped_byte", "garbage_stream", "malformed_xml"]


@pytest.mark.parametrize("how", _DAMAGE)
@pytest.mark.parametrize("fmt", list(_FORMATS))
def test_corrupt_archive_is_a_value_error_naming_the_file(
    tmp_path: Path, fmt: str, how: str
) -> None:
    ext, build, parse = _FORMATS[fmt]
    path = tmp_path / f"damaged{ext}"
    _damage(path, build(path), how)
    with pytest.raises(ValueError, match=f"damaged\\{ext}"):
        parse(path)


def test_xlsx_malformed_workbook_part_is_a_value_error(tmp_path: Path) -> None:
    path = tmp_path / "book.xlsx"
    _xlsx(path)
    _rewrite(path, "xl/workbook.xml", b"<workbook><sheets>")
    with pytest.raises(ValueError, match="book.xlsx"):
        import_excel(path)


@pytest.mark.parametrize("how", _DAMAGE)
@pytest.mark.parametrize("fmt", list(_FORMATS))
def test_corrupt_archive_upload_is_422_not_500(tmp_path: Path, fmt: str, how: str) -> None:
    ext, build, _parse = _FORMATS[fmt]
    path = tmp_path / f"damaged{ext}"
    _damage(path, build(path), how)
    resp = no_raise_client.post(
        "/api/parsers/upload",
        files={"file": (path.name, path.read_bytes(), "application/octet-stream")},
    )
    assert resp.status_code == 422, resp.text
    assert path.name in resp.json()["detail"]

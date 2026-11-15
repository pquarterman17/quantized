"""``qz convert --to dwk`` gives the Library an in-app import gives (review M2).

Two committed frontend fixtures, both made here from ONE synthetic project
(``convert_fixtures.loops_opj``: two workbooks, one with two sheets, a long
name, Y-error designations):

* ``__fixtures__/convertedWorkspace.dwk`` -- what ``convert_origin_project``
  writes for it;
* ``__fixtures__/originImportPayload.json`` -- the import route's own response
  for the same file (``routes/parsers._import_with_books``, the bytes the app
  receives).

``frontend/src/lib/workspaceDwkWriter.parity.test.ts`` feeds the payload to the
app's real import (the store's ``importPaths``) and compares the result with
the ``.dwk`` opened by the app's reader: names, data, error-bar roles,
folders, workbooks, active book, source, fidelity. This test fails when
either fixture is stale. The project path is written as ``/fixture/loops.opj``
in both, so the files do not depend on where the test ran.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from convert_fixtures import loops_opj
from quantized.io.origin_convert import convert_origin_project
from quantized.routes._payload import DataStructResponse
from quantized.routes.parsers import _import_with_books

FIXTURES = Path(__file__).resolve().parents[1] / "frontend" / "src" / "lib" / "__fixtures__"
DWK = FIXTURES / "convertedWorkspace.dwk"
PAYLOAD = FIXTURES / "originImportPayload.json"
PROJECT_PATH = "/fixture/loops.opj"
IMPORTED_AT = "2026-01-01T00:00:00.000Z"
REGEN_HINT = (
    "regenerate with `uv run python -c \"import sys; sys.path.insert(0, 'tests'); "
    'import test_convert_dwk_parity as t; t.write_fixtures()"`'
)


def _fixtures(tmp: Path) -> tuple[str, str]:
    src = loops_opj(tmp / "loops.opj")
    report = convert_origin_project(src, tmp / "out", "dwk", imported_at=IMPORTED_AT)
    assert report["status"] == "ok", report
    doc: dict[str, Any] = json.loads((tmp / "out" / "loops.opj.dwk").read_text(encoding="utf-8"))
    for entry in doc["datasets"]:
        entry["source"]["path"] = PROJECT_PATH
    dwk = json.dumps(doc, ensure_ascii=False, separators=(",", ":"))
    payload, _handle = _import_with_books(src)
    payload["book_source"]["path"] = PROJECT_PATH
    body = bytes(DataStructResponse(payload).body).decode("utf-8")
    return dwk, json.dumps(json.loads(body), ensure_ascii=False, indent=1) + "\n"


def write_fixtures() -> None:
    """Rewrite both fixtures after a deliberate change."""
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        dwk, payload = _fixtures(Path(tmp))
    DWK.write_text(dwk, encoding="utf-8")
    PAYLOAD.write_text(payload, encoding="utf-8")


def test_frontend_fixtures_match_convert_and_the_import_route(tmp_path: Path) -> None:
    dwk, payload = _fixtures(tmp_path)
    assert DWK.exists() and PAYLOAD.exists(), REGEN_HINT
    assert DWK.read_text(encoding="utf-8") == dwk, REGEN_HINT
    assert PAYLOAD.read_text(encoding="utf-8") == payload, REGEN_HINT

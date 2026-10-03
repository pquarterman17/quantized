"""Multi-sheet Excel workbooks import every data-bearing sheet (plot audit r2).

Before: ``import_auto`` read sheet 0 only and every other sheet vanished with no
word said. Synthetic workbooks only (the corpus files stay private)."""

from __future__ import annotations

from pathlib import Path

import openpyxl
import pytest
from fastapi.testclient import TestClient

from quantized.io import import_auto
from quantized.io.registry import import_auto_sheets


def _book(path: Path, sheets: dict[str, list[list[object]]]) -> Path:
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    for title, rows in sheets.items():
        ws = wb.create_sheet(title)
        for row in rows:
            ws.append(row)
    wb.save(path)
    return path


_DATA_A = [["T (K)", "M (emu)"], [1.0, 10.0], [2.0, 20.0], [3.0, 30.0]]
_DATA_B = [["H (Oe)", "R (ohm)", "V (V)"], [0.0, 5.0, 1.0], [1.0, 6.0, 2.0]]
_SUMMARY = [["Analysis Summary"], ["Instrument: none"]]
_SIMS = [
    ["SIMS depth profile"],
    ["Depth (um)", "B (atoms/cc)"],
    [0.1, 1e18],
    [0.2, 2e18],
    [0.3, 3e18],
]


def test_every_data_sheet_is_imported_and_a_text_sheet_is_named(tmp_path: Path) -> None:
    sheets = {"First": _DATA_A, "Summary": _SUMMARY, "Second": _DATA_B}
    path = _book(tmp_path / "multi.xlsx", sheets)
    out = import_auto_sheets(path)
    assert [d.metadata["sheet_name"] for d in out] == ["First", "Second"]
    assert out[0].labels == ("M",) and out[1].labels == ("R", "V")
    assert list(out[1].time) == [0.0, 1.0]
    assert out[1].metadata["parser_name"] == "import_excel"
    assert out[1].metadata["technique"] == out[0].metadata["technique"]
    assert out[0].metadata["notes"] == ["Sheet 'Summary' has no numeric data; not imported."]


def test_the_primary_sheet_is_unchanged(tmp_path: Path) -> None:
    path = _book(tmp_path / "multi.xlsx", {"First": _DATA_A, "Second": _DATA_B})
    first = import_auto_sheets(path)[0]
    alone = import_auto(path)
    assert first.labels == alone.labels and list(first.time) == list(alone.time)
    assert dict(first.metadata) == dict(alone.metadata)  # no notes when nothing was skipped


def test_a_single_sheet_workbook_is_exactly_import_auto(tmp_path: Path) -> None:
    path = _book(tmp_path / "one.xlsx", {"Only": _DATA_A})
    (only,) = import_auto_sheets(path)
    assert dict(only.metadata) == dict(import_auto(path).metadata)


def test_a_leading_text_sheet_no_longer_fails_the_import(tmp_path: Path) -> None:
    path = _book(tmp_path / "lead.xlsx", {"Summary": _SUMMARY, "Data": _DATA_A})
    with pytest.raises(ValueError):
        import_auto(path)
    (only,) = import_auto_sheets(path)
    assert only.metadata["sheet_name"] == "Data"
    assert "Sheet 'Summary'" in only.metadata["notes"][0]


def test_a_sims_sheet_after_the_first_is_parsed_as_sims(tmp_path: Path) -> None:
    path = _book(tmp_path / "mixed.xlsx", {"Table": _DATA_A, "Depth": _SIMS})
    out = import_auto_sheets(path)
    assert out[1].metadata["parser_name"] == "import_sims"
    assert out[1].metadata["technique"] == "sims"


def test_no_data_anywhere_raises_sheet_zeros_error(tmp_path: Path) -> None:
    path = _book(tmp_path / "text.xlsx", {"A": _SUMMARY, "B": _SUMMARY})
    with pytest.raises(ValueError, match="no numeric data"):
        import_auto_sheets(path)


def test_upload_carries_the_other_sheets(client: TestClient, tmp_path: Path) -> None:
    path = _book(tmp_path / "multi.xlsx", {"First": _DATA_A, "Second": _DATA_B})
    with path.open("rb") as fh:
        res = client.post("/api/parsers/upload", files={"file": ("multi.xlsx", fh)})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["metadata"]["sheet_name"] == "First"
    assert [s["metadata"]["sheet_name"] for s in body["sheets"]] == ["Second"]
    assert body["sheets"][0]["labels"] == ["R", "V"]


def test_a_single_sheet_upload_has_no_sheets_key(client: TestClient, tmp_path: Path) -> None:
    path = _book(tmp_path / "one.xlsx", {"Only": _DATA_A})
    with path.open("rb") as fh:
        res = client.post("/api/parsers/upload", files={"file": ("one.xlsx", fh)})
    assert res.status_code == 200 and "sheets" not in res.json()

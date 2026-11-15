"""``qz convert`` and the Origin-conversion public API (origin gap audit 4, G2).

Every project here is built at test time by the committed synthetic builders
(``io/origin_project/writer.py`` for ``.opj``, ``tests/opju_fixture.py`` for
``.opju``) -- never the private corpus. What is pinned:

* every book AND sheet is converted, not only the primary book ``qz.load``
  returns, with deterministic names, and the values round-trip;
* fail closed per book: a book with an undecoded column is reported and not
  written (``--allow-partial`` writes it, still reported, still exit 1);
* per-file report + exit status (0 only when every file converted fully);
* the ``.dwk`` output is the committed fixture the frontend's
  ``lib/workspaceDwkWriter.parity.test.ts`` opens with the app's own reader.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

import quantized.api as qz
from opju_fixture import CELLS_END, cell_num, dataset, project, spec
from quantized.cli import main as qz_main
from quantized.cli_convert import convert_command, expand_inputs, unique_prefixes
from quantized.datastruct import DataStruct
from quantized.io.origin_convert import book_problems
from quantized.io.origin_project.writer import opj_bytes
from quantized.io.workspace_dwk import DwkDataset, workspace_json

DWK_FIXTURE = (
    Path(__file__).resolve().parents[1]
    / "frontend"
    / "src"
    / "lib"
    / "__fixtures__"
    / "convertedWorkspace.dwk"
)
REGEN_HINT = (
    "regenerate with "
    "`uv run python -c \"import sys; sys.path.insert(0, 'tests'); "
    "import test_cli_convert as t; t.write_fixture()\"`"
)


def _book(book: str, n: int = 4, long: str = "") -> DataStruct:
    return DataStruct(
        time=np.arange(1.0, n + 1),
        values=np.column_stack([np.arange(n) * 10.0, np.arange(n) * 0.5]),
        labels=("Moment", "Error"),
        units=("emu", "emu"),
        metadata={
            "origin_book": book,
            "origin_book_long": long,
            "x_column_long": "Field",
            "x_unit": "Oe",
        },
    )


def _loops_opj(path: Path) -> Path:
    """Two workbooks: Loop1 with two sheets, Scan2 with one."""
    books = [_book("Loop1", long="30 nm µ"), _book("Loop1@2", 3), _book("Scan2", 5)]
    path.write_bytes(opj_bytes(books, ["a", "a", ""]))
    return path


def _tn(name: str, cells: bytes, total: int, used: int) -> bytes:
    return dataset(name, cells + CELLS_END, kind=0x61, total=total, used=used, size=10)


def _undecodable_column_opju(path: Path) -> Path:
    """One book whose column B is a record form the reader cannot identify."""
    path.write_bytes(
        project(
            _tn("Book1_A", cell_num(1.0) + cell_num(2.0), 2, 2),
            _tn("Book1_B", b"\x07\x00" + spec(1.0) + cell_num(2.0), 2, 2),
        )
    )
    return path


# ── the public API ──────────────────────────────────────────────────────────


def test_read_origin_books_returns_every_book_and_sheet(tmp_path: Path) -> None:
    path = _loops_opj(tmp_path / "loops.opj")
    books = qz.read_origin_books(path)
    assert [b.metadata["origin_book"] for b in books] == ["Loop1", "Loop1@2", "Scan2"]
    assert all(b.metadata["origin_folder_path"] == [] for b in books)
    # load() keeps one DataStruct per file: the largest book only.
    assert qz.load(path).metadata["origin_book"] == "Scan2"


def test_save_table_round_trips_names_units_and_values(tmp_path: Path) -> None:
    ds = _book("Loop1")
    back = qz.load(qz.save_table(ds, tmp_path / "t.csv"))
    np.testing.assert_array_equal(back.time, ds.time)
    np.testing.assert_array_equal(back.values, ds.values)
    assert back.labels == ("Moment", "Error") and back.units == ("emu", "emu")
    with pytest.raises(ValueError, match="one sheet"):
        qz.save_table([("a", ds), ("b", ds)], tmp_path / "two.csv")


# ── conversion ──────────────────────────────────────────────────────────────


def test_csv_writes_one_file_per_sheet_with_deterministic_names(tmp_path: Path) -> None:
    src = _loops_opj(tmp_path / "loops.opj")
    report = qz.convert_origin_project(src, tmp_path / "out", "csv")
    assert report["status"] == "ok" and report["error"] is None
    assert report["outputs"] == [
        "loops.opj__Loop1.csv",
        "loops.opj__Loop1__sheet2.csv",
        "loops.opj__Scan2.csv",
    ]
    assert [(b["book"], b["sheet"], b["status"]) for b in report["books"]] == [
        ("Loop1", 1, "written"),
        ("Loop1", 2, "written"),
        ("Scan2", 1, "written"),
    ]
    sheet2 = qz.load(tmp_path / "out" / "loops.opj__Loop1__sheet2.csv")
    assert sheet2.time.tolist() == [1.0, 2.0, 3.0]
    assert sheet2.values[:, 0].tolist() == [0.0, 10.0, 20.0]
    text = (tmp_path / "out" / "loops.opj__Loop1.csv").read_text(encoding="utf-8")
    assert text.splitlines()[:2] == ["Field,Moment,Error", "Oe,emu,emu"]


def test_xlsx_writes_one_workbook_per_book_a_tab_per_sheet(tmp_path: Path) -> None:
    from openpyxl import load_workbook

    src = _loops_opj(tmp_path / "loops.opj")
    report = qz.convert_origin_project(src, tmp_path / "out", "xlsx")
    assert report["outputs"] == ["loops.opj__Loop1.xlsx", "loops.opj__Scan2.xlsx"]
    wb = load_workbook(tmp_path / "out" / "loops.opj__Loop1.xlsx")
    assert wb.sheetnames == ["Sheet1", "Sheet2"]
    assert [c.value for c in wb["Sheet2"][3]] == [1, 0, 0]


def test_dwk_writes_one_workspace_with_every_sheet(tmp_path: Path) -> None:
    src = _loops_opj(tmp_path / "loops.opj")
    report = qz.convert_origin_project(src, tmp_path / "out", "dwk")
    assert report["outputs"] == ["loops.opj.dwk"]
    doc = json.loads((tmp_path / "out" / "loops.opj.dwk").read_text(encoding="utf-8"))
    assert doc["format"] == "quantized-workspace" and doc["version"] == 3
    assert [d["name"] for d in doc["datasets"]] == ["loops:Loop1", "loops:Loop1@2", "loops:Scan2"]
    assert doc["folders"] == [{"id": "f-1", "name": "loops", "parentId": None, "order": 1}]
    assert {d["folderId"] for d in doc["datasets"]} == {"f-1"}


def test_an_undecodable_column_skips_its_book_fail_closed(tmp_path: Path) -> None:
    src = _undecodable_column_opju(tmp_path / "bad.opju")
    report = qz.convert_origin_project(src, tmp_path / "out", "csv")
    assert report["status"] == "failed"
    assert report["outputs"] == []
    (book,) = report["books"]
    assert book["status"] == "skipped"
    assert book["problems"] == ["1 column(s) not decoded: B"]
    assert not list((tmp_path / "out").glob("*.csv"))

    partial = qz.convert_origin_project(src, tmp_path / "p", "csv", allow_partial=True)
    assert partial["status"] == "partial"
    assert partial["books"][0]["status"] == "partial"
    assert partial["outputs"] == ["bad.opju__Book1.csv"]


def test_a_book_with_problems_never_leaves_the_project_ok(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Even when it holds nothing to write: its loss is still a loss."""
    lost = DataStruct(
        time=np.array([np.nan]),
        values=np.full((1, 1), np.nan),
        metadata={"origin_book": "Book2", "origin_columns_lost": {"B": "unknown storage"}},
    )
    monkeypatch.setattr(
        "quantized.io.origin_convert.read_origin_books", lambda _p: [_book("Book1"), lost]
    )
    src = tmp_path / "p.opj"
    src.write_bytes(b"")
    report = qz.convert_origin_project(src, tmp_path / "out", "csv", allow_partial=True)
    assert [b["status"] for b in report["books"]] == ["written", "empty"]
    assert report["status"] == "partial"


def test_book_problems_names_every_fail_closed_marker() -> None:
    def meta(**kw: object) -> DataStruct:
        return DataStruct(time=np.arange(2.0), values=np.zeros((2, 1)), metadata=kw)

    assert book_problems(meta()) == ([], [])
    assert book_problems(meta(origin_columns_lost={"C": "unknown storage"}))[0] == [
        "column C not decoded (unknown storage)"
    ]
    x_lost = meta(x_column_recovered=False, x_column_unrecovered_reason="X is text")
    assert book_problems(x_lost)[0] == ["X column not recovered: X is text"]
    problems, notes = book_problems(
        meta(
            origin_worksheet_losses={
                "grammar_only": {"count": 2, "columns": ["A", "B"]},
                "checksum_failed": {"count": 1, "columns": ["C"]},
                "some_new_kind": {"count": 1, "columns": []},
            },
            origin_decode="content_sniffing",
        )
    )
    # An unknown loss kind blocks too: fail closed on what we cannot classify.
    assert problems == [
        "1 column(s) failed their checksum (values may be corrupt): C",
        "1 some_new_kind",
    ]
    assert notes[0] == "2 column(s) read from an older Origin format without a length check: A, B"
    assert "legacy content scan" in notes[1]


def test_unreadable_and_non_origin_files_fail_with_a_reason(tmp_path: Path) -> None:
    junk = tmp_path / "junk.opj"
    junk.write_bytes(b"not an origin project")
    report = qz.convert_origin_project(junk, tmp_path / "out", "csv")
    assert report["status"] == "failed" and "OriginProjectError" in report["error"]
    other = tmp_path / "data.csv"
    other.write_text("x,y\n1,2\n", encoding="utf-8")
    assert "not an Origin project" in qz.convert_origin_project(other, tmp_path, "csv")["error"]
    with pytest.raises(ValueError, match="unknown format"):
        qz.convert_origin_project(junk, tmp_path, "pdf")


# ── the CLI ─────────────────────────────────────────────────────────────────


def test_cli_converts_a_glob_writes_the_report_and_exits_by_outcome(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    _loops_opj(tmp_path / "loops.opj")
    _undecodable_column_opju(tmp_path / "bad.opju")
    out = tmp_path / "out"
    code = convert_command([str(tmp_path / "*.opj*"), "--to", "csv", "--out", str(out)])
    assert code == 1  # one file failed
    report = json.loads((out / "convert-report.json").read_text(encoding="utf-8"))
    assert report["summary"] == {"ok": 1, "partial": 0, "failed": 1}
    assert [Path(f["source"]).name for f in report["files"]] == ["bad.opju", "loops.opj"]
    printed = capsys.readouterr().out
    assert "skipped Book1 sheet 1: 1 column(s) not decoded: B" in printed
    assert "1 ok, 0 partial, 1 failed" in printed

    ok = convert_command([str(tmp_path / "loops.opj"), "--to", "xlsx", "--out", str(out)])
    assert ok == 0


def test_cli_dispatch_and_usage_errors(tmp_path: Path) -> None:
    _loops_opj(tmp_path / "loops.opj")
    with pytest.raises(SystemExit) as done:
        qz_main(["convert", str(tmp_path / "loops.opj"), "--to", "dwk", "--out", str(tmp_path)])
    assert done.value.code == 0
    assert (tmp_path / "loops.opj.dwk").is_file()
    out = ["--to", "csv", "--out", str(tmp_path)]
    assert convert_command([str(tmp_path / "*.nothing"), *out]) == 2  # nothing matched
    assert convert_command([str(tmp_path / "gone.opj"), *out]) == 1  # reported as failed


def test_same_file_name_in_two_folders_never_overwrites(tmp_path: Path) -> None:
    (tmp_path / "a").mkdir()
    (tmp_path / "b").mkdir()
    paths = [_loops_opj(tmp_path / "a" / "x.opj"), _loops_opj(tmp_path / "b" / "x.opj")]
    assert unique_prefixes(paths) == ["x.opj", "x.opj~2"]
    assert expand_inputs([str(tmp_path / "**" / "*.opj"), str(paths[0])]) == paths


# ── the .dwk the app opens (frontend parity fixture) ────────────────────────


def _fixture_text() -> str:
    """Two sheets of one book in a nested Origin folder, one book at the
    project root, and every non-finite cell form the app's reader decodes."""
    sheet1 = _book("Loop1", long="30 nm")
    sheet2 = DataStruct(
        time=np.array([1.0, 2.0, 3.0]),
        values=np.array([[np.nan, -0.0], [np.inf, 1.5], [-np.inf, 2.5]]),
        labels=("Moment", "Error"),
        units=("emu", "emu"),
        metadata={"origin_book": "Loop1@2", "note": float("nan")},
    )
    scan = _book("Scan2", 2)
    return workspace_json(
        [
            DwkDataset("loops:Loop1", sheet1, ["loops", "Samples", "30 nm"]),
            DwkDataset("loops:Loop1@2", sheet2, ["loops", "Samples", "30 nm"]),
            DwkDataset("loops:Scan2", scan, ["loops"]),
        ]
    )


def write_fixture() -> None:
    """Rewrite the committed frontend fixture after a deliberate change."""
    DWK_FIXTURE.write_text(_fixture_text(), encoding="utf-8")


def test_frontend_dwk_fixture_matches_the_writer() -> None:
    assert DWK_FIXTURE.exists(), REGEN_HINT
    assert DWK_FIXTURE.read_text(encoding="utf-8") == _fixture_text(), REGEN_HINT

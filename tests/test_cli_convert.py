"""``qz convert`` and the Origin-conversion public API (origin gap audit 4, G2).

Every project is built at test time by the committed synthetic builders
(``tests/convert_fixtures.py``), never the private corpus. Pinned here:
every book AND sheet converted with deterministic names; the per-file report
and exit status; the CLI's handling of literal, bracketed, globbed and
unmatched inputs. The fail-closed rules are in ``test_convert_fail_closed.py``,
the ``.dwk`` parity with an in-app import in ``test_convert_dwk_parity.py``.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

import quantized.api as qz
from convert_fixtures import loops_opj, undecodable_column_opju
from quantized.cli import main as qz_main
from quantized.cli_convert import convert_command, expand_inputs, unique_prefixes
from quantized.datastruct import DataStruct

# ── the public API ──────────────────────────────────────────────────────────


def test_read_origin_books_returns_every_book_and_sheet(tmp_path: Path) -> None:
    path = loops_opj(tmp_path / "loops.opj")
    books = qz.read_origin_books(path)
    assert [b.metadata["origin_book"] for b in books] == ["Loop1", "Loop1@2", "Scan2"]
    assert all(b.metadata["origin_folder_path"] == [] for b in books)
    # load() keeps one DataStruct per file: the primary (largest) book only.
    assert qz.load(path).metadata["origin_book"] == "Scan2"


def test_save_table_round_trips_names_units_and_values(tmp_path: Path) -> None:
    ds = DataStruct.create([1.0, 2.0], [[3.0], [4.0]], labels=["M"], units=["emu"],
                           metadata={"x_column_long": "T", "xUnit": "K"})  # fmt: skip
    back = qz.load(qz.save_table(ds, tmp_path / "t.csv"))
    np.testing.assert_array_equal(back.time, ds.time)
    np.testing.assert_array_equal(back.values, ds.values)
    assert back.labels == ("M",) and back.units == ("emu",)
    # The X unit is found under any key the repo's one resolver knows (L2).
    assert (tmp_path / "t.csv").read_text(encoding="utf-8").splitlines()[1] == "K,emu"
    with pytest.raises(ValueError, match="one sheet"):
        qz.save_table([("a", ds), ("b", ds)], tmp_path / "two.csv")


# ── conversion ──────────────────────────────────────────────────────────────


def test_csv_writes_one_file_per_sheet_with_deterministic_names(tmp_path: Path) -> None:
    src = loops_opj(tmp_path / "loops.opj")
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
    lines = (tmp_path / "out" / "loops.opj__Loop1.csv").read_text(encoding="utf-8").splitlines()
    assert lines[0].startswith("# quantized-columns: ")  # designations ride along
    assert lines[1:3] == ["Field,Moment,Error", "Oe,emu,emu"]


def test_xlsx_writes_one_workbook_per_book_a_tab_per_sheet(tmp_path: Path) -> None:
    from openpyxl import load_workbook

    src = loops_opj(tmp_path / "loops.opj")
    report = qz.convert_origin_project(src, tmp_path / "out", "xlsx")
    assert report["outputs"] == ["loops.opj__Loop1.xlsx", "loops.opj__Scan2.xlsx"]
    wb = load_workbook(tmp_path / "out" / "loops.opj__Loop1.xlsx")
    assert wb.sheetnames == ["Sheet1", "Sheet2"]
    assert [c.value for c in wb["Sheet2"][4]] == [1, 0, 0]  # roles line, names, units, data


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
    loops_opj(tmp_path / "loops.opj")
    undecodable_column_opju(tmp_path / "bad.opju")
    out = tmp_path / "out"
    code = convert_command([str(tmp_path / "*.opj*"), "--to", "csv", "--out", str(out)])
    assert code == 1  # one file failed
    report = json.loads((out / "convert-report.json").read_text(encoding="utf-8"))
    assert report["summary"] == {"ok": 1, "partial": 0, "failed": 1}
    assert [Path(f["source"]).name for f in report["files"]] == ["bad.opju", "loops.opj"]
    printed = capsys.readouterr().out
    assert "skipped Book1 sheet 1: 1 column(s) not decoded: B" in printed
    assert "1 ok, 0 partial, 1 failed" in printed

    xlsx = tmp_path / "xlsx"
    ok = convert_command([str(tmp_path / "loops.opj"), "--to", "xlsx", "--out", str(xlsx)])
    assert ok == 0


def test_cli_dispatch_and_usage_errors(tmp_path: Path) -> None:
    loops_opj(tmp_path / "loops.opj")
    with pytest.raises(SystemExit) as done:
        qz_main(["convert", str(tmp_path / "loops.opj"), "--to", "dwk", "--out", str(tmp_path)])
    assert done.value.code == 0
    assert (tmp_path / "loops.opj.dwk").is_file()
    assert (
        convert_command([str(tmp_path / "*.nothing"), "--to", "csv", "--out", str(tmp_path / "a")])
        == 2
    )
    gone = [str(tmp_path / "gone.opj"), "--to", "csv", "--out", str(tmp_path / "b")]
    assert convert_command(gone) == 1  # reported as failed


def test_a_bracketed_file_name_is_taken_literally(tmp_path: Path) -> None:
    """``run[1].opj`` names a file; as a glob it would mean ``run1.opj`` (H4)."""
    literal = loops_opj(tmp_path / "run[1].opj")
    decoy = loops_opj(tmp_path / "run1.opj")
    assert expand_inputs([str(literal)]) == ([literal], [])
    assert expand_inputs([str(tmp_path / "run[1].opj"), str(decoy)]) == ([literal, decoy], [])
    code = convert_command([str(literal), "--to", "csv", "--out", str(tmp_path / "o")])
    assert code == 0
    assert (tmp_path / "o" / "run_1_.opj__Scan2.csv").is_file()


def test_an_input_that_matches_nothing_fails_the_run(tmp_path: Path) -> None:
    """Among other inputs it is a failed report entry, never a silent no-op (H4)."""
    good = loops_opj(tmp_path / "good.opj")
    out = tmp_path / "o"
    pattern = str(tmp_path / "missing*.opj")
    assert expand_inputs([pattern, str(good)]) == ([good], [pattern])
    assert convert_command([pattern, str(good), "--to", "csv", "--out", str(out)]) == 1
    report = json.loads((out / "convert-report.json").read_text(encoding="utf-8"))
    assert report["summary"] == {"ok": 1, "partial": 0, "failed": 1}
    assert report["files"][0] == {
        "source": pattern, "status": "failed", "error": "no file matches this input",
        "outputs": [], "omissions": [], "notes": [], "books": [],
    }  # fmt: skip


def test_report_into_a_folder_that_does_not_exist_yet(tmp_path: Path) -> None:
    """The report's folder is made before any work is done (L1)."""
    src = loops_opj(tmp_path / "loops.opj")
    report = tmp_path / "new" / "deeper" / "r.json"
    args = [str(src), "--to", "csv", "--out", str(tmp_path / "o"), "--report", str(report)]
    assert convert_command(args) == 0
    assert json.loads(report.read_text(encoding="utf-8"))["summary"]["ok"] == 1


def test_same_file_name_in_two_folders_never_overwrites(tmp_path: Path) -> None:
    (tmp_path / "a").mkdir()
    (tmp_path / "b").mkdir()
    paths = [loops_opj(tmp_path / "a" / "x.opj"), loops_opj(tmp_path / "b" / "x.opj")]
    assert unique_prefixes(paths) == ["x.opj", "x.opj~2"]
    assert expand_inputs([str(tmp_path / "**" / "*.opj"), str(paths[0])]) == (paths, [])

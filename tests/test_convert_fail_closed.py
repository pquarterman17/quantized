"""``qz convert`` fails closed (gap audit 4 lane E review: H1-H3, M1, M3, M6, L5).

A book that lost data is reported and not written; a loss no recovered book
owns writes NOTHING for the project; ``allow_partial`` writes it all anyway,
reported. ``.opj`` and ``.opju`` are held to the same rule. Projects are the
synthetic ones of ``tests/convert_fixtures.py``; where a reader marker has no
committed byte builder, the reader is monkeypatched to return a book with it.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

import quantized.api as qz
from convert_fixtures import (
    loops_opj,
    loose_dataset_opju,
    matrix_opj,
    multi_x_opj,
    undecodable_column_opju,
)
from quantized.datastruct import DataStruct
from quantized.io.origin_convert_checks import attribute_losses, book_notes, book_problems
from quantized.io.origin_project import read_origin_project_all

# ── per book ────────────────────────────────────────────────────────────────


def _meta(**kw: object) -> DataStruct:
    return DataStruct(time=np.arange(2.0), values=np.zeros((2, 1)), metadata=kw)


def test_book_problems_names_every_fail_closed_marker() -> None:
    assert book_problems(_meta()) == []
    assert book_problems(_meta(origin_columns_lost={"C": "unknown storage"})) == [
        "column C not decoded (unknown storage)"
    ]
    x_lost = _meta(x_column_recovered=False, x_column_unrecovered_reason="X is text")
    assert book_problems(x_lost) == ["X column not recovered: X is text"]
    meta = _meta(
        origin_worksheet_losses={
            "grammar_only": {"count": 2, "columns": ["A", "B"]},
            "checksum_failed": {"count": 1, "columns": ["C"]},
            "some_new_kind": {"count": 1, "columns": []},
        },
        origin_decode="content_sniffing",
    )
    # An unknown loss kind blocks too, and so does the legacy content scan.
    problems = book_problems(meta)
    assert problems[:2] == [
        "1 column(s) failed their checksum (values may be corrupt): C",
        "1 some_new_kind",
    ]
    assert "legacy content scan" in problems[2]
    assert book_notes(meta) == [
        "2 column(s) read from an older Origin format without a length check: A, B"
    ]


def test_a_complex_columns_imaginary_part_is_a_loss() -> None:
    """The ``.opj`` reader keeps it only in metadata; a table drops it (H2)."""
    ds = _meta(origin_complex_imaginary={"B": [1.0, 2.0]})
    assert book_problems(ds) == ["1 complex column(s): imaginary part not exported (B)"]


def test_a_text_only_sheet_is_not_an_unrecovered_x() -> None:
    """A notes / sample-list sheet loses nothing (M1)."""
    notes = DataStruct(
        time=np.array([1.0, 2.0]),
        values=np.zeros((2, 0)),
        metadata={
            "origin_book": "Notes",
            "x_column_recovered": False,
            "origin_text_columns": {"A": ["s1", "s2"]},
        },
    )
    assert book_problems(notes) == []


def test_report_sheets_are_noted() -> None:
    ds = _meta(origin_report_sheets={"A": ["cell://x"], "B": ["cell://y"]})
    assert book_notes(ds) == [
        "2 report-sheet column(s) not exported (unresolved Origin cell references, not data)"
    ]


# ── project-level losses: attributed, or nothing is written ─────────────────


def test_opj_project_diagnostics_are_attributed_to_their_book() -> None:
    """``.opj`` reports cell, sheet and column losses only for the project; each
    goes to the book its dataset name keys (H1)."""
    details = [
        {"category": "cells", "dataset": "Book1_B", "reason": "implausible cells blanked"},
        {"category": "sheet", "dataset": "Book2@2", "reason": "sheet not identified"},
        {"category": "column", "dataset": "Book3_C@2", "reason": "unknown storage"},
        {"category": "notice", "dataset": "MBook1", "reason": "matrix MBook1: no coordinates"},
        {"category": "notice", "dataset": "", "reason": "legacy scan"},
    ]
    first = DataStruct(
        time=np.arange(2.0),
        values=np.zeros((2, 1)),
        metadata={
            "origin_book": "Book1",
            "origin_data_diagnostics": {"omissions": [], "details": details},
        },
    )
    books = [
        first,
        _meta(origin_book="Book2@2"),
        _meta(origin_book="Book3"),  # the sole sheet, filed under the bare name
        _meta(origin_book="MBook1", origin_matrix={"coordinates_recovered": False}),
    ]
    got = attribute_losses(books)
    assert got.unattributed == []
    assert got.by_book == {
        "Book1": ["column B: implausible cells blanked"],
        "Book2@2": ["sheet not identified"],
        "Book3": ["column C not decoded (unknown storage)"],
    }


def test_opj_datasets_no_book_holds_are_unattributed() -> None:
    details = [
        {"category": "matrix", "dataset": "MBook9", "reason": "sheet id 2 could not be matched"},
        {"category": "other", "dataset": "Func1", "reason": "not a worksheet column"},
        {"category": "cells", "dataset": "Gone_A", "reason": "blanked"},
    ]
    first = _meta(origin_book="Book1", origin_data_diagnostics={"details": details})
    assert attribute_losses([first]).unattributed == [
        "MBook9: sheet id 2 could not be matched",
        "Func1: not a worksheet column",
        "Gone_A: blanked",
    ]


def test_an_opj_matrix_without_coordinates_is_skipped_like_opju(tmp_path: Path) -> None:
    """It used to be written with cell-index axes, flagged only at project level (H1)."""
    report = qz.convert_origin_project(
        matrix_opj(tmp_path / "m.opj", coords=False), tmp_path / "o", "csv"
    )
    by_book = {b["book"]: b for b in report["books"]}
    assert by_book["MBook1"]["status"] == "skipped"
    assert by_book["MBook1"]["problems"] == [
        "matrix X/Y coordinates not recovered (axes would be cell indices)"
    ]
    assert by_book["Book1"]["status"] == "written"
    assert report["omissions"] == [] and report["status"] == "partial"
    assert report["outputs"] == ["m.opj__Book1.csv"]


def test_an_opju_loss_no_book_owns_writes_nothing(tmp_path: Path) -> None:
    src = loose_dataset_opju(tmp_path / "loose.opju")
    report = qz.convert_origin_project(src, tmp_path / "o", "csv")
    assert report["status"] == "failed" and report["outputs"] == []
    assert report["omissions"] == ["1 datasets not decoded in no recovered book (e.g. Loose)"]
    assert not (tmp_path / "o").exists()
    partial = qz.convert_origin_project(src, tmp_path / "p", "csv", allow_partial=True)
    assert partial["status"] == "partial" and partial["outputs"] == ["loose.opju__Book1.csv"]


@pytest.mark.parametrize("cut", [1, 10, 200, 800])
def test_a_truncated_project_writes_nothing(tmp_path: Path, cut: int) -> None:
    """The import route's file-length check runs here too (H3)."""
    full = loops_opj(tmp_path / "full.opj").read_bytes()
    src = tmp_path / "cut.opj"
    src.write_bytes(full[:-cut])
    report = qz.convert_origin_project(src, tmp_path / "o", "csv")
    assert report["status"] == "failed", report
    assert report["outputs"] == [] and not (tmp_path / "o").exists()
    if report["omissions"]:  # a cut deep enough can make the read itself fail
        assert report["omissions"][0].startswith("file_truncated: ")


def test_an_undecodable_column_skips_its_book(tmp_path: Path) -> None:
    src = undecodable_column_opju(tmp_path / "bad.opju")
    report = qz.convert_origin_project(src, tmp_path / "out", "csv")
    assert report["status"] == "failed" and report["outputs"] == []
    (book,) = report["books"]
    assert book["status"] == "skipped"
    assert book["problems"] == ["1 column(s) not decoded: B"]
    partial = qz.convert_origin_project(src, tmp_path / "p", "csv", allow_partial=True)
    assert partial["status"] == "partial"
    assert partial["books"][0]["status"] == "partial"
    assert partial["outputs"] == ["bad.opju__Book1.csv"]


def _patched(monkeypatch: pytest.MonkeyPatch, books: list[DataStruct]) -> None:
    monkeypatch.setattr(
        "quantized.io.origin_convert.read_origin_project_all",
        lambda _p, raw=None: (books[0], books),
    )


def test_a_complex_book_is_skipped_unless_partial(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    good = qz.read_origin_books(loops_opj(tmp_path / "l.opj"))[0]
    cplx = DataStruct(
        time=good.time,
        values=good.values,
        labels=good.labels,
        units=good.units,
        metadata={
            **good.metadata,
            "origin_book": "C1",
            "origin_complex_imaginary": {"B": [0.0, 1.0, 2.0, 3.0]},
        },
    )
    _patched(monkeypatch, [good, cplx])
    report = qz.convert_origin_project(tmp_path / "l.opj", tmp_path / "o", "csv")
    assert [b["status"] for b in report["books"]] == ["written", "skipped"]
    assert report["status"] == "partial"


def test_a_book_with_problems_never_leaves_the_project_ok(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Even when it holds nothing to write: its loss is still a loss."""
    good = qz.read_origin_books(loops_opj(tmp_path / "l.opj"))[0]
    lost = DataStruct(
        time=np.array([np.nan]),
        values=np.full((1, 1), np.nan),
        metadata={"origin_book": "Book2", "origin_columns_lost": {"B": "x"}},
    )
    _patched(monkeypatch, [good, lost])
    report = qz.convert_origin_project(
        tmp_path / "l.opj", tmp_path / "o", "csv", allow_partial=True
    )
    assert [b["status"] for b in report["books"]] == ["written", "empty"]
    assert report["status"] == "partial"


def test_a_text_only_sheet_converts_as_its_text(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Written as its text columns, no made-up row-number X (M1)."""
    good = qz.read_origin_books(loops_opj(tmp_path / "l.opj"))[0]
    notes = DataStruct(
        time=np.array([1.0, 2.0]),
        values=np.zeros((2, 0)),
        metadata={
            "origin_book": "Notes",
            "x_column_recovered": False,
            "x_column_name": "Row",
            "origin_text_columns": {"A": ["s1", "s 2"]},
            "origin_text_column_labels": {"A": {"long_name": "Sample", "unit": ""}},
        },
    )
    _patched(monkeypatch, [good, notes])
    report = qz.convert_origin_project(tmp_path / "l.opj", tmp_path / "o", "csv")
    assert report["status"] == "ok"
    text = (tmp_path / "o" / "l.opj__Notes.csv").read_text(encoding="utf-8")
    assert text.splitlines() == ["Sample", "s1", "s 2"]


# ── what the table formats carry ────────────────────────────────────────────


def test_a_matrix_is_written_once_per_axis(tmp_path: Path) -> None:
    """X, Y, Z -- not the X a second time from ``.time`` (M6)."""
    src = matrix_opj(tmp_path / "m.opj", coords=True)
    report = qz.convert_origin_project(src, tmp_path / "o", "csv")
    assert report["status"] == "ok"
    lines = (tmp_path / "o" / "m.opj__MBook1.csv").read_text(encoding="utf-8").splitlines()
    assert lines[:3] == ["X,Y,Z", "10,0.5,1.5", "20,0.5,"]
    assert {b["book"]: b["columns"] for b in report["books"]}["MBook1"] == 3


@pytest.mark.parametrize("fmt", ["csv", "xlsx"])
def test_multi_x_pairing_comments_survive_a_re_import(tmp_path: Path, fmt: str) -> None:
    """X,Y,X,Y with a non-monotonic X: the re-imported table pairs each Y with
    its nearest-preceding X again, and keeps the comment (M3)."""
    src = multi_x_opj(tmp_path / "mx.opj")
    (book,) = qz.read_origin_books(src)
    report = qz.convert_origin_project(src, tmp_path / "o", fmt)
    assert report["status"] == "ok" and report["books"][0]["notes"] == []
    back = qz.load(tmp_path / "o" / report["outputs"][0])
    assert back.labels == ("Y1", "X2", "Y2")
    assert back.time.tolist() == [3.0, 1.0, 2.0]  # row order kept
    for key in ("origin_column_names", "column_designations", "column_comments"):
        assert back.metadata[key] == book.metadata[key], key
    assert back.metadata["column_designations"] == {"A": "X", "B": "Y", "C": "X", "D": "Y"}
    assert "comments" not in back.metadata  # the roles line is machinery, not a file comment


def test_a_roles_line_that_no_longer_fits_is_not_applied(tmp_path: Path) -> None:
    src = multi_x_opj(tmp_path / "mx.opj")
    qz.convert_origin_project(src, tmp_path / "o", "csv")
    path = tmp_path / "o" / "mx.opj__Multi.csv"
    lines = path.read_text(encoding="utf-8").splitlines()
    lines[1] = lines[1].replace("Y2", "Renamed")  # an edited header
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    back = qz.load(path)
    assert "column_designations" not in back.metadata
    assert any("column-roles line" in n for n in back.metadata["notes"])


def test_roles_that_cannot_be_carried_are_noted(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    good = qz.read_origin_books(loops_opj(tmp_path / "l.opj"))[0]
    odd = DataStruct(
        time=good.time,
        values=good.values,
        labels=good.labels,
        units=good.units,
        metadata={**good.metadata, "origin_column_names": ["B"]},
    )  # 1 name, 2 channels
    _patched(monkeypatch, [odd])
    report = qz.convert_origin_project(tmp_path / "l.opj", tmp_path / "o", "csv")
    assert report["books"][0]["notes"] == [
        "column designations, comments or date formats are not carried in the csv file "
        "(they do not line up with its columns, or need a column-roles line longer than "
        "a file cell holds)"
    ]


def test_route_and_convert_read_the_same_books(tmp_path: Path) -> None:
    """Sanity: the converter's reader call is the import route's own."""
    src = loops_opj(tmp_path / "loops.opj")
    primary, books = read_origin_project_all(src)
    assert primary.metadata["origin_book"] == "Scan2" and len(books) == 3


def test_a_project_level_cells_loss_skips_its_book_end_to_end(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The reader files blanked cells only under the project (on the primary);
    the converter must still skip the book they belong to (re-review L7)."""
    books = qz.read_origin_books(loops_opj(tmp_path / "l.opj"))
    details = [{"category": "cells", "dataset": "Loop1_B", "reason": "implausible cells blanked"}]
    first = DataStruct(
        time=books[0].time,
        values=books[0].values,
        labels=books[0].labels,
        units=books[0].units,
        metadata={**books[0].metadata, "origin_data_diagnostics": {"details": details}},
    )
    _patched(monkeypatch, [first, *books[1:]])
    report = qz.convert_origin_project(tmp_path / "l.opj", tmp_path / "o", "csv")
    by_key = {(b["book"], b["sheet"]): b for b in report["books"]}
    assert by_key[("Loop1", 1)]["status"] == "skipped"
    assert by_key[("Loop1", 1)]["problems"] == ["column B: implausible cells blanked"]
    assert by_key[("Scan2", 1)]["status"] == "written"
    assert report["omissions"] == [] and report["status"] == "partial"
    assert "l.opj__Loop1.csv" not in report["outputs"]


def test_dwk_leaves_out_an_x_only_book_as_the_app_does(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The route's Library drops a book with only an X column; so does the
    .dwk, keeping the app's names and single-file branch (re-review L5)."""
    good = qz.read_origin_books(loops_opj(tmp_path / "l.opj"))[0]
    x_only = DataStruct(
        time=np.array([1.0, 2.0]),
        values=np.zeros((2, 0)),
        metadata={"origin_book": "Book2"},
    )
    _patched(monkeypatch, [good, x_only])
    report = qz.convert_origin_project(tmp_path / "l.opj", tmp_path / "o", "dwk")
    assert [b["status"] for b in report["books"]] == ["written", "empty"]
    doc = json.loads((tmp_path / "o" / "l.opj.dwk").read_text(encoding="utf-8"))
    assert [d["name"] for d in doc["datasets"]] == ["l.opj"]  # the app's single-file name
    csv = qz.convert_origin_project(tmp_path / "l.opj", tmp_path / "c", "csv")
    assert [b["status"] for b in csv["books"]] == ["written", "written"]  # a table keeps it

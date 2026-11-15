"""The column-roles line (``io/_column_marker.py``) at its edges (gap audit 4
lane E re-review: M3, L1-L4). It must never be truncated, split, crash an
import, eat a header cell, or appear in a headerless table."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

import quantized.api as qz
from convert_fixtures import multi_x_opj
from quantized.datastruct import DataStruct
from quantized.io._column_marker import MARKER, MAX_LINE, column_marker, find_marker


def _book(n: int, comment: str = "") -> DataStruct:
    """An X,Y,X,Y,... Origin book of ``2n`` value channels."""
    letters = [f"C{i}" for i in range(2 * n)]
    desig = {"A": "X", **{c: ("X" if i % 2 else "Y") for i, c in enumerate(letters)}}
    return DataStruct.create(
        [1.0, 2.0],
        np.ones((2, 2 * n)),
        labels=[f"ch{i}" for i in range(2 * n)],
        units=[""] * (2 * n),
        metadata={
            "origin_column_names": letters,
            "column_designations": desig,
            "column_comments": {c: comment for c in letters} if comment else {},
        },
    )


def test_a_line_too_long_for_one_cell_is_not_written_and_is_reported(tmp_path: Path) -> None:
    """Excel keeps 32,767 characters of a cell: the line is never cut (M3)."""
    wide = _book(60, comment="x" * 400)
    assert column_marker(wide) is None
    assert column_marker(_book(3)) is not None
    report_book = _book(60, comment="x" * 400)
    path = qz.save_table(report_book, tmp_path / "w.xlsx")
    back = qz.load(path)
    assert "column_designations" not in back.metadata  # nothing half-restored


def test_a_wide_book_is_reported_as_not_carried(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    wide = _book(60, comment="x" * 400)
    wide = DataStruct(
        time=wide.time, values=wide.values, labels=wide.labels, units=wide.units,
        metadata={**wide.metadata, "origin_book": "Wide"},
    )  # fmt: skip
    monkeypatch.setattr(
        "quantized.io.origin_convert.read_origin_project_all", lambda _p, raw=None: (wide, [wide])
    )
    src = multi_x_opj(tmp_path / "w.opj")
    report = qz.convert_origin_project(src, tmp_path / "o", "xlsx")
    assert any("not carried" in n for n in report["books"][0]["notes"])


@pytest.mark.parametrize("sep", [" ", " ", "\x85", "\x0b", "\x1c"])
def test_line_separators_inside_a_comment_cannot_split_the_line(tmp_path: Path, sep: str) -> None:
    """``str.splitlines`` breaks on these; the line escapes them (L2)."""
    ds = _book(1)
    ds = DataStruct(
        time=ds.time, values=ds.values, labels=ds.labels, units=ds.units,
        metadata={**ds.metadata, "column_comments": {"C0": f"line1{sep}line2"}},
    )  # fmt: skip
    line = column_marker(ds)
    assert line is not None and line.isascii() and len(line.splitlines()) == 1
    back = qz.load(qz.save_table(ds, tmp_path / "s.csv"))
    assert back.metadata["column_comments"] == {"C0": f"line1{sep}line2"}
    assert back.metadata["column_designations"] == ds.metadata["column_designations"]


@pytest.mark.parametrize(
    "body",
    [
        "[" * 200_000 + "]" * 200_000,  # RecursionError in json.loads
        '{"labels": ' + "[" * 50 + "]" * 50 + "}",  # nested past the limit
        "x" * (MAX_LINE + 10),  # over the size cap
        "{not json",
        "[1, 2]",
    ],
)
def test_a_crafted_line_gives_a_note_never_an_error(tmp_path: Path, body: str) -> None:
    """In a CSV and in xlsx A1 alike (L1)."""
    csv = tmp_path / "c.csv"
    csv.write_text(f"{MARKER}{body}\nx,y\n1,2\n3,4\n", encoding="utf-8")
    for path in (csv, _xlsx(tmp_path / "c.xlsx", [[MARKER + body], ["x", "y"], [1, 2], [3, 4]])):
        back = qz.load(path)
        assert back.labels == ("y",)
        assert "column_designations" not in back.metadata
        assert any("column-roles line" in n for n in back.metadata["notes"])


def test_find_marker_ignores_ordinary_comments() -> None:
    assert find_marker(["# measured at 300 K", "# quantized-columnsX: {}"]) is None


def _xlsx(path: Path, rows: list[list[object]]) -> Path:
    from openpyxl import Workbook

    wb = Workbook()
    for row in rows:
        wb.active.append(row)
    wb.save(path)
    return path


def test_a_marker_look_alike_beside_header_cells_keeps_the_row(tmp_path: Path) -> None:
    """Only a row holding nothing but the line is the line's row (L3)."""
    path = _xlsx(
        tmp_path / "h.xlsx",
        [
            [f'{MARKER}{{"labels":["a"]}}', "Temperature", "Moment"],
            ["", "K", "emu"],
            [0, 1, 2],
            [1, 3, 4],
        ],
    )
    back = qz.load(path)
    assert back.labels == ("Temperature", "Moment")
    assert not any("column-roles line" in n for n in back.metadata.get("notes", []))


@pytest.mark.parametrize("suffix", [".csv", ".xlsx"])
def test_a_headerless_table_has_no_roles_line(tmp_path: Path, suffix: str) -> None:
    """``header=False`` means numbers only (L4)."""
    path = qz.save_table(_book(1), tmp_path / f"h{suffix}", header=False)
    if suffix == ".csv":
        first = path.read_text(encoding="utf-8").splitlines()[0]
    else:
        from openpyxl import load_workbook

        first = str(load_workbook(path).active["A1"].value)
    assert not first.startswith("#")
    assert first.startswith("1")

"""A date column with blank cells is still a date column (acceptance pass 3).

The share of parseable dates used to be counted over ALL rows, so a date
column more than a fifth blank imported as text. Both import paths (direct
`import_csv` and the Import Wizard's `parse_import`) now read a column whose
non-blank cells ALL parse as dates, blanks as missing (NaN). Anything else
stays as it was: a column with any other text, a bare number, or nothing but
blanks. No new string counts as a date. Synthetic fixtures only.
"""

from __future__ import annotations

import calendar
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pytest

from quantized.datastruct import DataStruct
from quantized.io._date_column import date_column_epochs
from quantized.io.datastruct_table import sheet_from_datastruct, write_table
from quantized.io.delimited import import_csv
from quantized.io.import_preview import guess_settings, parse_import
from quantized.io.table_export import format_delimited


def _epoch(d: int, h: int = 0, m: int = 0) -> float:
    return datetime(2026, 11, d, h, m, tzinfo=UTC).timestamp()


_LAYOUTS = {  # every layout `_date_formats` + ISO accept
    "iso-date": "2026-11-{d:02d}",
    "iso-datetime": "2026-11-{d:02d} 10:30:00",
    "iso-T-Z": "2026-11-{d:02d}T10:30:00Z",
    "us-slash": "11/{d:02d}/2026 10:30:00",
    "us-slash-minute": "11/{d:02d}/2026 10:30",
    "us-slash-date": "11/{d:02d}/2026",
    "dotted": "{d:02d}.11.2026 10:30:00",
    "dotted-minute": "{d:02d}.11.2026 10:30",
    "dotted-date": "{d:02d}.11.2026",
    "year-slash": "2026/11/{d:02d} 10:30:00",
    "year-slash-minute": "2026/11/{d:02d} 10:30",
    "year-slash-date": "2026/11/{d:02d}",
}
_DAYS = (13, 14, 15)  # all > 12, so the US and European slash orders cannot swap

# Where the blanks sit, over 6 rows: the indices of the blank rows.
_BLANKS = {"start": (0, 1), "middle": (2, 3), "end": (4, 5)}


def _rows(date_cells: list[str]) -> str:
    return "Date;Temp (C)\n" + "".join(f"{c};{20 + i}\n" for i, c in enumerate(date_cells))


def _cells(layout: str, where: str, blank: str = "") -> list[str]:
    days = iter(_DAYS * 2)
    return [
        blank if i in _BLANKS[where] else _LAYOUTS[layout].format(d=next(days)) for i in range(6)
    ]


def _expected(cells: list[str], layout: str) -> np.ndarray:
    """Epochs from the rule's own parser on the three dates, blanks as NaN."""
    ref = date_column_epochs([_LAYOUTS[layout].format(d=d) for d in _DAYS])
    assert ref is not None
    it = iter(ref.tolist() * 2)
    return np.asarray([np.nan if not c.strip() else next(it) for c in cells])


def _write(tmp_path: Path, text: str) -> Path:
    path = tmp_path / "log.csv"
    path.write_text(text, encoding="utf-8")
    return path


def _both(tmp_path: Path, text: str) -> dict[str, DataStruct]:
    return {
        "direct": import_csv(_write(tmp_path, text)),
        "wizard": parse_import(text, guess_settings(text)),
    }


@pytest.mark.parametrize("layout", list(_LAYOUTS))
@pytest.mark.parametrize("where", list(_BLANKS))
def test_every_format_with_blanks_at_start_middle_and_end(
    tmp_path: Path, layout: str, where: str
) -> None:
    cells = _cells(layout, where)
    for path, ds in _both(tmp_path, _rows(cells)).items():
        assert ds.metadata["time_is_datetime"] is True, (path, layout, where)
        assert not ds.cat_levels, (path, "the date axis became a text channel")
        np.testing.assert_allclose(ds.time, _expected(cells, layout), err_msg=path)
        assert ds.labels == ("Temp",)
        np.testing.assert_allclose(ds.values[:, 0], np.arange(6) + 20.0)


def test_the_epochs_are_the_real_instants() -> None:
    # Independent of the rule's parser: calendar.timegm is plain arithmetic.
    got = date_column_epochs(["", "2026-11-14 10:30:00", ""])
    assert got is not None and got[1] == pytest.approx(calendar.timegm((2026, 11, 14, 10, 30, 0)))
    assert got[1] == pytest.approx(_epoch(14, 10, 30))


@pytest.mark.parametrize("blank", ["", "   ", " \t "])
def test_whitespace_only_cells_are_blanks(tmp_path: Path, blank: str) -> None:
    cells = _cells("iso-datetime", "middle", blank=blank)
    for path, ds in _both(tmp_path, _rows(cells)).items():
        assert ds.metadata["time_is_datetime"] is True, path
        assert int(np.isnan(ds.time).sum()) == 2, path


def test_datetime_with_blanks_keeps_the_time_of_day(tmp_path: Path) -> None:
    text = _rows(
        ["2026-11-14 10:30:15", "", "2026-11-14 11:45:00", "  ", "2026-11-15 00:00:01", ""]
    )
    want = [_epoch(14, 10, 30) + 15, np.nan, _epoch(14, 11, 45), np.nan, _epoch(15) + 1, np.nan]
    for path, ds in _both(tmp_path, text).items():
        assert ds.metadata["time_is_datetime"] is True, path
        np.testing.assert_allclose(ds.time, want, err_msg=path)


def test_one_stray_word_keeps_the_column_text(tmp_path: Path) -> None:
    # 3 dates, 2 blanks, 1 stray word: under the 80% share AND not wholly dates.
    cells = ["2026-11-13", "", "pending", "2026-11-14", "", "2026-11-15"]
    for path, ds in _both(tmp_path, _rows(cells)).items():
        assert "time_is_datetime" not in ds.metadata, path


def test_a_bare_number_among_dates_and_blanks_keeps_the_column_text(tmp_path: Path) -> None:
    cells = ["2026-11-13", "", "", "7", "2026-11-14", ""]
    for path, ds in _both(tmp_path, _rows(cells)).items():
        assert "time_is_datetime" not in ds.metadata, path


def test_sparse_eight_digit_integers_are_not_iso_basic_dates(tmp_path: Path) -> None:
    # `fromisoformat("20261114")` parses; a number must never become a date.
    cells = ["20261114", *[""] * 11]
    text = "Run;Temp (C);Pressure (Pa)\n" + "".join(
        f"{c};{i};{2 * i + 1}\n" for i, c in enumerate(cells)
    )
    for path, ds in _both(tmp_path, text).items():
        assert "time_is_datetime" not in ds.metadata, path


def test_the_rule_reads_no_new_date_layout() -> None:
    for text in ("14-11-2026", "Nov 14 2026", "14/11/26", "2026-13-45", "yesterday", "10:30:00"):
        assert date_column_epochs([text, "", "", "2026-11-14"]) is None, text


def test_an_all_blank_column_is_not_a_date_column() -> None:
    assert date_column_epochs(["", "  ", None, ""]) is None


def test_the_long_standing_eighty_percent_tolerance_is_unchanged() -> None:
    cells = [f"2026-11-{d:02d}" for d in range(1, 10)] + ["n/a"]
    out = date_column_epochs(cells)
    assert out is not None and int(np.isnan(out).sum()) == 1


def test_a_numeric_column_with_blanks_is_still_numeric(tmp_path: Path) -> None:
    for path, ds in _both(tmp_path, "T;R\n1;2\n;3\n3;4\n").items():
        assert "time_is_datetime" not in ds.metadata, path


def test_blank_date_cells_survive_save_and_reopen(tmp_path: Path) -> None:
    first = import_csv(_write(tmp_path, _rows(_cells("iso-datetime", "middle"))))
    out = write_table([("log", first)], tmp_path / "saved.csv")
    again = import_csv(out)
    assert again.metadata["time_is_datetime"] is True
    np.testing.assert_allclose(again.time, first.time)
    np.testing.assert_allclose(again.values, first.values)


def test_the_export_sheet_writes_a_missing_date_as_an_empty_cell(tmp_path: Path) -> None:
    ds = import_csv(_write(tmp_path, _rows(_cells("iso-date", "start"))))
    sheet = sheet_from_datastruct(ds, "log")
    assert sheet.columns[0].kind == "datetime"
    first_cells = [ln.split(",")[0] for ln in format_delimited(sheet).splitlines()]
    assert first_cells[-6:] == [
        "", "", *(f"2026-11-{d} 00:00:00" for d in (13, 14, 15, 13)),
    ]

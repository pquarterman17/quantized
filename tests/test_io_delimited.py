"""Generic CSV parser: golden parity vs MATLAB + behaviour."""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path

import pytest

from quantized.io import import_auto
from quantized.io.delimited import import_csv


@pytest.mark.golden
def test_csv_matches_matlab(
    fixtures_dir: Path,
    assert_golden: Callable[..., None],
) -> None:
    ds = import_csv(fixtures_dir / "csv_xrd.csv")
    assert_golden(ds, "csv_xrd_default.json")


def test_csv_structure(fixtures_dir: Path) -> None:
    ds = import_csv(fixtures_dir / "csv_xrd.csv")
    # comments stripped; header detected; first col = x, second = value
    assert ds.labels == ("Intensity",)
    assert ds.units == ("cps",)
    assert ds.metadata["x_column_name"] == "2-Theta"
    assert ds.metadata["x_column_unit"] == "deg"
    assert ds.metadata["delimiter"] == ","
    assert ds.n_points == 6474


def test_registry_routes_csv(fixtures_dir: Path) -> None:
    ds = import_auto(fixtures_dir / "csv_xrd.csv")
    assert ds.metadata["parser_name"] == "import_csv"


def test_csv_iso_datetime_x_is_converted_to_epoch_seconds(tmp_path: Path) -> None:
    path = tmp_path / "dated.csv"
    path.write_text(
        "Timestamp,Signal\n2026-07-19T12:00:00Z,1\n2026-07-19T12:01:00Z,2\n",
        encoding="utf-8",
    )
    ds = import_csv(path)
    expected = datetime(2026, 7, 19, 12, 0, tzinfo=UTC).timestamp()
    assert ds.time.tolist() == [expected, expected + 60]
    assert ds.metadata["time_is_datetime"] is True
    assert ds.metadata["time_timezone"] == "UTC"


# --- MAIN_PLAN #33: preserve text columns + comments on generic imports -----


def _write(tmp_path: Path, name: str, text: str) -> Path:
    p = tmp_path / name
    p.write_text(text, encoding="utf-8")
    return p


def test_csv_keeps_a_text_column_as_metadata(tmp_path: Path) -> None:
    """A sample-id column used to be dropped, so generic imports could not
    drive legends or grouping the way Origin/SQLite imports could."""
    path = _write(
        tmp_path,
        "run.csv",
        "Temp,Moment,Sample\n10,1.5,NbAu-1\n20,2.5,NbAu-1\n30,3.5,NbAu-2\n",
    )
    ds = import_csv(path)
    assert ds.metadata["text_columns"] == {"Sample": ["NbAu-1", "NbAu-1", "NbAu-2"]}
    # …and it did NOT become a bogus all-NaN numeric channel.
    assert list(ds.labels) == ["Moment"]


def test_csv_keeps_multiple_text_columns(tmp_path: Path) -> None:
    path = _write(
        tmp_path,
        "run.csv",
        "T,M,Sample,Operator\n1,10,A,pq\n2,20,B,pq\n",
    )
    ds = import_csv(path)
    assert set(ds.metadata["text_columns"]) == {"Sample", "Operator"}


def test_csv_ignores_an_entirely_blank_column(tmp_path: Path) -> None:
    """A trailing empty column is delimiter padding, not categorical data."""
    path = _write(tmp_path, "run.csv", "T,M,\n1,10,\n2,20,\n")
    ds = import_csv(path)
    assert "text_columns" not in ds.metadata


def test_csv_without_text_columns_omits_the_key(tmp_path: Path) -> None:
    path = _write(tmp_path, "run.csv", "T,M\n1,10\n2,20\n")
    ds = import_csv(path)
    assert "text_columns" not in ds.metadata


def test_csv_preserves_comment_preamble(tmp_path: Path) -> None:
    """Instrument preamble carries sample/temperature/operator context that
    makes the file interpretable later; it used to be dropped on the floor."""
    path = _write(
        tmp_path,
        "run.csv",
        "# Sample: NbAu bilayer\n# Operator: pq\nT,M\n1,10\n2,20\n",
    )
    ds = import_csv(path)
    assert ds.metadata["comments"] == ["# Sample: NbAu bilayer", "# Operator: pq"]
    assert ds.n_points == 2  # comments did not become data rows


def test_csv_without_comments_omits_the_key(tmp_path: Path) -> None:
    path = _write(tmp_path, "run.csv", "T,M\n1,10\n2,20\n")
    ds = import_csv(path)
    assert "comments" not in ds.metadata


def test_csv_text_column_rows_align_with_data_rows(tmp_path: Path) -> None:
    """Row alignment is the whole point — a text column is only usable for
    grouping if entry i corresponds to data row i."""
    path = _write(tmp_path, "run.csv", "T,M,Tag\n1,10,a\n2,20,b\n3,30,c\n")
    ds = import_csv(path)
    assert ds.metadata["text_columns"]["Tag"] == ["a", "b", "c"]
    assert len(ds.metadata["text_columns"]["Tag"]) == ds.n_points


def test_csv_sparse_column_is_preserved_rather_than_dropped(tmp_path: Path) -> None:
    """A column too sparse to qualify as a numeric channel is kept as text.

    Before #33 it was discarded outright and its contents were simply lost.
    Keeping the raw cells is strictly better: nothing is invented, nothing
    disappears, and the worksheet can still show it. Cells stay verbatim,
    blanks included, so the caller can judge for itself.
    """
    rows = "\n".join(f"{i},{i * 10}," + ("5" if i == 1 else "") for i in range(1, 21))
    path = _write(tmp_path, "run.csv", f"T,M,Sparse\n{rows}\n")
    ds = import_csv(path)
    sparse = ds.metadata["text_columns"]["Sparse"]
    assert sparse[0] == "5"
    assert sparse[1:] == [""] * 19


def test_csv_header_detected_with_equal_text_and_numeric_columns(tmp_path: Path) -> None:
    """Regression for the bug #33 surfaced: the primary layout rule needs a
    strict numeric MAJORITY, so 2 numeric + 2 text columns scored exactly 0.5,
    matched no row, and the HEADER was parsed as data."""
    path = _write(tmp_path, "run.csv", "T,M,Sample,Operator\n1,10,A,pq\n2,20,B,pq\n")
    ds = import_csv(path)
    assert list(ds.labels) == ["M"]
    assert set(ds.metadata["text_columns"]) == {"Sample", "Operator"}
    assert ds.n_points == 2  # the header row did not become a data row


# --- MAIN_PLAN #33: multiple selectable label rows --------------------------


_MULTI_HEADER = (
    "Temp,M1,M2,M3\n"
    "(K),(emu),(emu),(emu)\n"
    ",NbAu-1,NbAu-2,NbAu-3\n"
    ",10 Oe,50 Oe,100 Oe\n"
    "1,10,11,12\n"
    "2,20,21,22\n"
)


def test_csv_preserves_every_label_row(tmp_path: Path) -> None:
    """Layout detection consumes ONE row as the header and one as units; the
    rest used to be dropped, and which row won was an accident of position.
    A 4-row header left the caller with no way back to the sample ids."""
    ds = import_csv(_write(tmp_path, "multi.csv", _MULTI_HEADER))
    rows = ds.metadata["label_rows"]
    assert [r["cells"] for r in rows] == [
        ["M1", "M2", "M3"],
        ["(emu)", "(emu)", "(emu)"],
        ["NbAu-1", "NbAu-2", "NbAu-3"],
        ["10 Oe", "50 Oe", "100 Oe"],
    ]


def test_label_row_cells_align_with_channels_not_raw_columns(tmp_path: Path) -> None:
    """A consumer indexes a row BY CHANNEL, so the x column must already be
    split out — otherwise every caller redoes the column->channel mapping."""
    ds = import_csv(_write(tmp_path, "multi.csv", _MULTI_HEADER))
    for row in ds.metadata["label_rows"]:
        assert len(row["cells"]) == len(ds.labels)
    assert ds.metadata["label_rows"][0]["x"] == "Temp"


def test_label_rows_mark_the_rows_layout_detection_consumed(tmp_path: Path) -> None:
    ds = import_csv(_write(tmp_path, "multi.csv", _MULTI_HEADER))
    roles = [r["role"] for r in ds.metadata["label_rows"]]
    assert "header" in roles  # the row that became `labels`
    assert roles.count("header") == 1


def test_label_rows_absent_for_an_ordinary_single_header_file(tmp_path: Path) -> None:
    """No choice exists, so recording one would be metadata bloat."""
    ds = import_csv(_write(tmp_path, "plain.csv", "T,M\n1,10\n2,20\n"))
    assert "label_rows" not in ds.metadata


def test_label_rows_skip_a_blank_separator_row(tmp_path: Path) -> None:
    ds = import_csv(_write(tmp_path, "gap.csv", "T,M\n,\n(K),(emu)\n1,10\n2,20\n"))
    assert all(any(r["cells"]) or r["x"] for r in ds.metadata["label_rows"])


def test_label_rows_pad_a_short_row_to_the_channel_count(tmp_path: Path) -> None:
    """A ragged descriptive row must not misalign the ones after it."""
    ds = import_csv(_write(tmp_path, "ragged.csv", "T,M1,M2\n(K)\n,a,b\n1,10,11\n2,20,21\n"))
    for row in ds.metadata["label_rows"]:
        assert len(row["cells"]) == len(ds.labels)


def test_label_rows_do_not_become_data(tmp_path: Path) -> None:
    ds = import_csv(_write(tmp_path, "multi.csv", _MULTI_HEADER))
    assert ds.n_points == 2

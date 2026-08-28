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


# --- P1.4 (PRIMARY_SOFTWARE_AUDIT_PLAN): categorical import capture --------
# f1/f2 are the two failure modes measured while building the
# grouped-factors baseline fixture (P1.4's "Current evidence"):
#   f1 -- a CSV whose FIRST column is text imported with a silent all-NaN
#         positional time axis.
#   f2 -- a numeric-first CSV with trailing text-only columns raised
#         `ValueError: no valid data columns`.
# Both are red against pre-P1.4 `import_csv` (verified by hand before this
# fix landed: f1's `ds.time` was `[nan, nan, nan]`; f2 raised exactly that
# ValueError) -- these tests pin the FIXED contract.


def test_f1_leading_text_column_no_longer_yields_a_nan_time_axis(tmp_path: Path) -> None:
    path = _write(tmp_path, "leadtext.csv", "Sample,Moment\nNbAu-1,1.5\nNbAu-2,2.5\nNbAu-1,3.5\n")
    ds = import_csv(path)
    # time falls back to a 1..N row index -- no NaN, no ValueError.
    assert ds.time.tolist() == [1.0, 2.0, 3.0]
    assert ds.metadata["x_column_name"] == "Sample Index"
    # the text column is not lost: it becomes a categorical channel...
    assert list(ds.labels) == ["Moment", "Sample"]
    assert ds.cat_levels == {1: ("NbAu-1", "NbAu-2")}
    assert ds.column("Sample").tolist() == [0.0, 1.0, 0.0]
    # ...not duplicated into the text_columns sidecar.
    assert "text_columns" not in ds.metadata
    assert any("Sample" in note for note in ds.metadata["notes"])


def test_f2_trailing_text_only_columns_no_longer_raise(tmp_path: Path) -> None:
    path = _write(tmp_path, "trailtext.csv", "Time,Tag\n1,A\n2,B\n3,A\n")
    ds = import_csv(path)  # used to raise ValueError: no valid data columns
    assert ds.time.tolist() == [1.0, 2.0, 3.0]  # Time still resolves as x normally
    assert list(ds.labels) == ["Tag"]
    assert ds.cat_levels == {0: ("A", "B")}
    assert ds.column("Tag").tolist() == [0.0, 1.0, 0.0]


def test_f2_numeric_and_categorical_columns_both_present(tmp_path: Path) -> None:
    """Categorical channels append AFTER numeric ones when both exist among
    the text-only fallback candidates."""
    path = _write(
        tmp_path, "mixed.csv", "Time,Lot,Wafer\n1,L1,W1\n2,L1,W2\n3,L2,W1\n"
    )
    ds = import_csv(path)
    assert list(ds.labels) == ["Lot", "Wafer"]
    assert ds.cat_levels == {0: ("L1", "L2"), 1: ("W1", "W2")}


def test_existing_text_column_alongside_real_data_stays_sidecar_only(tmp_path: Path) -> None:
    """When there IS a genuine numeric data column, the f2 fallback must not
    fire -- a text column stays a `text_columns` sidecar exactly as before
    (this is the pre-existing, still-passing behaviour P1.4 must not touch)."""
    path = _write(
        tmp_path, "run.csv", "Temp,Moment,Sample\n10,1.5,NbAu-1\n20,2.5,NbAu-1\n30,3.5,NbAu-2\n"
    )
    ds = import_csv(path)
    assert list(ds.labels) == ["Moment"]
    assert ds.cat_levels is None
    assert ds.metadata["text_columns"] == {"Sample": ["NbAu-1", "NbAu-1", "NbAu-2"]}


def test_categorical_missing_cell_encodes_as_nan_not_a_level(tmp_path: Path) -> None:
    path = _write(tmp_path, "blank.csv", "Time,Tag\n1,A\n2,\n3,A\n")
    ds = import_csv(path)
    assert ds.cat_levels == {0: ("A",)}
    codes = ds.column("Tag").tolist()
    assert codes[0] == 0.0 and codes[2] == 0.0
    assert codes[1] != codes[1]  # NaN


def test_categorical_round_trip_through_dict(tmp_path: Path) -> None:
    """strings -> import -> DataStruct -> to_dict/from_dict -> same levels,
    same order, same codes (the Day-1 round-trip gate, delimited half)."""
    from quantized.datastruct import DataStruct

    path = _write(tmp_path, "leadtext.csv", "Sample,Moment\nNbAu-1,1.5\nNbAu-2,2.5\nNbAu-1,3.5\n")
    ds = import_csv(path)
    back = DataStruct.from_dict(ds.to_dict())
    assert back.cat_levels == ds.cat_levels
    assert back.labels == ds.labels
    assert back.column("Sample").tolist() == ds.column("Sample").tolist()


# --------------------------------------------------------------------------
# D5 (2026-08-27 bug hunt): a leading partially-blank row must not be eaten
# --------------------------------------------------------------------------
# `_detect_layout` scored a row's "data-ness" as numeric-cells/TOTAL-cells
# with a strict `> 0.5` majority. A 2-column row like "0.05,nan" scored
# exactly 0.5 -- not a majority, so the detector walked past it (the row
# was silently lost), AND the `scores[first_data - 1] < 0.5` header check
# then failed too (0.5 is not < 0.5), so header_row came back -1 and every
# column label degraded to ColN. This is a faithful port of
# ../quantized_matlab/+parser/importCSV.m:401 detectLayout's identical
# rule (str2double("nan") is NaN -> counted non-numeric there too), i.e. a
# latent behavioural-reference bug -- fixed here by counting a NaN/Inf
# spelling as numeric (see `_delimited_layout._numeric_score`), not by
# relaxing the `> 0.5` majority rule itself.
#
# NARROWER than the original proposed design: excluding a truly EMPTY cell
# from the denominator too (so "0.05," -- no "nan" string, just a bare
# blank -- would also score 1.0 instead of 0.5) was tried and reverted: it
# regressed `test_categorical_missing_cell_encodes_as_nan_not_a_level`
# below, a pre-existing, legitimate case where a genuinely categorical
# column's one blank row ("Time,Tag" / "1,A" / "2," / "3,A") got inflated
# to a false 1.0 "data" score purely from having a single leftover cell,
# with no column-type context to justify it -- eating both the header and
# the first real data row. The narrower fix (NaN-spelling only) still
# resolves the concretely-proven bug below, because the app's own writers
# emit the literal string "nan" for a missing numeric cell, never a truly
# empty one (verified via the actual /api/export/xrd-csv output in
# `test_export_then_reimport_round_trip_preserves_rows`).
_LEADING_BLANK_CSV = "Depth (um),Intensity (counts)\n0.05,nan\n0.86,20\n1.67,30\n2.49,40\n"


def test_csv_leading_partially_blank_row_is_not_eaten(tmp_path: Path) -> None:
    path = _write(tmp_path, "leading_blank.csv", _LEADING_BLANK_CSV)
    ds = import_csv(path)
    assert ds.n_points == 4
    assert ds.time[0] == pytest.approx(0.05)
    assert ds.time.tolist() == pytest.approx([0.05, 0.86, 1.67, 2.49])


def test_csv_leading_partially_blank_row_keeps_header(tmp_path: Path) -> None:
    path = _write(tmp_path, "leading_blank.csv", _LEADING_BLANK_CSV)
    ds = import_csv(path)
    assert ds.labels == ("Intensity",)
    assert ds.metadata["x_column_name"] == "Depth"


def test_csv_leading_blank_cell_row_scores_as_data_not_half(tmp_path: Path) -> None:
    """Unit-level pin on the actual boundary value: a 2-column row with one
    cell spelled "nan" used to score exactly 0.5 (a tie with the strict
    majority rule); it must now score 1.0 (both cells count as numeric),
    while a header/units row -- whose cells are all non-empty text --
    still scores 0.0. A truly EMPTY cell (no "nan" string) deliberately
    still scores 0.5, unchanged -- see the module docstring above for why
    that narrower boundary was kept."""
    from quantized.io import _delimited_layout as layout

    assert layout._numeric_score(["0.05", "nan"]) == 1.0
    assert layout._numeric_score(["0.05", ""]) == 0.5
    assert layout._numeric_score(["Depth (um)", "Intensity (counts)"]) == 0.0


# --------------------------------------------------------------------------
# D6 (2026-08-27 bug hunt): an all-blank x column must not raise an internal
# invariant error
# --------------------------------------------------------------------------
# Column 0 is entirely blank (a leading delimiter -- exactly what Origin's
# "export worksheet to CSV" emits when the first worksheet column is empty).
# time_idx defaults to 0; the column is neither numeric nor a datetime, so
# `time_promoted` fires and used to force-add it to `categorical_idx`
# WITHOUT the `any(cells)` guard the sibling f2 promotion branch (and the
# `text_columns` sidecar loop) already apply -- encoding to a categorical
# channel with ZERO levels, which DataStruct.create then rejected with an
# internal invariant message ("cat_levels[1] must be a non-empty tuple of
# str, got ()"), making an otherwise perfectly good 2-numeric-channel file
# unimportable. Quantized-only code; no MATLAB counterpart.
#
# Design decision: an all-blank x column is DROPPED (not promoted, not kept
# as an all-NaN numeric channel) -- consistent with how every OTHER
# all-blank column in this file is handled (the f2 branch's `any(cells)`
# guard, and the `text_columns` sidecar's own `if any(cells)` guard both
# silently drop a blank column as padding). Time already falls back to the
# synthetic 1..N row index via the pre-existing `time_promoted` path.
_BLANK_X_CSV = ",Kerr Signal,H\n,(mdeg),Oe\n,1.5,-7046.7\n,1.6,-6869.3\n,1.7,-6680.5\n"


def test_blank_x_column_does_not_raise_cat_levels_error(tmp_path: Path) -> None:
    path = _write(tmp_path, "blank_x.csv", _BLANK_X_CSV)
    ds = import_csv(path)
    assert ds.n_channels == 2
    assert list(ds.labels) == ["Kerr Signal", "H"]
    assert ds.cat_levels is None  # the blank column was dropped, not promoted
    assert ds.time.tolist() == [1.0, 2.0, 3.0]  # fell back to the 1..N row index
    assert any("blank" in note.lower() for note in ds.metadata.get("notes", []))


@pytest.mark.realdata
@pytest.mark.parametrize(
    "rel",
    [
        "origin/probes/verify/PJ2_realmiddle.opj.Book2.csv",
        "origin/probes/verify/PK1_g1.opj.Book2.csv",
        "origin/probes/verify/PK5_all4.opj.Book2.csv",
        "origin/probes/verify/PU5_writerprops.opj.Book2.csv",
    ],
)
def test_realdata_origin_csv_with_blank_x_column_imports(rel: str, corpus_dir: Path) -> None:
    """Corpus anchor: 4 real Origin CSV exports in ../test-data (leading-
    comma worksheets) failed to import with the same internal cat_levels
    error before this fix. `test_parsers_matrix.py` deliberately excludes
    `origin/probes/` (those files are otherwise-corrupt RE probes), so this
    is the dedicated anchor for the one real defect among them."""
    p = corpus_dir / rel
    if not p.is_file():
        pytest.skip(f"{rel} absent from the corpus")
    ds = import_auto(p)
    assert ds.n_channels > 0


def test_export_then_reimport_round_trip_preserves_rows(tmp_path: Path) -> None:
    """End-to-end proof through the app's own public API: export a dataset
    whose first intensity is NaN via /api/export/xrd-csv, then re-import the
    file the app just wrote -- the app must be able to round-trip its own
    export."""
    from fastapi.testclient import TestClient

    from quantized.app import app

    client = TestClient(app)
    ds_in = {
        "time": [0.05, 0.86, 1.67, 2.49, 3.30],
        "values": [[None], [20.0], [30.0], [40.0], [50.0]],
        "labels": ["Intensity"],
        "units": ["counts"],
        "metadata": {"x_column_name": "Depth", "x_column_unit": "um"},
    }
    resp = client.post("/api/export/xrd-csv", json={"dataset": ds_in, "filename": "probe.csv"})
    assert resp.status_code == 200, resp.text
    out = tmp_path / "probe.csv"
    out.write_bytes(resp.content)
    ds_out = import_csv(out)
    assert ds_out.n_points == 5, f"exported 5 rows, re-imported {ds_out.n_points}"
    assert ds_out.labels == ("Intensity",)

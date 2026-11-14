"""``.opj`` reader vs. the public specimen corpus and its independent oracles.

Realdata: needs the public Origin specimen corpus, which is third-party
material that is never committed (nor are values copied out of it). Every
expected value below is therefore read from the corpus AT TEST TIME, out of
the oracles that ship beside the specimens:

* liborigin ``<project>.opj.<n>.dat.orig`` — its ASCII export of book n;
* Altaxo LibOriginCSharp ``OriginAnyParserTest.cs`` — C# assertions, read as
  data (``Assert.Equal(<value>, c.Data[<row>].AsDouble())`` ...);
* LabPlot ``ProjectImportTest.cpp`` — ``QCOMPARE(column->valueAt(...))``.

Those projects are GPL; only the expected values in their TESTS are read —
no reader code — and nothing from them is reproduced here.

Corpus location: ``$QZ_ORIGIN_PUBLIC_CORPUS``, else the first
``test-data/origin/public`` beside an ancestor of this file. Absent, every
test here skips.
"""

from __future__ import annotations

import math
import os
import re
import tempfile
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pytest

from quantized.datastruct import DataStruct
from quantized.io.origin_project import read_origin_books
from quantized.io.origin_project.container import walk_blocks
from quantized.io.origin_project.opj_datasets import parse_dataset_header
from quantized.io.origin_project.writer import opj_bytes
from quantized.io.origin_project.writer_matrix import matrix_fallbacks


def _corpus() -> Path:
    env = os.environ.get("QZ_ORIGIN_PUBLIC_CORPUS")
    if env:
        return Path(env)
    for ancestor in Path(__file__).resolve().parents:
        candidate = ancestor / "test-data" / "origin" / "public"
        if candidate.is_dir():
            return candidate
    return Path("__origin_public_corpus_absent__")


_CORPUS = _corpus()
pytestmark = [
    pytest.mark.realdata,
    pytest.mark.skipif(not _CORPUS.is_dir(), reason="public Origin specimen corpus not present"),
]


def _find(name: str) -> Path:
    hits = sorted(_CORPUS.rglob(name))
    if not hits:
        pytest.skip(f"{name} not in the specimen corpus")
    return hits[0]


def _opj_files() -> list[Path]:
    return sorted(p for p in _CORPUS.rglob("*") if p.suffix.lower() == ".opj" and p.is_file())


def _books(path: Path) -> list[DataStruct]:
    return read_origin_books(path)


def _columns(book: DataStruct) -> dict[str, np.ndarray]:
    """Numeric columns of a book by Origin short name (X first)."""
    out: dict[str, np.ndarray] = {}
    if book.metadata.get("x_column_recovered", True) and book.metadata.get("x_column_name"):
        out[str(book.metadata["x_column_name"])] = np.asarray(book.time)
    for j, short in enumerate(book.metadata.get("origin_column_names") or []):
        out[str(short)] = np.asarray(book.values[:, j])
    return out


def _has_dataset_headers(raw: bytes) -> bool:
    return any(parse_dataset_header(p) is not None for size, p in walk_blocks(raw) if size)


# ── whole-corpus distribution ────────────────────────────────────────────────


def test_every_project_with_dataset_headers_parses() -> None:
    """The positive control at corpus scale: any CPYA file in which a
    dataset header is recognised must import. (A file with none is not an
    Origin project the reader claims — one such synthetic stub is in the
    corpus.)"""
    files = _opj_files()
    assert files, "no .opj specimens under the corpus root"
    failures = []
    for path in files:
        if not _has_dataset_headers(path.read_bytes()):
            continue
        try:
            assert _books(path)
        except Exception as exc:  # collected, so one bad file names itself
            failures.append(f"{path.name}: {type(exc).__name__}: {exc}")
    assert not failures, "\n".join(failures)


def test_no_decoded_value_is_reinterpretation_garbage() -> None:
    """The tell of a wrong stride or a wrong cell type is a denormal or an
    astronomically large float64. No decoded cell anywhere may be one."""
    bad = []
    for path in _opj_files():
        if not _has_dataset_headers(path.read_bytes()):
            continue
        for book in _books(path):
            v = np.asarray(book.values, dtype=float)
            v = np.concatenate([v.ravel(), np.asarray(book.time, dtype=float)])
            v = v[np.isfinite(v) & (v != 0.0)]
            if v.size and (np.abs(v).min() < 1e-290 or np.abs(v).max() > 1e290):
                bad.append(f"{path.name}:{book.metadata['origin_book']}")
    assert not bad, bad


def test_every_worksheet_dataset_is_a_column_or_a_named_omission() -> None:
    """Fail-closed accounting: each ``<Book>_<Col>`` dataset is either in a
    book (numeric, text or report column) or listed in the diagnostics."""
    for path in _opj_files():
        raw = path.read_bytes()
        names = [
            h.name
            for size, p in walk_blocks(raw)
            if size and (h := parse_dataset_header(p)) is not None
        ]
        if not names:
            continue
        books = _books(path)
        matrices = {str(b.metadata["origin_book"]) for b in books if b.metadata.get("is2D")}
        present: set[str] = set(matrices)
        for book in books:
            if book.metadata.get("is2D"):
                continue
            key = str(book.metadata["origin_book"])
            base, _, sheet = key.partition("@")
            # A one-sheet book named as the book still holds `@N` datasets.
            sheet = sheet or str(book.metadata.get("origin_sheet_id") or "")
            shorts = [book.metadata.get("x_column_name") or ""]
            shorts += list(book.metadata.get("origin_column_names") or [])
            shorts += list(book.metadata.get("origin_text_columns") or {})
            shorts += list(book.metadata.get("origin_report_sheets") or {})
            present |= {f"{base}_{s}" + (f"@{sheet}" if sheet else "") for s in shorts if s}
        diagnostics = books[0].metadata.get("origin_data_diagnostics") or {}
        omitted = {d["dataset"] for d in diagnostics.get("details", [])}
        unaccounted = [n for n in names if n not in present and n not in omitted]
        assert not unaccounted, f"{path.name}: {unaccounted[:8]}"


def test_no_book_is_titled_with_timestamp_bytes() -> None:
    """Gap 8: "BA" was the printable tail of a window header's timestamps."""
    for path in _opj_files():
        if not _has_dataset_headers(path.read_bytes()):
            continue
        titles = [b.metadata.get("origin_book_long") for b in _books(path)]
        assert "BA" not in titles, path.name


# ── liborigin: ASCII export of each book ─────────────────────────────────────


def _liborigin_cases() -> list[Path]:
    return sorted(_CORPUS.rglob("*.opj.*.dat.orig")) if _CORPUS.is_dir() else []


@pytest.mark.parametrize("oracle", _liborigin_cases(), ids=lambda p: p.name)
def test_values_match_liborigin_ascii_export(oracle: Path) -> None:
    """Each ``.dat.orig`` is liborigin's dump of one worksheet: a header
    row, then one ``;``-separated row per ALLOCATED row (blank or ``nan``
    past the data). Our book is the used rows; the oracle's remaining rows
    must be blank."""
    project_name, index = re.fullmatch(r"(.+\.opj)\.(\d+)\.dat\.orig", oracle.name).groups()  # type: ignore[union-attr]
    books = [b for b in _books(oracle.with_name(project_name)) if not b.metadata.get("is2D")]
    book = books[int(index) - 1]
    lines = oracle.read_text(encoding="latin1").splitlines()
    rows = [[c.strip() for c in line.split(";")[:-1]] for line in lines[1:] if ";" in line]
    columns = list(_columns(book).values())
    assert len(columns) == len(rows[0])
    for j, column in enumerate(columns):
        expected = [math.nan if r[j] in ("", "nan") else float(r[j]) for r in rows]
        used = column.size
        np.testing.assert_allclose(column, expected[:used], rtol=1e-3, equal_nan=True)
        assert all(math.isnan(v) for v in expected[used:]), "data past the used-row end"


# ── Altaxo: C# assertions read as data ───────────────────────────────────────

_METHOD = re.compile(r"public void (Test\w+)\(\)")
_FILE = re.compile(r'Path\.Combine\(TestFilePath, "([^"]+\.opj)"\)')
_SHEET = re.compile(r"spreadSheet = (?:reader\.SpreadSheets|excel\.Sheets)\[(\d+)\]")
_COLUMN = re.compile(r"\bc = spreadSheet\.Columns\[(\d+)\]")
_NUMBER = re.compile(r"Assert\.Equal\((-?[\d.]+), c\.Data\[(\d+)\]\.AsDouble\(\)\)")
_STRING = re.compile(r'Assert\.Equal\("([^"]*)", c\.Data\[(\d+)\]\.AsString\(\)\)')
_LABEL = re.compile(r'Assert\.Equal\("((?:[^"\\]|\\.)*)", c\.(LongName|Units|Comments)\)')
_EMPTY = re.compile(r"Assert\.Empty\(c\.(LongName|Units|Comments)\)")
_END_ROW = re.compile(r"Assert\.Equal\((\d+), c\.EndRow\)")
_DATETIME = re.compile(
    r"new DateTime\((\d+), (\d+), (\d+), (\d+), (\d+), (\d+)\), "
    r"RoundToSecond\(c\.Data\[(\d+)\]\.AsDateTime\(\)"
)
_TIMESPAN = re.compile(
    r"new TimeSpan\((\d+), (\d+), (\d+)\), RoundToSecond\(c\.Data\[(\d+)\]\.AsTimeSpan\(\)"
)
_LOOP = re.compile(r"^\s*(for|foreach|switch)\b")


def _altaxo_expectations() -> dict[str, list[tuple[int, int, str, object, object]]]:
    """``{project file: [(sheet, column, kind, key, expected)]}`` from the
    straight-line parts of Altaxo's tests (anything inside a loop, and any
    assertion that needs C# evaluation, is skipped — not misread)."""
    source = _find("OriginAnyParserTest.cs").read_text(encoding="utf-8-sig")
    out: dict[str, list[tuple[int, int, str, object, object]]] = {}
    project: str | None = None
    sheet, column, depth, loop_depth = 0, -1, 0, None
    for line in source.splitlines():
        if _METHOD.search(line):
            project, sheet, column, loop_depth = None, 0, -1, None
        if loop_depth is None and _LOOP.search(line):
            loop_depth = depth
        depth += line.count("{") - line.count("}")
        if loop_depth is not None:
            if depth <= loop_depth and "}" in line:
                loop_depth = None
            continue
        if m := _FILE.search(line):
            project = m.group(1)
        if m := _SHEET.search(line):
            sheet, column = int(m.group(1)), -1
        if m := _COLUMN.search(line):
            column = int(m.group(1))
        if project is None or column < 0:
            continue
        facts = out.setdefault(project, [])
        if m := _NUMBER.search(line):
            facts.append((sheet, column, "number", int(m.group(2)), float(m.group(1))))
        elif m := _STRING.search(line):
            facts.append((sheet, column, "string", int(m.group(2)), m.group(1)))
        elif m := _LABEL.search(line):
            facts.append((sheet, column, "label", m.group(2), m.group(1).replace("\\n", "\n")))
        elif m := _EMPTY.search(line):
            facts.append((sheet, column, "label", m.group(1), ""))
        elif m := _END_ROW.search(line):
            facts.append((sheet, column, "end_row", None, int(m.group(1))))
        elif m := _DATETIME.search(line):
            *ymdhms, row = (int(g) for g in m.groups())
            facts.append((sheet, column, "datetime", row, tuple(ymdhms)))
        elif m := _TIMESPAN.search(line):
            h, mi, sec, row = (int(g) for g in m.groups())
            facts.append((sheet, column, "timespan", row, h * 3600 + mi * 60 + sec))
    return out


def _column_view(book: DataStruct, index: int) -> dict[str, object]:
    """Everything the reader says about the ``index``-th column (A, B, ...)."""
    meta = book.metadata
    short = chr(ord("A") + index)
    numeric = _columns(book).get(short)
    text = (meta.get("origin_text_columns") or {}).get(short)
    labels = (meta.get("origin_text_column_labels") or {}).get(short, {})
    names = list(meta.get("origin_column_names") or [])
    if short == meta.get("x_column_name") and meta.get("x_column_recovered", True):
        long_name = meta.get("x_column_long") if meta.get("x_column_long") != short else ""
        unit = meta.get("x_column_unit")
    elif short in names:
        long_name = book.labels[names.index(short)]
        long_name = "" if long_name == short else long_name
        unit = book.units[names.index(short)]
    else:
        long_name, unit = labels.get("long_name", ""), labels.get("unit", "")
    return {
        "numeric": numeric,
        "text": text,
        "LongName": long_name,
        "Units": unit,
        "Comments": (meta.get("column_comments") or {}).get(short, ""),
        "format": (meta.get("origin_column_formats") or {}).get(short),
        "rows": max(0 if numeric is None else numeric.size, len(text or [])),
    }


def test_altaxo_expected_values_labels_and_row_counts() -> None:
    """Gaps 1, 2, 9, 12 against Altaxo's assertions: cell values (numbers
    and strings), long names, units, comments and the used-row end."""
    expectations = _altaxo_expectations()
    checked = 0
    for project, facts in expectations.items():
        books = [b for b in _books(_find(project)) if not b.metadata.get("is2D")]
        for sheet, column, kind, key, expected in facts:
            assert sheet < len(books), f"{project}: no book for sheet {sheet}"
            view = _column_view(books[sheet], column)
            where = f"{project} sheet {sheet} column {column} {kind} {key}"
            if kind == "number":
                numeric = view["numeric"]
                assert numeric is not None and numeric[key] == pytest.approx(expected), where  # type: ignore[index]
            elif kind == "string":
                assert view["text"] is not None and view["text"][key] == expected, where  # type: ignore[index]
            elif kind == "label":
                assert view[str(key)] == expected, where
            elif kind == "datetime":
                # The stored number + the column's format hint must give the
                # calendar instant Altaxo states (to the minute it rounds to).
                hint = view["format"]
                assert hint is not None and hint["kind"] == "datetime", where  # type: ignore[index]
                seconds = (view["numeric"][key] - hint["unix_epoch_day"]) * 86400.0  # type: ignore[index]
                got = datetime.fromtimestamp(round(seconds), tz=UTC)
                assert got == datetime(*expected, tzinfo=UTC), where  # type: ignore[misc]
            elif kind == "timespan":
                hint = view["format"]
                assert hint == {"kind": "time", "unit": "days"}, where
                assert round(view["numeric"][key] * 86400.0) == expected, where  # type: ignore[index]
            else:
                # A book pads shorter columns to its longest; no column may
                # run past the longest used-row end Altaxo states for it.
                assert view["rows"] >= expected, where  # type: ignore[operator]
            checked += 1
    assert checked > 100, f"only {checked} Altaxo expectations were read — the test source moved?"


@pytest.mark.parametrize("name", ["Matrix71x29.opj", "Matrix137x179.opj"])
def test_matrix_shape_matches_the_dimensions_in_its_file_name(name: str) -> None:
    cols, rows = (int(v) for v in re.search(r"(\d+)x(\d+)", name).groups())  # type: ignore[union-attr]
    (book,) = _books(_find(name))
    assert book.metadata["map_shape"] == [rows, cols]
    assert book.values.shape == (rows * cols, 3)
    assert book.metadata["origin_matrix"]["coordinates_recovered"] is True


def _written_back(path: Path) -> list[DataStruct]:
    """``path``'s books written by the ``.opj`` writer and read again."""
    out = Path(tempfile.mkdtemp()) / "written.opj"
    out.write_bytes(opj_bytes(_books(path), matrices=True))
    return _books(out)


@pytest.mark.parametrize("via_writer", [False, True], ids=["read", "written-back"])
def test_altaxo_matrix_cells_and_coordinates(via_writer: bool) -> None:
    """``Assert.Equal(v, sheet[r, c])`` and ``sheet.X1`` ... for the two
    single-matrix projects: cell [r, c] is point ``r * cols + c``. Also for
    the same projects written back by the ``.opj`` writer (``writer_matrix``):
    an exported matrix carries Altaxo's cells and coordinates too."""
    source = _find("OriginAnyParserTest.cs").read_text(encoding="utf-8-sig")
    checked = 0
    for name in ("Matrix71x29.opj", "Matrix137x179.opj"):
        body = source.split(f'"{name}"', 1)[1].split("[Fact]", 1)[0]
        (book,) = (_written_back if via_writer else _books)(_find(name))
        rows, cols = book.metadata["map_shape"]
        z = np.asarray(book.values[:, 2]).reshape(rows, cols)
        for value, r, c in re.findall(r"Assert\.Equal\((-?[\d.]+), sheet\[(\d+), (\d+)\]\)", body):
            assert z[int(r), int(c)] == float(value), f"{name} [{r},{c}]"
            checked += 1
        ranges = book.metadata["origin_matrix"]
        for value, bound in re.findall(r"Assert\.Equal\((-?[\d.]+), sheet\.([XY][12])\)", body):
            got = ranges["x_range" if bound[0] == "X" else "y_range"][int(bound[1]) - 1]
            assert got == float(value), f"{name} {bound}"
            checked += 1
    assert checked >= 16


@pytest.mark.parametrize(
    "name",
    ["Matrix71x29", "Matrix137x179", "Matrix2x3OfDifferentTypes", "OneWorksheetOneMatrix"],
)
@pytest.mark.parametrize("ext", [".opj", ".opju"])
def test_matrix_books_round_trip_through_the_opj_writer(name: str, ext: str) -> None:
    """Every matrix the reader imports comes back from a written ``.opj`` as
    the same matrix (shape, coordinates, every cell); worksheets beside it
    stay worksheets. A complex matrix is the one that cannot (it goes out
    as worksheet columns, counted by ``matrix_fallbacks``)."""
    source = _find(name + ext)
    books = _books(source)
    back = {b.metadata["origin_book"]: b for b in _written_back(source)}
    for book in books:
        again = back[book.metadata["origin_book"]]
        if "Z (imaginary)" in book.labels:
            assert again.metadata.get("origin_matrix") is None
            continue
        assert again.metadata.get("origin_matrix") == book.metadata.get("origin_matrix")
        assert again.labels == book.labels
        assert np.array_equal(again.values, book.values, equal_nan=True)
    complex_books = sum("Z (imaginary)" in b.labels for b in books)
    assert matrix_fallbacks(books, None, matrices=True) == complex_books
    assert matrix_fallbacks(books, None) == sum("origin_matrix" in b.metadata for b in books)


# ── LabPlot: Origin 8 Text & Numeric columns ─────────────────────────────────


def test_origin8_workbook_matches_labplot_expectations() -> None:
    """Gap 6: the Origin 8 (140-byte header) workbook LabPlot tests cell by
    cell — numbers, NaNs for blanks and text cells, and the text itself."""
    source = _find("ProjectImportTest.cpp").read_text(encoding="utf-8")
    body = source.split("testOriginTextNumericColumns()", 1)[1].split("\nvoid ", 1)[0]
    (book,) = _books(_find("origin8_test_workbook.opj"))
    checked = 0
    for index, chunk in enumerate(body.split("spreadsheet->column(")[1:]):
        view = _column_view(book, int(chunk.split(")", 1)[0]))
        numeric, text = view["numeric"], view["text"]
        for row, value in re.findall(r"QCOMPARE\(column->valueAt\((\d+)\), ([\d.]+)\)", chunk):
            assert numeric is not None and numeric[int(row)] == float(value), (index, row)  # type: ignore[index]
            checked += 1
        for row in re.findall(r"QCOMPARE\(!std::isnan\(column->valueAt\((\d+)\)\), false\)", chunk):
            assert numeric is None or int(row) >= numeric.size or math.isnan(numeric[int(row)])  # type: ignore[attr-defined,index]
            checked += 1
        for row, value in re.findall(r'textAt\((\d+)\), QLatin1String\("([^"]*)"\)', chunk):
            assert text is not None and text[int(row)] == value, (index, row)  # type: ignore[index]
            checked += 1
    assert checked >= 25


def test_graph_windows_are_recovered_or_named_never_silent() -> None:
    """Every graph window (header kind field 0x42 != 2) either becomes a
    figure or is named as present-but-not-recovered; no worksheet, matrix or
    notes window is ever reported (``opj_graph_windows``)."""
    from quantized.io.origin_project.figures import extract_figures
    from quantized.io.origin_project.opj_graph_windows import unrecovered_graph_windows

    for path in _opj_files():
        raw = path.read_bytes()
        missed = unrecovered_graph_windows(raw)
        recovered = {str(f["name"]) for f in extract_figures(raw)}
        # A reported window is never one extract_figures already recovered.
        assert not set(missed) & recovered, path.name
        if path.name == "3dband-origin.opj":
            assert missed == ["Graph2"]  # first layer block head 0x47
        else:
            assert missed == [], path.name


def test_bar_column_and_histogram_plot_types_match_labplot() -> None:
    """Re-audit #2: the plot type of each curve (anchor u8 @76) against
    LabPlot's testOriginBarPlot / testOriginHistogram, read at test time: a
    BarPlot with Vertical orientation is Origin's "column", Horizontal its
    "bar"; a Histogram is "histogram" (``opj_curves._PLOT_TYPES``)."""
    from quantized.io.origin_project.figures import extract_figures

    source = _find("ProjectImportTest.cpp").read_text(encoding="utf-8")
    cases = {"testOriginBarPlot()": "bar-column.opj", "testOriginHistogram()": "histogram.opj"}
    checked = 0
    for test, file in cases.items():
        body = source.split(test, 1)[1].split("\nvoid ", 1)[0]
        figs = {f["name"]: f for f in extract_figures(_find(file).read_bytes())}
        for chunk in body.split("worksheet->name(), QLatin1String(\"")[1:]:
            graph = chunk.split('"', 1)[0]
            if "BarPlot::Orientation::Vertical" in chunk:
                want = "column"
            elif "BarPlot::Orientation::Horizontal" in chunk:
                want = "bar"
            elif "Histogram*>" in chunk:
                want = "histogram"
            else:
                continue
            assert [c.get("plotType") for c in figs[graph]["curves"]] == [want], (file, graph)
            checked += 1
    assert checked == 4

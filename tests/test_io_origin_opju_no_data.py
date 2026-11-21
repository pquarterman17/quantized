"""``.opju`` projects with no worksheet data import their graphs (``opju_no_data``).

Synthetic unit tests lock the proven behaviour: placeholder books carry why
they are empty, curves of a book whose data is not in the file are left out
(never drawn from nothing) with reason ``data_not_saved``, a connector's
source path is reported only when its own framing closes, and the worksheet
summary lists the unsaved books as a loss. The corpus side (which real books
are Data Connector books saved without data) is the ``realdata`` test below.
"""

from __future__ import annotations

import os
from pathlib import Path

import numpy as np
import pytest

from quantized.datastruct import DataStruct
from quantized.io.origin_project.opju_no_data import (
    DATA_NOT_SAVED,
    UNAVAILABLE_KEY,
    _paths,
    nothing_left_unread,
    omit_unsaved_curves,
    unavailable_reason,
)
from quantized.io.origin_project.worksheet_fidelity import worksheet_fidelity_summary


def _book(name: str, *, unavailable: bool) -> DataStruct:
    meta: dict[str, object] = {"origin_book": name}
    if unavailable:
        meta[UNAVAILABLE_KEY] = {"reason": DATA_NOT_SAVED, "detail": "x"}
    return DataStruct(time=np.empty(0), values=np.empty((0, 0)), metadata=meta)


def test_connector_reason_names_the_connector_and_source() -> None:
    conns = {"Book1": {"connector": "CSV", "source": "D:\\data\\run 1.csv"}}
    got = unavailable_reason("Book1@2", conns)  # a sheet of the connector book
    assert got["reason"] == DATA_NOT_SAVED
    assert got["connector"] == "CSV" and got["source"] == "D:\\data\\run 1.csv"
    assert "CSV Data Connector (D:\\data\\run 1.csv)" in got["detail"]
    assert "not saved in the project" in got["detail"]


def test_book_without_connector_is_plain_no_data() -> None:
    got = unavailable_reason("Graph-only", {})
    assert got["reason"] == "no_worksheet_data"
    assert "only its graphs were imported" in got["detail"]


def test_curves_of_an_unsaved_book_are_omitted_with_reason_and_caption() -> None:
    figs = [
        {
            "name": "Graph1",
            "curves": [
                {"book": "Book1", "x": "A", "y": "B"},
                {"book": "Book2", "x": "A", "y": "B"},
                {"book": "Book1@2", "x": "A", "y": "C"},
            ],
            "legend_labels": ["\\l(1) one", "\\l(2) two", "\\l(3) three"],
        },
        {"name": "Graph2", "curves": [{"book": "Book2", "x": "A", "y": "C"}]},
    ]
    books = [
        _book("Book1", unavailable=True),
        _book("Book1@2", unavailable=True),
        _book("Book2", unavailable=False),
    ]
    out = omit_unsaved_curves(figs, books)
    assert out[1] is figs[1]  # untouched
    g = out[0]
    assert g["curves"] == [{"book": "Book2", "x": "A", "y": "B"}]
    assert g["legend_labels"] == ["\\l(1) two"]  # renumbered to the kept curve
    assert g["curve_sheet_omitted"] == [
        {"book": "Book1", "x": "A", "y": "B", "recorded": "Book1", "reason": DATA_NOT_SAVED},
        {"book": "Book1", "x": "A", "y": "C", "recorded": "Book1@2", "reason": DATA_NOT_SAVED},
    ]


def test_curves_of_an_unsaved_connector_book_beside_imported_books_are_omitted() -> None:
    """A connector book saved without data in a project that imported other
    books has no DataStruct at all: its curves (any sheet) are omitted as
    ``data_not_saved`` -- an imported sheet of the same base name is not."""
    figs = [
        {
            "name": "Graph10",
            "curves": [
                {"book": "Book3", "x": "A", "y": "B"},
                {"book": "Book3@2", "x": "A", "y": "D"},
                {"book": "Book4", "x": "A", "y": "B"},
                {"book": "Book4@2", "x": "A", "y": "C"},
            ],
        }
    ]
    books = [_book("Book4", unavailable=False), _book("Book4@2", unavailable=False)]
    out = omit_unsaved_curves(figs, books, ["Book3", "Book4"])  # Book4@2 imported: kept
    assert out[0]["curves"] == [
        {"book": "Book4", "x": "A", "y": "B"},
        {"book": "Book4@2", "x": "A", "y": "C"},
    ]
    assert [o["recorded"] for o in out[0]["curve_sheet_omitted"]] == ["Book3", "Book3@2"]
    assert {o["reason"] for o in out[0]["curve_sheet_omitted"]} == {DATA_NOT_SAVED}


def test_no_unsaved_books_is_a_no_op() -> None:
    figs = [{"name": "G", "curves": [{"book": "Book1", "x": "A", "y": "B"}]}]
    assert omit_unsaved_curves(figs, [_book("Book1", unavailable=False)]) is figs


def test_source_path_needs_its_own_framing_to_close() -> None:
    path = b"C:\\Users\\me\\data.xlsx"
    assert _paths(b"\x01\x02" + path + b"\x00Excel_Connector\x00") == [path.decode()]
    assert _paths(bytes([len(path)]) + path + b"\xb8\x01") == [path.decode()]  # length-prefixed
    # cut by the window's compression: neither form closes on a clean path
    assert _paths(b"\x10D:\\a\\61 \x08\x00\xf5\n.csv\x00") == []
    assert _paths(b"\x00D:\\folder\\no extension\x00") == []


def test_worksheet_summary_lists_unsaved_books_as_a_loss() -> None:
    summary = worksheet_fidelity_summary(
        {"columns_numeric": 0, "unsaved_books": [{"book": "Book1", "connector": "CSV"}]}
    )
    assert summary["status"] == "partial"
    assert summary["losses"] == [{"code": "data_not_saved", "count": 1, "examples": ["Book1"]}]


_CLEAN: dict[str, object] = {
    "undecoded": [],
    "records_without_header": 0,
    "checksum_failed": {"count": 0, "examples": []},
    "over_decode_budget": {"count": 0, "examples": []},
    "matrix_datasets": [],
    "report_columns": 0,
    "columns_without_header": {"count": 0, "examples": []},
    "empty_books_omitted": ["Book1"],
}


@pytest.mark.parametrize(
    "unread",
    [
        {"undecoded": [{"form": "dataset", "reason": "r", "count": 1, "examples": ["A"]}]},
        {"records_without_header": 2},
        {"checksum_failed": {"count": 1, "examples": ["Book1_A"]}},
        {"over_decode_budget": {"count": 1, "examples": ["Book1_A"]}},
        {"matrix_datasets": [{"name": "MBook1"}]},
        {"report_columns": 3},
        {"columns_without_header": {"count": 1, "examples": ["Book1_A"]}},
    ],
)
def test_any_record_found_but_not_read_blocks_the_placeholder_import(
    unread: dict[str, object],
) -> None:
    """Fail closed: a damaged or undecoded record means the data may be in
    the file, so the project must not 'open' as empty placeholder books."""
    assert nothing_left_unread(_CLEAN)
    assert not nothing_left_unread({**_CLEAN, **unread})


# ── realdata: every Data Connector book in the public corpus ─────────────────


def _corpus() -> Path | None:
    env = os.environ.get("QZ_ORIGIN_PUBLIC_CORPUS")
    if env:
        return Path(env) if Path(env).is_dir() else None
    for ancestor in Path(__file__).resolve().parents:
        candidate = ancestor / "test-data" / "origin" / "public"
        if candidate.is_dir():
            return candidate
    return None


_CORPUS = _corpus()
_EXCLUDED = ("CKPEIIKA_deopjufy/tests/fixtures/synthetic", "BertySnack_norigin")


def _connector_projects() -> list[Path]:
    if _CORPUS is None:
        return []
    out = []
    for p in sorted(_CORPUS.rglob("*.opju")):
        if any(x in p.as_posix() for x in _EXCLUDED):
            continue
        b = p.read_bytes()
        if b.startswith(b"CPYUA") and b"_Connector\x00" in b:
            out.append(p)
    return out


@pytest.mark.realdata
def test_corpus_connector_books_are_unsaved_exactly_when_their_cells_are_absent() -> None:
    """Oracle: a book's own dataset records. A connector book is reported as
    ``data_not_saved`` iff every one of its records allocates one row and
    uses none; a connector book that carries its data never is (the negative
    controls). A whole project of such books imports, with its curves left
    out as ``data_not_saved``, instead of failing."""
    from quantized.io.origin_project import read_origin_project_all
    from quantized.io.origin_project.import_manifest import origin_figures_and_fidelity
    from quantized.io.origin_project.opju_no_data import connector_books
    from quantized.io.origin_project.opju_records import scan_records

    projects = _connector_projects()
    if not projects:
        pytest.skip("public Origin corpus not available")
    positives = negatives = whole = 0
    for path in projects:
        b = path.read_bytes()
        recs: dict[str, list[tuple[int, int]]] = {}
        for r in scan_records(b):
            book = r.header.name.split("_")[0].split("@")[0]
            recs.setdefault(book, []).append((r.header.total_rows, r.header.used_rows))
        conns = connector_books(b, recs)
        ds, books = read_origin_project_all(path, raw=b)
        fid = ds.metadata["origin_worksheet_fidelity"]
        reported = {u["book"] for u in fid["unsaved_books"]}
        for book in conns:
            empty = all(t == 1 and u == 0 for t, u in recs[book])
            if empty:
                positives += 1
                assert book in reported, (path.name, book)
            else:
                negatives += 1
                assert book not in reported, (path.name, book)
        imported = {str(x.metadata.get("origin_book", "")) for x in books}
        if reported - imported and not all(UNAVAILABLE_KEY in x.metadata for x in books):
            # beside imported books: no curve may point at a book that has no cells
            figs, _ = origin_figures_and_fidelity(b, ".opju", books, primary=ds)
            for f in figs:
                for c in f["curves"]:
                    base = str(c["book"]).partition("@")[0]
                    assert not (base in reported and c["book"] not in imported), (path.name, c)
        if all(UNAVAILABLE_KEY in x.metadata for x in books):
            whole += 1
            figs, _ = origin_figures_and_fidelity(b, ".opju", books, primary=ds)
            assert figs, path.name
            for f in figs:
                assert not f["curves"], (path.name, f["name"])
                omitted = f.get("curve_sheet_omitted") or []
                assert {o["reason"] for o in omitted} <= {DATA_NOT_SAVED}, (path.name, f["name"])
    assert positives >= 1 and negatives >= 1 and whole >= 1


@pytest.mark.realdata
def test_corpus_projects_without_any_dataset_import_their_graphs() -> None:
    """A project with no dataset record at all imports (one labelled empty
    book + its graph pages) exactly when it has a graph page; the graph's
    saved Origin preview is carried, so what the user sees is Origin's own
    rendering, not an empty plot."""
    from quantized.io.origin_project import OriginProjectError, read_origin_project_all
    from quantized.io.origin_project.import_manifest import origin_figures_and_fidelity
    from quantized.io.origin_project.opju_blocks import find_headers
    from quantized.io.origin_project.opju_graph_pages import unrecovered_graph_pages

    if _CORPUS is None:
        pytest.skip("public Origin corpus not available")
    seen = 0
    for path in sorted(_CORPUS.rglob("*.opju")):
        if any(x in path.as_posix() for x in _EXCLUDED) or path.stat().st_size > 20_000_000:
            continue
        b = path.read_bytes()
        if not b.startswith(b"CPYUA") or find_headers(b):
            continue
        seen += 1
        if not unrecovered_graph_pages(b, set()).missing:
            with pytest.raises(OriginProjectError):
                read_origin_project_all(path, raw=b)
            continue
        ds, books = read_origin_project_all(path, raw=b)
        assert ds.metadata[UNAVAILABLE_KEY]["reason"] == "no_worksheet_data"
        assert ds.n_points == 0 and ds.n_channels == 0
        _, manifest = origin_figures_and_fidelity(b, ".opju", books, primary=ds)
        graphs = manifest.get("unrecovered_graphs", [])
        assert graphs and all(g.get("saved_preview") for g in graphs), path.name
    if not seen:
        pytest.skip("no dataset-free project in the corpus")


@pytest.mark.realdata
def test_corpus_no_data_project_with_an_unread_record_still_raises(monkeypatch) -> None:
    """The real Data Connector project, with one record reported as found
    but not read, must keep failing with the census instead of importing
    placeholders (the guard is wired into ``opju._parse``)."""
    from quantized.io.origin_project import OriginProjectError, opju, read_origin_project_all

    if _CORPUS is None:
        pytest.skip("public Origin corpus not available")
    path = next(iter(sorted(_CORPUS.rglob("61 PDOS.opju"))), None)
    if path is None:
        pytest.skip("61 PDOS.opju not in the corpus")
    real = opju.scan_worksheet

    def damaged(*args: object, **kwargs: object) -> object:
        scan = real(*args, **kwargs)  # type: ignore[arg-type]
        scan.fidelity["records_without_header"] = 1
        return scan

    read_origin_project_all(path)  # imports as placeholders when clean
    monkeypatch.setattr(opju, "scan_worksheet", damaged)
    with pytest.raises(OriginProjectError, match="no worksheet columns could be decoded"):
        read_origin_project_all(path)

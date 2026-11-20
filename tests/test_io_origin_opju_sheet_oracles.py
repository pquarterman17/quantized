"""Corpus oracles for which sheet an ``.opju`` curve's column is on
(``opju_curve_sheets.off_sheet_ids``), computed at test time.

* Altaxo LibOriginCSharp TestFiles: every multi-sheet book exists as both
  ``.opj`` and ``.opju``. The ``.opj`` dataset names carry the sheet
  (``Book1_B@2``), read by a separate decoder; the ``.opju`` rank alignment
  must name only sheets that ``.opj`` holds, and must agree with the
  window's own sheet segments (``opju_sheet_segments``, signal S).
* A book renamed by case only (``Absorption-D3.opju``): its curves bind to
  the same sheet as the other books' curves in every layer that compares
  one sheet across books, and every such curve can be drawn.

``realdata``: skipped without the local corpus (``tests/conftest.py``).
"""

from __future__ import annotations

from collections import defaultdict
from pathlib import Path

import pytest

from quantized.io.origin_project import (
    drop_empty_library_books,
    read_origin_books,
    read_origin_project_all,
)
from quantized.io.origin_project.figures_opju import extract_figures_opju
from quantized.io.origin_project.opju_curve_sheets import off_sheet_ids, unbound_rebinds
from quantized.io.origin_project.opju_figure_curves import column_id_table, opju_pages
from quantized.io.origin_project.opju_sheet_segments import record_segments

pytestmark = pytest.mark.realdata

_ALTAXO = (
    "origin/public/gh_Altaxo_LibOriginCSharp/LibOriginCSharpTests/Serialization/Origin/TestFiles"
)
_ABS = "origin/public/Since-Ufa_Diplom/paper/pictures/Absorption-D3.opju"


def _base(key: str) -> str:
    return key.partition("@")[0]


def test_altaxo_rank_alignment_names_the_sheets_the_paired_opj_holds(corpus_dir: Path) -> None:
    folder = corpus_dir / _ALTAXO
    pairs = sorted(p for p in folder.glob("*.opju") if p.with_suffix(".opj").is_file())
    if not pairs:
        pytest.skip("Altaxo TestFiles not present")
    multi = 0
    for opju in pairs:
        b = opju.read_bytes()
        ids = column_id_table(b, opju_pages(b)).ids
        off = off_sheet_ids(b, ids)
        assert "" not in off.values(), opju.name  # every id aligned
        sheet = {cid: off.get(cid, book) for cid, (book, _col) in ids.items()}
        opj_books = read_origin_books(opju.with_suffix(".opj"))
        opj_keys = {str(ds.metadata.get("origin_book")) for ds in opj_books}
        for cid, key in sheet.items():
            if key != ids[cid][0]:  # a re-bound column: its sheet must be one .opj has
                assert key in opj_keys, (opju.name, cid, key)
        for _seg, cids in record_segments(b, ids).items():
            assert len({sheet[c] for c in cids}) == 1, opju.name  # one segment, one sheet
        multi += len({sheet[c] for c in ids}) > len({book for book, _ in ids.values()})
    assert multi >= 1  # OneWorksheetWithTwoSheets is a two-sheet book


def test_case_renamed_book_binds_the_sheet_its_sibling_books_use(corpus_dir: Path) -> None:
    project = corpus_dir / _ABS
    if not project.is_file():
        pytest.skip(f"{_ABS} not present")
    _primary, books = read_origin_project_all(project)
    kept = drop_empty_library_books(books)
    columns = {str(ds.metadata.get("origin_book")): ds.metadata for ds in kept}
    spellings: dict[str, set[str]] = defaultdict(set)
    for key in columns:
        spellings[_base(key).casefold()].add(_base(key))
    renamed = {fold for fold, names in spellings.items() if len(names) > 1}
    assert renamed  # the specimen: sheets imported under two spellings of one book
    figs = unbound_rebinds(extract_figures_opju(project.read_bytes()), kept)
    compared = drawn = 0
    for fig in figs:
        mine = [c for c in fig["curves"] if _base(c["book"]).casefold() in renamed]
        for c in mine:  # each re-bound curve is drawable from what was imported
            meta = columns[c["book"]]
            assert c["y"] in meta["origin_column_names"]
            assert c["x"] in (meta.get("x_column_name"), *meta["origin_column_names"])
            drawn += 1
        others = {c["book"].partition("@")[2] for c in fig["curves"] if c not in mine}
        if len(mine) == 1 and len(others) == 1 and len(fig["curves"]) >= 3:
            assert mine[0]["book"].partition("@")[2] == others.pop(), fig["name"]
            compared += 1
    assert compared >= 5
    assert drawn >= compared

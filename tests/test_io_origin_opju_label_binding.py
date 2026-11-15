""".opju labels bound to columns BY NAME (decode-plan item 73).

``windows_opju`` reads a book's labels from the N-th designation marker
after the book anchor, but the marker byte pairs also occur in label text
(``!a`` = ``21 61``, `` a`` = ``20 61``, ``0a`` = ``30 61``): one stray pair
shifts every later column. ``opju._bind_by_record`` binds each label to the
column record that carries the column's own short name, inside the book's
own window span (``opju_record_meta``), and drops a positional reading that
a record of the book contradicts.

Synthetic bytes only (invented names). The Origin-checked anchors are the
``realdata`` tests below (COM ``wks.col.lname$`` / ``unit$`` / ``type`` and
the column's dataset name ``%(%H, i)``, Origin 2026b, 2026-11-15).
"""

from __future__ import annotations

from pathlib import Path

import pytest

from quantized.io.origin_project.opju import _bind_by_record
from quantized.io.origin_project.opju_figure_curves import opju_pages
from quantized.io.origin_project.opju_record_meta import contradicted_books
from quantized.io.origin_project.windows import BookMeta, ColumnMeta
from quantized.io.origin_project.windows_opju import opju_window_metadata
from test_io_origin_figures_opju import _opju_page_header
from test_io_origin_opju_numeric_columns import _MAGIC, _label, _numeric_record

# (id, short name, code, associated id, label): A's label holds `21 61` ("!a")
_COLS = [
    (1, "A", 3, 0, "time !a\r\ns"),
    (2, "B", 0, 1, "volts\r\nV"),
    (3, "C", 2, 2, "dV 0a\r\nV"),
    (4, "D", 0, 1, "amps\r\nA"),
]


def _tn_book(name: str, cols: list[tuple[int, str, int, int, str]]) -> bytes:
    body = b"".join(
        _numeric_record(cid, nm, code, assoc, fmt=9) + _label(lab)
        for cid, nm, code, assoc, lab in cols
    )
    return _opju_page_header(name) + b"\x00" * 64 + body + b"\x00" * 64


def _names(meta: BookMeta) -> dict[str, tuple[str, str, str]]:
    return {c: (m.designation, m.long_name, m.unit) for c, m in meta.columns.items()}


_WANT = {
    "A": ("X", "time !a", "s"),
    "B": ("Y", "volts", "V"),
    "C": ("Y-error", "dV 0a", "V"),
    "D": ("Y", "amps", "A"),
}


def test_marker_bytes_in_label_text_shift_the_positional_reading() -> None:
    """The defect class: the positional reader counts the label's `!a`."""
    b = _MAGIC + _tn_book("Lab", _COLS)
    positional = opju_window_metadata(b, {"Lab": ["A", "B", "C", "D"]})
    assert _names(positional["Lab"]) != _WANT


def test_labels_bind_to_their_column_record_by_name() -> None:
    b = _MAGIC + _tn_book("Lab", _COLS)
    cols = {"Lab": ["A", "B", "C", "D"]}
    got = _bind_by_record(b, opju_window_metadata(b, cols), cols)
    assert _names(got["Lab"]) == _WANT


def test_positional_reading_a_record_contradicts_is_dropped() -> None:
    b = _MAGIC + _tn_book("Lab", _COLS)
    pages = opju_pages(b)
    wrong = BookMeta("Lab", "Lab", {"B": ColumnMeta("B", "X", "volts")})  # B's record: Y
    assert contradicted_books(b, pages, {"Lab": wrong}) == {"Lab"}
    mislabelled = BookMeta("Lab", "Lab", {"B": ColumnMeta("B", "Y", "time !a")})
    assert contradicted_books(b, pages, {"Lab": mislabelled}) == {"Lab"}
    right = BookMeta("Lab", "Lab", {"B": ColumnMeta("B", "Y", "volts", "V")})
    assert contradicted_books(b, pages, {"Lab": right}) == set()


def test_records_of_another_window_never_label_a_book() -> None:
    """A same-named column in a later window is outside the book's span."""
    b = _MAGIC + _tn_book("Lab", _COLS[:2]) + _tn_book("Other", [(9, "C", 0, 1, "far\r\nX")])
    cols = {"Lab": ["A", "B", "C"]}
    got = _bind_by_record(b, {}, cols)
    assert "Lab" not in got  # C has no record in Lab's own span: fail closed


# -- realdata anchors (COM readback) ---------------------------------------


def _path(corpus_dir: Path, rel: str) -> Path:
    path = corpus_dir / rel
    if not path.is_file():
        pytest.skip(f"{rel} not present")
    return path


def _books(corpus_dir: Path, rel: str) -> dict[str, object]:
    from quantized.io.origin_project.opju import read_opju_books

    return {b.metadata.get("origin_book"): b for b in read_opju_books(_path(corpus_dir, rel))}


def _label_of(ds: object, col: str) -> tuple[str, str]:
    names = ds.metadata["origin_column_names"]  # type: ignore[attr-defined]
    i = names.index(col)
    return ds.labels[i], ds.units[i]  # type: ignore[attr-defined]


@pytest.mark.realdata
def test_realdata_fixed_lambdas_labels(corpus_dir: Path) -> None:
    """COM, ``Fixed Lambdas SI`` book PNRNbAl200nm: A X ``Q``, B X-error
    ``dQ``, C Y ``R++`` (arb. units), D Y-error ``dR++``. Main read every
    column one off (``dQ`` on A's neighbour, C as X-error)."""
    ds = _books(corpus_dir, "origin/Fixed Lambdas SI.opju")["PNRNbAl200nm"]
    md = ds.metadata  # type: ignore[attr-defined]
    assert md["x_column_long"] == "Q"
    des = md["column_designations"]
    assert (des["A"], des["B"], des["C"], des["D"]) == ("X", "X-error", "Y", "Y-error")
    assert _label_of(ds, "C") == ("R++", "arb. units")
    assert _label_of(ds, "D")[0] == "dR++"


@pytest.mark.realdata
def test_realdata_reordered_sheets_take_their_own_labels(corpus_dir: Path) -> None:
    """COM, ``Discretewithsum`` book Mid1: window order is ``Mid1_A@2``
    (sheet 1, column G ``weighted TEMP``) then ``Mid1_A`` (sheet 2, G
    ``normalization factor``) -- the user moved a sheet. Main gave the
    first window's labels to ``Mid1`` (sheet ``@1``)."""
    rel = "origin/public/Swicano_Origin_scripts/Heat transfer simulation stuff/Discretewithsum.opju"
    books = _books(corpus_dir, rel)
    assert _label_of(books["Mid1"], "G")[0] == "normalization factor"
    assert _label_of(books["Mid1@2"], "G")[0] == "weighted TEMP"

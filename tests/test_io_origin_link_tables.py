"""Origin "link table" classification (``origin_project/link_tables``).

Synthetic positive/negative controls; the corpus check is
``test_io_origin_link_tables_realdata``. Ledger F-118.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from quantized.datastruct import DataStruct
from quantized.io.origin_project import drop_empty_library_books
from quantized.io.origin_project.link_tables import (
    LINK_TABLE_KEY,
    is_origin_link_table,
    mark_link_tables,
)

_LINK = "cell://[Book1]FitLinear1!Parameters.Slope.Value+Error"


def _book(
    text: dict[str, list[str]] | None,
    *,
    values: list[list[float]] | None = None,
    **meta: Any,
) -> DataStruct:
    if values:
        arr = np.asarray(values, dtype=float)
        labels = [f"c{i}" for i in range(arr.shape[1])]
        time = np.arange(arr.shape[0], dtype=float)
    else:
        arr = np.empty((0, 0))
        labels = []
        time = np.empty(0)
    md: dict[str, Any] = {"origin_book": "Table1", **meta}
    if text is not None:
        md["origin_text_columns"] = text
    return DataStruct.create(time, arr, labels=labels, units=[""] * len(labels), metadata=md)


def _fit_table() -> DataStruct:
    return _book(
        {
            "A": [_LINK + ".row_label", "Intercept", "Slope"],
            "B": [_LINK, _LINK, _LINK],
        }
    )


def test_fit_link_table_is_classified() -> None:
    assert is_origin_link_table(_fit_table())


def test_non_ascii_row_labels_are_classified() -> None:
    book = _book({"A": [_LINK, "截距", "斜率"], "B": [_LINK, _LINK, _LINK]})
    assert is_origin_link_table(book)


def test_empty_cells_are_ignored() -> None:
    book = _book({"A": [_LINK, "", "  "], "B": ["", "", _LINK]})
    assert is_origin_link_table(book)


def test_mark_stamps_only_link_tables_and_keeps_every_book() -> None:
    plain = _book({"A": ["alpha", "beta"]})
    out = mark_link_tables([_fit_table(), plain])
    assert len(out) == 2
    assert out[0].metadata[LINK_TABLE_KEY] is True
    assert LINK_TABLE_KEY not in out[1].metadata
    # nothing is rewritten: the link cells are untouched
    assert out[0].metadata["origin_text_columns"] == _fit_table().metadata["origin_text_columns"]


def test_marked_books_survive_the_library_gate() -> None:
    out = drop_empty_library_books(mark_link_tables([_fit_table()]))
    assert len(out) == 1 and out[0].metadata[LINK_TABLE_KEY] is True


# --- negative controls -----------------------------------------------------


def test_text_book_with_incidental_link_string_is_not_classified() -> None:
    book = _book(
        {"A": ["Sample notes for the run", "see cell://x for details", "done"]},
    )
    assert not is_origin_link_table(book)


def test_prose_cell_in_a_link_row_is_not_classified() -> None:
    long_note = "this is a free-text comment that is clearly not a row label"
    book = _book({"A": [long_note, "Slope"], "B": [_LINK, _LINK]})
    assert not is_origin_link_table(book)


def test_label_in_a_row_without_a_link_is_not_classified() -> None:
    book = _book({"A": ["Intercept", "Slope"], "B": [_LINK, ""]})
    assert not is_origin_link_table(book)


def test_link_beside_real_data_is_not_classified() -> None:
    book = _book({"A": [_LINK, "Slope"], "B": [_LINK, _LINK]}, values=[[1.0, 2.0], [3.0, 4.0]])
    assert not is_origin_link_table(book)


def test_book_without_any_link_is_not_classified() -> None:
    assert not is_origin_link_table(_book({"A": ["Intercept", "Slope"]}))


def test_book_without_text_columns_is_not_classified() -> None:
    assert not is_origin_link_table(_book(None))
    assert not is_origin_link_table(_book({}))


def test_matrix_book_is_not_classified() -> None:
    assert not is_origin_link_table(_book({"A": [_LINK]}, origin_matrix={"rows": 1}))


def test_flag_survives_serialisation_to_the_frontend() -> None:
    (marked,) = mark_link_tables([_fit_table()])
    payload = marked.to_dict()
    assert payload["metadata"][LINK_TABLE_KEY] is True
    assert DataStruct.from_dict(payload).metadata[LINK_TABLE_KEY] is True

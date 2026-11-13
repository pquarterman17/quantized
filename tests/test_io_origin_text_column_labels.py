"""A text column's Long Name / Unit ride beside its cells.

Origin-replacement live check: the worksheet header named Origin text
columns by their short names (A/B) while Origin shows their Long Names. A
text column is not a channel, so its labels have no slot in ``.labels`` /
``.units``; ``metadata["origin_text_column_labels"]`` carries them (the
decoded column record, unchanged -- no parse rule involved).
"""

from __future__ import annotations

import numpy as np

from quantized.io.origin_project.opj import _build_book
from quantized.io.origin_project.windows import BookMeta, ColumnMeta


def test_text_column_long_name_and_unit_are_kept_beside_the_cells() -> None:
    books_meta = {
        "Book2": BookMeta(
            short="Book2",
            long_name="Samples",
            columns={
                "A": ColumnMeta("A", "X", long_name="Temperature", unit="K"),
                "B": ColumnMeta("B", "Y", long_name="LN1"),
                "C": ColumnMeta("C", "Y", long_name="LN2", unit="µm"),
                "D": ColumnMeta("D", "Y"),
            },
        )
    }
    ds = _build_book(
        "Book2",
        [("A", np.array([1.0, 2.0]))],
        books_meta,
        [],
        text_cols=[("B", ["a", "b"]), ("C", ["c", "d"]), ("D", ["e", "f"])],
    )
    assert ds.metadata["origin_text_columns"] == {"B": ["a", "b"], "C": ["c", "d"], "D": ["e", "f"]}
    assert ds.metadata["origin_text_column_labels"] == {
        "B": {"long_name": "LN1", "unit": ""},
        "C": {"long_name": "LN2", "unit": "µm"},
    }


def test_no_text_columns_no_labels_key() -> None:
    books_meta = {"Book1": BookMeta("Book1", "B", {"A": ColumnMeta("A", "X")})}
    ds = _build_book("Book1", [("A", np.array([1.0]))], books_meta, [])
    assert "origin_text_column_labels" not in ds.metadata

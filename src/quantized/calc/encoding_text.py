"""Text-column factors for the P1.4 encodings (PRIMARY_SOFTWARE_AUDIT_PLAN P1.4
residual 5) -- the export half.

A row-indexed text column (``metadata["text_columns"]``, else Origin's
``metadata["origin_text_columns"]``: ``{short name: [cell per row]}``) has no
channel index, so the Graph Builder picks it BY NAME. The request names the
picked columns in order (``FigureEncoding.text_columns``) and indexes them past
the dataset's own channels (``n + i``); :func:`append_text_factors` appends each
as a categorical channel so :func:`quantized.calc.plotting_encoded.
build_encoded_series` splits and labels by it like any other factor.

Faithful port of the frontend's ``lib/plotEncoding.ts`` ``encodingData`` (and
``lib/columnmeta.ts``'s ``text_columns ?? origin_text_columns`` lookup): a
column's levels are its distinct trimmed cells in order of first appearance; a
blank or missing cell is NaN, so its row joins no level. Pinned against the
screen by ``tests/fixtures/wire/graph_encoding_gradient.json``. Pure: arrays in,
a new ``DataStruct`` out.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np

from quantized.datastruct import DataStruct

__all__ = ["append_text_factors", "text_column_cells"]


def text_column_cells(ds: DataStruct, name: str) -> list[Any] | None:
    """One text column's cells by short name, or ``None`` when the sheet has
    no such column -- ``text_columns`` wins over ``origin_text_columns`` when
    present at all (JavaScript's ``??``)."""
    raw = ds.metadata.get("text_columns")
    if raw is None:
        raw = ds.metadata.get("origin_text_columns")
    if not isinstance(raw, Mapping):
        return None
    cells = raw.get(name)
    return list(cells) if isinstance(cells, list) else None


def _cell_text(cell: Any) -> str:
    """``String(cell).trim()`` for the cell types a text column holds."""
    if cell is None:
        return ""
    if isinstance(cell, bool):
        return "true" if cell else "false"
    if isinstance(cell, float) and cell.is_integer():
        return str(int(cell))
    return str(cell).strip()


def append_text_factors(ds: DataStruct, names: Sequence[str]) -> DataStruct:
    """``ds`` with each named text column appended as a categorical channel,
    in order (see the module doc). Raises ``ValueError`` for a name the sheet
    does not carry -- the route's usual 422."""
    if not names:
        return ds
    n_rows, n = ds.values.shape
    columns: list[list[float]] = []
    cat_levels: dict[int, tuple[str, ...]] = dict(ds.cat_levels or {})
    for i, name in enumerate(names):
        cells = text_column_cells(ds, name)
        if cells is None:
            raise ValueError(f"text column {name!r} is not in this dataset")
        levels: list[str] = []
        codes: list[float] = []
        for r in range(n_rows):
            text = _cell_text(cells[r]) if r < len(cells) else ""
            if not text:
                codes.append(float("nan"))
                continue
            if text not in levels:
                levels.append(text)
            codes.append(float(levels.index(text)))
        columns.append(codes)
        if levels:
            cat_levels[n + i] = tuple(levels)
    values = np.column_stack([ds.values, np.asarray(columns, dtype=float).T])
    return DataStruct.create(
        time=ds.time,
        values=values,
        labels=[*ds.labels, *names],
        units=[*ds.units, *([""] * len(names))],
        metadata=ds.metadata,
        cat_levels=cat_levels,
        level_order=ds.level_order,
    )

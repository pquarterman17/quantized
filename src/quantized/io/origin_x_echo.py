"""The value channel that only repeats an Origin book's X column.

A matrix book read as X/Y/Z (``io/origin_project``) carries its X both as
``DataStruct.time`` and as the value channel ``"X"``. The ``.ogs`` writer
always writes ``time`` as worksheet column 1, so writing that channel too
put X in the worksheet twice (the second copy designated Y).

Only that Origin-book case is recognised: the dataset comes from an Origin
import (``origin_book`` in metadata), the channel's label is the book's X
column name (``x_column_name``), and its values equal ``time`` exactly. A
worksheet column that merely holds the same numbers under another name is a
real column and stays (``DO.opj``'s ``H`` equals its ``A`` row for row).
Every other dataset — the MATLAB-golden XRDML export among them — keeps all
of its channels.
"""

from __future__ import annotations

import numpy as np

from quantized.datastruct import DataStruct
from quantized.io.origin_graph import GraphSpec

__all__ = ["kept_channels", "remap_graph"]


def _echo_channel(data: DataStruct) -> int | None:
    meta = data.metadata
    x_name = meta.get("x_column_name")
    if not meta.get("origin_book") or not isinstance(x_name, str) or not x_name:
        return None
    time = np.asarray(data.time, dtype=float)
    values = np.asarray(data.values, dtype=float)
    for i, label in enumerate(data.labels):
        if label == x_name and np.array_equal(values[:, i], time, equal_nan=True):
            return i
    return None


def kept_channels(data: DataStruct) -> list[int]:
    """Value-channel indices to write: all of them, less an X echo."""
    echo = _echo_channel(data)
    return [i for i in range(len(data.labels)) if i != echo]


def remap_graph(graph: GraphSpec, keep: list[int], n_channels: int) -> GraphSpec:
    """``graph`` with its channel indices renumbered onto ``keep``. A key on
    a dropped channel means "X": as ``x_key`` it becomes the X column
    (``None``), as a Y it is left out."""
    if len(keep) == n_channels:
        return graph  # nothing dropped: the indices stand as given
    new = {old: k for k, old in enumerate(keep)}

    def ys(keys: tuple[int, ...]) -> tuple[int, ...]:
        return tuple(new[k] for k in keys if k in new)

    return GraphSpec(
        y_keys=None if graph.y_keys is None else ys(graph.y_keys),
        x_key=None if graph.x_key is None else new.get(graph.x_key),
        x_log=graph.x_log,
        y_log=graph.y_log,
        x_lim=graph.x_lim,
        y_lim=graph.y_lim,
        y2_keys=ys(graph.y2_keys),
        x_reversed=graph.x_reversed,
    )

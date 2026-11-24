"""2-D maps for the converter: recognise one, and recover its grid.

A map DataStruct (``io/_map_schema.py``) is a point cloud, one row per pixel
per frame, with ``metadata.is2D`` and ``map_shape = [n_frames, n_pixels]``
(rows run frame-outer, pixel-inner). Flat formats write exactly those rows (a
lossless long table); containers also keep the 2-D shape, which this module
rebuilds: each channel reshaped to ``map_shape``, and -- for NeXus -- the
channels that are really 1-D axes (constant along the other dimension)
recognised, so a reader can plot the map against them. Pure ``io``.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.datastruct import DataStruct

__all__ = ["grid_axes", "is_map", "map_grid", "signal_channel", "time_is_channel"]


def is_map(ds: DataStruct) -> bool:
    """A 2-D map: ``metadata.is2D`` is true."""
    return ds.metadata.get("is2D") is True


def time_is_channel(ds: DataStruct) -> bool:
    """Is ``ds.time`` a copy of one of its value channels (as a map's is)?"""
    return any(
        np.array_equal(ds.time, ds.values[:, c], equal_nan=True) for c in range(ds.n_channels)
    )


def map_grid(ds: DataStruct) -> dict[str, NDArray[np.float64]] | None:
    """``{channel label: (n_frames, n_pixels) array}``, or ``None`` when ``ds``
    is not a map or its ``map_shape`` does not match its row count (a map whose
    shape cannot be vouched for is written as its rows only, never reshaped)."""
    if not is_map(ds):
        return None
    shape: Any = ds.metadata.get("map_shape")
    try:
        nf, mp = (int(shape[0]), int(shape[1]))
    except (TypeError, ValueError, IndexError):
        return None
    if nf < 1 or mp < 1 or nf * mp != ds.n_points:
        return None
    return {
        label: np.asarray(ds.values[:, c], dtype=float).reshape(nf, mp)
        for c, label in enumerate(ds.labels)
    }


def signal_channel(ds: DataStruct) -> str:
    """The channel a plot of the dataset shows: the parser's first default
    value channel, else ``Intensity``, else the first channel."""
    hint = ds.metadata.get("default_value_channels")
    if isinstance(hint, list) and hint:
        try:
            return ds.labels[int(hint[0])]
        except (TypeError, ValueError, IndexError):
            pass
    return "Intensity" if "Intensity" in ds.labels else ds.labels[0]


def grid_axes(grid: dict[str, NDArray[np.float64]], signal: str) -> tuple[str | None, str | None]:
    """``(axis for dimension 0, axis for dimension 1)``: the first channel (not
    ``signal``) constant along the other dimension -- a frame-wise value (omega)
    is an axis of dimension 0, a pixel-wise one (2theta, the same in every
    frame) of dimension 1. ``None`` where no channel qualifies."""
    ax0: str | None = None
    ax1: str | None = None
    for label, g in grid.items():
        if label == signal:
            continue
        const_along_pixels = bool(np.array_equal(g, g[:, :1] * np.ones_like(g), equal_nan=True))
        const_along_frames = bool(np.array_equal(g, g[:1, :] * np.ones_like(g), equal_nan=True))
        if const_along_pixels and not const_along_frames and ax0 is None:
            ax0 = label
        elif const_along_frames and not const_along_pixels and ax1 is None:
            ax1 = label
    return ax0, ax1

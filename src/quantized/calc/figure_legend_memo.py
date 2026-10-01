"""Score a ``loc="best"`` legend once per layout, not once per placement.

matplotlib's ``Legend._find_best_position`` scores each of its 9 candidate
boxes against every plotted vertex (O(n) per series per box), and it runs
EVERY time the legend is placed: one export placed it 5 times (``tight_layout``
once, then ``savefig``'s layout and draw passes four more at an unchanged
layout). Perf audit 2026-10-01: at 1M rows x 5 series that was 9.5 s of a
10.2 s SVG render.

``memoize_best_legends`` wraps that method for the duration of a render scope
and caches its answer on the legend, keyed by a digest of EVERYTHING the
scoring reads: the legend box size, its anchor box and pad, and the display
coordinates of every line, patch, collection offset and text box it scores
against (``Legend._auto_legend_data``, the method's own input). A changed
layout, dpi, axis limit or data value changes the digest and is rescored, so
the result is exactly what matplotlib computes; only an identical repeat is
skipped. The digest costs one transform plus one hash pass per series, against
the 18 O(n) passes per series a scoring costs.

Pure layer: no fastapi/pydantic.
"""

from __future__ import annotations

import hashlib
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import Any

import numpy as np
from matplotlib.legend import Legend

__all__ = ["memoize_best_legends"]

_CACHE_ATTR = "_qz_best_position_cache"
_MARK = "_qz_best_position_memo"
# Private matplotlib names (3.11), read by string so a release that renames
# them disables the memo instead of breaking every render.
_METHOD = "_find_best_position"
_INPUTS = "_auto_legend_data"


def _digest(legend: Legend, width: float, height: float, renderer: Any) -> bytes:
    bboxes, lines, offsets = getattr(legend, _INPUTS)(renderer)
    h = hashlib.blake2b(digest_size=16)
    pad = legend.borderaxespad * renderer.points_to_pixels(legend.prop.get_size_in_points())
    head = [width, height, pad, *legend.get_bbox_to_anchor().bounds]
    h.update(np.asarray(head, dtype=np.float64).tobytes())
    for box in bboxes:
        h.update(b"b" + np.asarray(box.bounds, dtype=np.float64).tobytes())
    for path in lines:
        verts = np.ascontiguousarray(path.vertices, dtype=np.float64)
        h.update(b"l" + np.asarray(verts.shape, dtype=np.int64).tobytes() + verts.tobytes())
        if path.codes is not None:
            h.update(b"c" + np.ascontiguousarray(path.codes).tobytes())
    if len(offsets):
        h.update(b"o" + np.ascontiguousarray(np.asarray(offsets, dtype=np.float64)).tobytes())
    return h.digest()


def _memoized(original: Callable[..., tuple[float, float]]) -> Callable[..., tuple[float, float]]:
    def find_best_position(
        self: Legend, width: float, height: float, renderer: Any
    ) -> tuple[float, float]:
        key = _digest(self, width, height, renderer)
        cache: dict[bytes, tuple[float, float]] = self.__dict__.setdefault(_CACHE_ATTR, {})
        hit = cache.get(key)
        if hit is None:
            hit = cache[key] = original(self, width, height, renderer)
        return hit

    setattr(find_best_position, _MARK, True)
    return find_best_position


@contextmanager
def memoize_best_legends() -> Iterator[None]:
    """Install the memo on ``Legend`` for the duration of the block.

    Called from ``figure_render.render_scope`` with ``RENDER_LOCK`` held, so
    no other render can observe the swap. A nested scope finds the memo
    already installed and leaves it alone; only the scope that installed it
    restores the original.
    """
    current = getattr(Legend, _METHOD, None)
    if current is None or not hasattr(Legend, _INPUTS) or getattr(current, _MARK, False):
        yield
        return
    setattr(Legend, _METHOD, _memoized(current))
    try:
        yield
    finally:
        setattr(Legend, _METHOD, current)

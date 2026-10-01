"""Waterfall X offset -- the export half (audit "waterfall settings beyond the
scalar offset"; FIGURE_AUTHORING_WORKFLOW_PLAN F4.2b).

Origin's waterfall has both an X and a Y offset; series ``i`` slides right by
``i * dx``. A figure's series share ONE x array, so the shift cannot be a
per-series x column: ``calc.plot_waterfall_x.apply_waterfall_x_offsets`` lays
the figure out the way the canvas does (``frontend/src/lib/waterfallX.ts``) --
one x BLOCK per series, ``x + offset_i``, with each series' values (and its
error spans and colour-by column) inside its own block and NaN elsewhere. The
renderer then draws each series at its own shifted x unchanged. The
cross-language screen == export check is ``test_export_waterfall_x.py``.
"""

from __future__ import annotations

import numpy as np

from quantized.calc.plot_waterfall_x import apply_waterfall_x_offsets

X = np.array([0.0, 1.0, 2.0])
SERIES = [("a", np.array([1.0, 2.0, 3.0])), ("b", np.array([4.0, 5.0, 6.0]))]


def _finite(values: object) -> list[float]:
    arr = np.asarray(values, dtype=float)
    return [float(v) for v in arr[np.isfinite(arr)]]


def test_no_offsets_is_a_passthrough() -> None:
    for offsets in (None, [], [0.0, 0.0], [float("nan"), 0.0]):
        x, series, styles, spans = apply_waterfall_x_offsets(X, SERIES, None, None, offsets)
        assert x is X
        assert [s[1] for s in series] == [s[1] for s in SERIES]
        assert styles is None and spans is None


def test_each_series_draws_at_its_own_shifted_x() -> None:
    x, series, _styles, _spans = apply_waterfall_x_offsets(X, SERIES, None, None, [0.0, 0.5])
    assert x.tolist() == [0.0, 1.0, 2.0, 0.5, 1.5, 2.5]
    a = np.asarray(series[0][1], dtype=float)
    b = np.asarray(series[1][1], dtype=float)
    # Series a lives in block 0, b in block 1; NaN breaks each line elsewhere.
    assert _finite(x[np.isfinite(a)]) == [0.0, 1.0, 2.0] and _finite(a) == [1.0, 2.0, 3.0]
    assert _finite(x[np.isfinite(b)]) == [0.5, 1.5, 2.5] and _finite(b) == [4.0, 5.0, 6.0]
    assert [s[0] for s in series] == ["a", "b"]


def test_a_missing_or_non_finite_offset_is_zero() -> None:
    x, series, _st, _sp = apply_waterfall_x_offsets(X, SERIES, None, None, [float("inf"), 2.0, 9.0])
    assert x.tolist() == [0.0, 1.0, 2.0, 2.0, 3.0, 4.0]
    assert len(series) == 2


def test_error_spans_and_colour_by_follow_their_series_block() -> None:
    styles = [None, {"color_by": [7.0, 8.0, 9.0], "marker": "o"}]
    spans = [{"y": {"plus": [0.1, 0.2, 0.3], "minus": [0.1, 0.2, 0.3]}}, None]
    _x, _s, out_styles, out_spans = apply_waterfall_x_offsets(X, SERIES, styles, spans, [0.0, 1.0])
    assert out_styles is not None and out_spans is not None
    assert out_styles[0] is None and out_spans[1] is None
    cb = out_styles[1]
    assert cb is not None and cb["marker"] == "o"
    assert _finite(cb["color_by"][3:]) == [7.0, 8.0, 9.0] and _finite(cb["color_by"][:3]) == []
    plus = out_spans[0]["y"]["plus"]
    assert plus[:3] == [0.1, 0.2, 0.3] and plus[3:] == [None, None, None]
    # The caller's dicts are never mutated.
    assert styles[1]["color_by"] == [7.0, 8.0, 9.0] and len(spans[0]["y"]["plus"]) == 3

"""``.opju`` double-Y right layer: an axis-record separator ending ``09``
(``opju_axis_sep_last``; plans/ORIGIN_PLOT_TYPE_PARITY_PLAN.md item 5).

The bytes are copied from a plot-corpus specimen Origin 2026b built from
synthetic data (``double_y/clean``, ``worksheet -p ? DOUBLEY``); Origin's own
``layer.x/y.from/to`` for both layers are the expected values.
"""

from __future__ import annotations

from quantized.io.origin_project.opju_axis_real_form import (
    _SEP_STRICT,
    _SEP_WIDE,
    _parse_real_record,
    _parse_real_record_sep,
)

# Layer 1 (left Y): separators end ``... 00 01``.
_LAYER1 = bytes.fromhex(
    "0300001f89c33303d3bf9ac299022440840140810d08000001c3f5285c8f425d4001"
    "8502d03f83020a408302e03f81350800000114ae47e17a9457c00100001010"
)
# Layer 2 (right Y) of the same graph: its first separator ends ``... 00 09``.
_LAYER2 = bytes.fromhex(
    "0300001f89c33303d3bf9ac299022440840140811008000009c3f5285c8f425d40010000"
    "9ac29903d93f9ac29903f93f9ac29902c93f81350800000114ae47e17a9457c00100001020"
)


def test_left_layer_parses_in_the_strict_pass() -> None:
    got = _parse_real_record(_LAYER1, 4, len(_LAYER1))
    assert got is not None
    assert got[:4] == (-0.3, 10.3, 0.25, 3.25)


def test_right_layer_separator_ending_09_decodes_to_origins_axes() -> None:
    # neither earlier pass reaches it ...
    for sep, every in ((_SEP_STRICT, False), (_SEP_WIDE, True)):
        assert _parse_real_record_sep(_LAYER2, 4, len(_LAYER2), sep, every=every) is None
    # ... the third pass reads Origin's layer 2: X -0.3..10.3, Y 0.4..1.6
    got = _parse_real_record(_LAYER2, 4, len(_LAYER2))
    assert got is not None
    assert got[:4] == (-0.3, 10.3, 0.4, 1.6)
    assert got[6:] == (2.0, 0.2)  # tick increments

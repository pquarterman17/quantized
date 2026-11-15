"""``.opju`` layer ordinal ignores coincidental ``03 00 00 1f`` matches.

Every real layer anchor follows its record-length varint (``b9 01``). A bare
4-byte match without it (an id table ``03 00 00 1f 03 00 00 20 ...``) is not a
layer; counting it shifted every later layer of the page (measured on a real
project: layers 10 and 11 of a page were an id table, and the real 10th layer
was numbered 12). Origin 2026b oracle: 2,752/2,752 real anchors carry the
prefix; the only two anchor-count mismatches (``SOP_meas`` Graph6,
``histogram_released_viruses`` Graph1) are bare matches.
"""

from __future__ import annotations

import pytest

from quantized.io.origin_project.figure_geometry import opju_anchor_has_length_prefix
from quantized.io.origin_project.figures_opju import extract_figures_opju
from test_io_origin_figures_opju import _column_id_record, _layer_bytes
from test_io_origin_opju_page_attribution import _header

_TEXT = r"\l(1) %(1)"
_PREFIX = b"\xb9\x01"  # record-length varint: 185


def _layer(x_to: float) -> bytes:
    return _layer_bytes(0.0, x_to, 0.0, 100.0, 20.0, 0x03, _TEXT)


def _project(*page_body: bytes) -> bytes:
    recs = _column_id_record(1, "A", "X") + _column_id_record(2, "B", "Y", partner=1)
    return (
        b"CPYUA 4.3811 222\n"
        + _header("WBook", b"\x7a")
        + recs
        + _header("Graph1", b"\x7b")
        + b"".join(page_body)
    )


@pytest.mark.parametrize(
    ("pre", "want"),
    [
        (b"\xb9\x01", True),  # 2-byte varint
        (b"\x80\x7f", True),
        (b"\xc0\xff", False),  # run escape / high final byte
        (b"\x00\x1e", False),
        (b"\x06\x62", False),  # no continuation bit
        (b"\xb9\x00", False),  # a varint never ends in a 0 final byte here
    ],
)
def test_length_prefix_predicate(pre: bytes, want: bool) -> None:
    assert opju_anchor_has_length_prefix(pre + b"\x03\x00\x00\x1f", 2) is want


def test_length_prefix_predicate_at_stream_start() -> None:
    assert opju_anchor_has_length_prefix(b"\x03\x00\x00\x1f", 0) is False


def test_coincidental_anchor_does_not_shift_later_layers() -> None:
    """Layers 1 and 2 are real; the bare match between them is an id table.
    The second real layer is layer 2 (it was 3)."""
    bare = b"\x03\x00\x00\x1f" + b"\x03\x00\x00\x20" * 3 + b"\x00" * 8
    figs = extract_figures_opju(
        _project(_PREFIX + _layer(9.0), b"\xc0\xff" + bare, _PREFIX + _layer(5.0))
    )
    assert [(f["name"], f["layer"], f["x_to"]) for f in figs] == [
        ("Graph1", 1, 9.0),
        ("Graph1", 2, 5.0),
    ]


def test_undecodable_real_anchor_still_leaves_a_gap() -> None:
    """A real (prefixed) anchor whose record does not decode keeps its ordinal."""
    garbage = _PREFIX + b"\x03\x00\x00\x1f" + b"\xff" * 48
    figs = extract_figures_opju(_project(garbage, _PREFIX + _layer(5.0)))
    assert [(f["name"], f["layer"]) for f in figs] == [("Graph1", 2)]


def test_page_without_any_prefixed_anchor_counts_every_match() -> None:
    """Legacy/synthetic streams carry no prefix at all: unchanged numbering."""
    figs = extract_figures_opju(_project(_layer(9.0), _layer(5.0)))
    assert [(f["name"], f["layer"]) for f in figs] == [("Graph1", 1), ("Graph1", 2)]

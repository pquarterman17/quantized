"""``.opju`` axis records cut off mid-record never raise, and never cost other figures.

``routes/_originfigures`` replaces a project's WHOLE figure list with ``[]`` when
``extract_figures_opju`` raises, so one truncated record (a partial upload, a
cut stream) used to hide every graph in the project. The specimen-form guard for
``7b 40 <value tag>`` indexed ``b[tb + 3]`` after slice-checking only ``b[tb+1:tb+3]``
and raised when the stream ended right after ``7b 40``.
"""

from __future__ import annotations

import pytest

from quantized.io.origin_project.figures_opju import extract_figures_opju
from quantized.io.origin_project.opju_axis_real_form import _STEP_TAG, _Y_TRANSITION
from quantized.io.origin_project.opju_axis_specimen_form import parse_hybrid_record
from test_io_origin_figures_opju import _layer_bytes

_ANCHOR = b"\x03\x00\x00\x1f"
_X_SPAN = b"\x83\x02\x00\x40"  # tagged compact: 2.0
_HEAD = b"CPYUA 4.3811 222\n"
_TEXT = r"\l(1) %(1)"


def _good_layer() -> bytes:
    return _layer_bytes(0.0, 9.0, 0.0, 1000.0, 200.0, 0x03, _TEXT)


def _cut_record(tail: bytes) -> bytes:
    """An anchor + X span + step + Y-transition + type byte + ``tail``, then EOF."""
    return _ANCHOR + _X_SPAN + _STEP_TAG + _Y_TRANSITION + b"\x02" + tail


@pytest.mark.parametrize(
    "tail",
    [b"", b"\x7b", b"\x7b\x40", b"\x7b\x40\x01", b"\x7b\x40\x08", b"\x7b\x40\x83"],
)
def test_record_truncated_after_type_byte_keeps_other_figures(tail: bytes) -> None:
    """The stream ends right after ``7b 40`` (and every nearby cut): the intact
    layer before it is still returned."""
    figs = extract_figures_opju(_HEAD + _good_layer() + _cut_record(tail))
    assert len(figs) == 1
    assert (figs[0]["x_to"], figs[0]["y_to"]) == (9.0, 1000.0)


def test_every_prefix_of_a_two_layer_project_decodes_without_raising() -> None:
    """Cut the second layer at EVERY byte: never an exception, and the first
    layer always survives."""
    first = _good_layer()
    blob = _HEAD + first + _good_layer()
    for cut in range(len(_HEAD) + len(first), len(blob)):
        figs = extract_figures_opju(blob[:cut])
        assert figs and figs[0]["x_to"] == 9.0, cut


@pytest.mark.parametrize("tail", [b"\x7b\x40", b"\x7b\x40\x83"])
def test_hybrid_parser_rejects_a_filler_tag_and_a_cut_stream(tail: bytes) -> None:
    """``7b 40 <81..8f tag>``: the +3 filler skip would eat the Y tag, so the
    hybrid parser (like the specimen form) declines instead of guessing a Y; a
    stream ending after ``7b 40`` is a clean ``None``, not an ``IndexError``."""
    b = _cut_record(tail)
    assert parse_hybrid_record(b, len(_ANCHOR)) is None

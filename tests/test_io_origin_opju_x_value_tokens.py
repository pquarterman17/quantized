"""``.opju`` X-span first-value grammar: length-headed first value + 1-byte flag.

Two X-span misreads pinned earlier as "value-token defects" were one mechanism
(see ``docs/origin_project_format.md``, "X-span value-token grammar"): the bytes
in front of the first X value were skipped by a fixed 2-byte rule and the value
bytes re-split by an exact-fill search that prefers three tokens over two.

* ``9T nn <nn bytes>`` with ``T + nn == 9`` (``96 03``, ``97 02``): the first X
  value is ONE ``nn``-byte compact token. ``96 03 80 56 40`` is 90 (Origin's
  ``layer.x.to``), not ``80`` + ``56 40`` = ``-0.0``, 88.
* A single ``81..9f`` flag byte before a run-first RLE value (``89 c3 ff 02 ef
  3f`` = 0.9999999999999999, Origin 1.0), previously ``91`` only.

Synthetic bytes lock the proven grammar; the proof is the whole-corpus run
against Origin 2026b COM (``test_io_origin_opju_page_attribution``).
"""

from __future__ import annotations

import pytest

from quantized.io.origin_project.figures_opju import extract_figures_opju
from test_io_origin_figures_opju import _real_form_tagged_and_rle

_ORIGINAL_X = b"\x89\x01" b"\x9a\xc2\x99\x02\xc9\x3f" b"\x84\x01\x40" b"\x83\x02\xe0\x3f"
_ANCHOR = b"\x03\x00\x00\x1f"


def _with_x(x_span: bytes) -> bytes:
    """The shared RockingCurve-shaped record with its X span replaced."""
    rec = _real_form_tagged_and_rle()
    assert _ANCHOR + _ORIGINAL_X in rec
    return b"CPYUA 4.3811 222\n" + rec.replace(_ANCHOR + _ORIGINAL_X, _ANCHOR + x_span)


def _x(x_span: bytes) -> tuple[float, float] | None:
    figs = extract_figures_opju(_with_x(x_span))
    if not figs:
        return None
    assert len(figs) == 1
    return (figs[0]["x_from"], figs[0]["x_to"])


@pytest.mark.parametrize(
    ("x_span", "want"),
    [
        # SOP_meas Graph3: three bytes 0x405680 = 90, step 10, from elided
        (b"\x96\x03\x80\x56\x40" b"\x83\x02\x24\x40", (0.0, 90.0)),
        # SOP_meas Graph24 / Graph12 / Graph58 (130, 140, 2000)
        (b"\x96\x03\x40\x60\x40" b"\x83\x02\x34\x40", (0.0, 130.0)),
        (b"\x96\x03\x80\x61\x40" b"\x83\x02\x34\x40", (0.0, 140.0)),
        (b"\x96\x03\x40\x9f\x40" b"\x82\x03\x40\x8f\x40", (0.0, 2000.0)),
        # two-byte form: 97 02 3f 40 = 31 (was read [3.05e-5, 2.0])
        (b"\x97\x02\x3f\x40" b"\x83\x02\x14\x40", (0.0, 31.0)),
        (b"\x97\x02\x59\x40" b"\x83\x02\x34\x40", (0.0, 100.0)),
    ],
)
def test_length_headed_first_x_value_is_one_token(
    x_span: bytes, want: tuple[float, float]
) -> None:
    assert _x(x_span) == want


def test_length_headed_first_value_can_be_x_from() -> None:
    """With a second value token the header-delimited value is ``from``."""
    got = _x(b"\x97\x02\x59\x40" b"\x84\x01\x40" b"\x83\x02\x34\x40")
    assert got == (100.0, 2.0)


@pytest.mark.parametrize(
    "x_span",
    [
        # header present but T + nn != 9: the old 2-byte flag rule applies
        b"\x97\x03\xf0\x3f" b"\x9a\xc2\x99\x02\xc9\x3f",  # Graph15: [0, 1] step 0.2
    ],
)
def test_other_9x_flags_keep_the_two_byte_flag_rule(x_span: bytes) -> None:
    assert _x(x_span) == (0.0, 1.0)


def test_length_header_with_implausible_payload_is_not_a_value() -> None:
    """``96 03 7f ..`` would be 1.6e307: not a value, so the old path (which
    also cannot place it) leaves the layer unrecovered -- never a guess."""
    assert _x(b"\x96\x03\x80\x7f\x7f" b"\x83\x02\x24\x40") is None


def test_single_flag_byte_before_runfirst_rle() -> None:
    """histogram_released_viruses Graph2: ``89 c3 ff 02 ef 3f`` is the double
    ``ff*6 ef 3f`` (0.9999999999999999); Origin reports from = 1.0, to = 4.0."""
    got = _x(b"\x89\xc3\xff\x02\xef\x3f" b"\x83\x02\x10\x40" b"\x83\x02\xf0\x3f")
    assert got == (0.9999999999999999, 4.0)


def test_two_byte_flag_before_tagged_values_is_unchanged() -> None:
    """Negative control: ``89 01`` is still a 2-byte flag (its second byte is
    not a run marker), so the original record decodes as before."""
    assert _x(_ORIGINAL_X) == (pytest.approx(0.2), 2.0)  # type: ignore[comparison-overlap]


def test_flag_byte_before_run_marker_fails_closed_without_exact_fill() -> None:
    """``89 c3`` then bytes that do not complete an RLE value + tokens up to
    the separator: no span, no layer (omitted, never guessed)."""
    assert _x(b"\x89\xc3\xff") is None

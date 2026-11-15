"""``.opju`` axis spans: which endpoint a 0.0 elides, and the specimen step tag.

The axis record is byte-level run-length compressed (``opju_axis_zero_slot``):
``8T nn <nn bytes>`` is a run of ``T + 3`` zero bytes plus ``nn`` literals, so
a 0.0 endpoint merges into the next token's zero run and a span with one zero
endpoint has only two value tokens. Both defects below were found against
Origin 2026b COM ``layer.x/y.from/to`` (``test_io_origin_opju_page_attribution``):

* item 64 -- the decoder always took the elided zero to be ``from``. Figure 6
  Graph3 stores Y (-80, 0): the STEP token's run is 8 zeros longer than its own
  value needs, which is where ``to`` = 0.0 went.
* item 65 -- the specimen parser searched for the ``83 02`` step tag and
  stopped at a ``to`` that happens to encode the same way (``83 02 48 40`` =
  48), reading the span one slot early. The step token must end where the next
  field begins.

Synthetic bytes lock the proven grammar; the proof is the whole-corpus oracle
run (1,777 -> 1,784 match, 7 -> 0 wrong, 0 phantom).
"""

from __future__ import annotations

import pytest

from quantized.io.origin_project.figures_opju import _parse_specimen_record, extract_figures_opju
from quantized.io.origin_project.opju_axis_zero_slot import UnprovenSlot, resolve_elided

_HEAD = b"CPYUA 4.3811 222\n"
_ANCHOR = b"\x03\x00\x00\x1f"
_SEP = b"\x81\x04\x06\x00\x00\x01"
_GEO = b"\xc3\x66\x03\x7b\x40\x01"  # 438.4 geometry double + X-linear flag
_END = b"\x81\x05\x06\x00\x00\x01" b"\x9a\xc1\x99\x2c\x19\x76\xc0\x01\x00\x00" + b"\x00" * 32
_X_0_10 = b"\x97\x02\x24\x40\x84\x01\x40"  # Figure 6 Graph3 layer 9: X (0, 10), step 2


def _axes(x_span: bytes, y_span: bytes) -> tuple[float, float, float, float] | None:
    figs = extract_figures_opju(_HEAD + _ANCHOR + x_span + _SEP + _GEO + y_span + _END)
    if not figs:
        return None
    assert len(figs) == 1
    f = figs[0]
    return (f["x_from"], f["x_to"], f["y_from"], f["y_to"])


# ── item 64: which endpoint the zero is ──────────────────────────────────────


def test_zero_to_rides_in_the_step_run() -> None:
    """Figure 6 Graph3 layer 9: ``85 02 54 c0`` (2 pad + -80's 6 low zeros) then
    ``8b 02 34 40`` (14 zeros = to 0.0 + 20.0's 6). Origin: Y (-80, 0)."""
    assert _axes(_X_0_10, b"\x85\x02\x54\xc0\x8b\x02\x34\x40") == (0.0, 10.0, -80.0, 0.0)


def test_zero_from_keeps_the_historical_reading() -> None:
    """Negative control: the zero is ``from`` (it rides in the FIRST token's
    run) and the step run holds only its own zeros. Y (0, 80)."""
    assert _axes(_X_0_10, b"\x8d\x02\x54\x40\x83\x02\x34\x40") == (0.0, 10.0, 0.0, 80.0)


def test_zero_to_with_a_trailer_step_token() -> None:
    """Figure 6 Graph3 layer 1: the step token carries the next field's byte
    (``8b 03 34 40 04``) before an ``80``-lead separator; same accounting."""
    rec = (
        _HEAD + _ANCHOR + b"\x97\x02\x24\x40\x84\x02\x40\x02" + b"\x80\x04\x08\x00\x00\x01"
        + b"\xc2\x33\x04\x13\x60\x40\x01" + b"\x85\x02\x54\xc0\x8b\x03\x34\x40\x04"
        + b"\x80\x04\x05\x00\x00\x01" + b"\xc2\x11\x34\xd1\x50\xc0\x01\x00\x00" + b"\x00" * 32
    )
    (f,) = extract_figures_opju(rec)
    assert (f["x_from"], f["x_to"], f["y_from"], f["y_to"]) == (0.0, 10.0, -80.0, 0.0)


def test_zero_to_on_the_x_span() -> None:
    """The X span is the same encoding: X (-10, 0) is ``8f 02 24 c0`` (12
    prefix + -10's 6) then ``8c 01 40`` (15 zeros = to 0.0 + 2.0's 7)."""
    got = _axes(b"\x8f\x02\x24\xc0\x8c\x01\x40", b"\x8d\x02\x54\x40\x83\x02\x34\x40")
    assert got == (-10.0, 0.0, 0.0, 80.0)


def test_partial_surplus_fails_closed() -> None:
    """A step run 5 zeros longer than its value needs is neither reading:
    the span is not decoded (never guessed as (0, -80) or (-80, 0))."""
    assert _axes(_X_0_10, b"\x85\x02\x54\xc0\x88\x02\x34\x40") is None


def test_literal_zero_in_the_step_token_is_not_run_surplus() -> None:
    """``83 03 00 34 40``: a 6-zero run + literals ``00 34 40`` (= 20.0). The
    value owns 5 run zeros, so 1 is surplus -- a partial double, unproven.
    Counting the literal ``00`` as a run byte would read surplus 0 and decode
    a confident (0, -80)."""
    assert _axes(_X_0_10, b"\x85\x02\x54\xc0\x83\x03\x00\x34\x40") is None


def test_unproven_slot_declines_the_record_not_just_the_span() -> None:
    with pytest.raises(UnprovenSlot):
        resolve_elided(b"\x88\x02\x34\x40", 4, -80.0, [0], lambda q: [(20.0,)])


def test_disagreeing_fills_fail_closed() -> None:
    """Two fills placing the step token at a run and at a literal: no verdict."""
    with pytest.raises(UnprovenSlot):
        resolve_elided(b"\x8b\x02\x34\x40", 4, -80.0, [0, 1], lambda q: [(20.0,)])


def test_non_run_step_token_means_from_was_zero() -> None:
    """An RLE / bare step token opens with a literal byte: no zero merged."""
    got = resolve_elided(b"\x9a\xc2\x99\x02\xc9\x3f", 6, 0.7, [0], lambda q: [(0.2,)])
    assert got == (0.0, 0.7)


# ── item 65: the specimen step tag must close its span ───────────────────────


def test_to_encoded_like_the_step_tag_is_not_the_step() -> None:
    """OriginLab_Battery_Aging_Project Graph3: X ``8f 02 28 40`` (12),
    ``83 02 48 40`` (48 -- shaped like the step tag), ``84 01 40`` (step 2).
    The specimen parser read X (0, 12); Origin: (12, 48, 10, 90)."""
    x = b"\x8f\x02\x28\x40\x83\x02\x48\x40\x84\x01\x40"
    y = b"\x85\x02\x24\x40\x82\x03\x80\x56\x40\x83\x02\x34\x40"
    rec = _HEAD + _ANCHOR + x + _SEP + _GEO + y + _END
    assert _parse_specimen_record(rec, len(_HEAD) + len(_ANCHOR)) is None
    assert _axes(x, y) == (12.0, 48.0, 10.0, 90.0)


def test_y_to_encoded_like_the_step_tag_is_not_the_step() -> None:
    """Battery Graph2: Y ``85 02 e0 bf`` (-0.5), ``83 02 08 40`` (3.0),
    ``83 02 f0 3f`` (step 1). The specimen parser read Y (0, -0.5); it now
    steps over the tag-shaped ``to`` to the step that closes the span."""
    x = b"\x8f\x02\x39\xc0\x82\x03\x40\x5f\x40\x83\x02\x49\x40"
    y = b"\x85\x02\xe0\xbf\x83\x02\x08\x40\x83\x02\xf0\x3f"
    rec = _HEAD + _ANCHOR + x + _SEP + _GEO + y + _END
    spec = _parse_specimen_record(rec, len(_HEAD) + len(_ANCHOR))
    assert spec is not None and spec[:4] == (-25.0, 125.0, -0.5, 3.0)
    assert _axes(x, y) == (-25.0, 125.0, -0.5, 3.0)

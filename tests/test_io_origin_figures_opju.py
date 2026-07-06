"""``.opju`` (CPYUA) figure extraction — plan items 14 (specimen form) + 33
(real-corpus form).

Two layers, mirroring ``test_io_origin_project.py``'s ``.opj`` figures tests:

* **synthetic** CPYUA-shaped records built in-test (no private data) that
  exercise both the specimen-form and the real-form decoders in CI;
* **realdata**-marked checks against Origin's own ground-truth export for
  the controlled specimens (``fig_lin``/``fig_log``/``fig_pairs``) AND the
  real corpus files (RockingCurve/XAS/UnpolPlots/"Fixed Lambdas SI"), whose
  axis records use the item-33 grammar (optional flag token + tagged/RLE/
  bare value tokens + variable-length separators — see ``figures_opju.py``'s
  module docstring for the solved layout).
"""

from __future__ import annotations

import json
import re
import struct
from pathlib import Path

import pytest

from quantized.io.origin_project.figures_opju import (
    _ANCHOR,
    _STEP_TAG,
    _Y_TRANSITION,
    _clean_annotations,
    drop_nonactionable_figures,
    extract_figures_opju,
)
from quantized.io.origin_project.opju_codec import curve_plot_style

# ── synthetic CPYUA figure-record builder ─────────────────────────────────────


def _pack_compact(value: float, width: int) -> bytes:
    """``width`` significant bytes (BE top-N of the double), stored reversed."""
    return bytes(reversed(struct.pack(">d", value)[:width]))


def _encode_value(value: float) -> bytes:
    """A 2-byte tag + the *smallest* compact width that round-trips exactly,
    falling back to a tag + 8-byte literal — mirroring what the real encoder
    does (compact whole/round numbers, literal for "messy" ones)."""
    for width in (1, 2, 3):
        chunk = _pack_compact(value, width)
        be = bytes(reversed(chunk)) + b"\x00" * (8 - width)
        if struct.unpack(">d", be)[0] == value:
            return b"\x00\x00" + chunk
    return b"\x00\x00" + struct.pack("<d", value)


def _layer_bytes(
    x_from: float,
    x_to: float,
    y_from: float,
    y_to: float,
    y_step: float,
    type_byte: int,
    legend: str,
) -> bytes:
    """One CPYUA axis record: anchor + X ``(from, to)`` + step + the
    Y-transition marker (carries ``type_byte``) + Y ``(from, to)`` + step +
    trailing legend text — the shape ``figures_opju.py`` decodes.

    ``from`` is elided (0 bytes) when exactly 0.0, matching the real
    encoding; every other value is a 2-byte tag + the smallest exact compact
    width, or a tag + 8-byte literal when no compact width round-trips (as
    real "messy" values like the ``fig_log`` specimen's ``1e-9`` do). The two
    leading tag bytes are never decoded by the reader (see the module
    docstring), so any 2 bytes work here.
    """
    out = bytearray(b"\x03\x00\x00\x1f")  # anchor
    out += _encode_value(x_from) if x_from != 0.0 else b""
    out += _encode_value(x_to)
    out += b"\x83\x02" + _pack_compact(1.0, 2)  # X step
    out += b"\x81\x04\x06\x00\x00\x01\xc3\x66"  # Y-transition marker
    out += bytes([type_byte])
    out += b"\x7b\x40\x01"  # fixed filler
    out += _encode_value(y_from) if y_from != 0.0 else b""
    out += _encode_value(y_to)
    out += b"\x83\x02" + _pack_compact(y_step, 2)  # Y step
    out += b"\x81\x05\x06\x00\x00\x01\x9a\xc1"  # trailer (unused by the decoder)
    out += legend.encode("latin1") + b"\r\n"
    out += b"\x00" * 32  # padding so the next anchor search has room
    return bytes(out)


def _synthetic_opju(*layers: bytes) -> bytes:
    return b"CPYUA 4.3811 222\n" + b"".join(layers)


# ── synthetic tests ────────────────────────────────────────────────────────────


def test_synthetic_linear_layer_decodes() -> None:
    blob = _synthetic_opju(
        _layer_bytes(0.0, 9.0, 0.0, 1000.0, 200.0, 0x03, r"\l(1) %(1)")
    )
    figs = extract_figures_opju(blob)
    assert len(figs) == 1
    f = figs[0]
    assert (f["x_from"], f["x_to"]) == (0.0, 9.0)
    assert (f["y_from"], f["y_to"]) == (0.0, 1000.0)
    assert f["y_log"] is False
    assert f["n_curves"] == 1


def test_synthetic_log_type_byte_flags_y_log() -> None:
    """The isolated type-byte flag (0x0d) wins over the decade heuristic."""
    blob = _synthetic_opju(
        _layer_bytes(0.79, 8.22, 1e-9, 1000.0, 1.0, 0x0D, r"\l(1) %(1)")
    )
    figs = extract_figures_opju(blob)
    assert len(figs) == 1
    assert (figs[0]["x_from"], figs[0]["x_to"]) == (0.79, 8.22)
    assert figs[0]["y_log"] is True
    assert figs[0]["x_log"] is False  # X has no isolated flag; falls back to the heuristic


def test_synthetic_unrecognized_type_byte_falls_back_to_heuristic() -> None:
    """An unseen type byte (neither 0x03 nor 0x0d) falls back to the decade
    heuristic, exactly like the .opj decoder does for its unresolved flag."""
    blob = _synthetic_opju(
        _layer_bytes(0.0, 10.0, 0.5, 5e5, 1.0, 0xFF, r"\l(1) %(1)")
    )
    figs = extract_figures_opju(blob)
    assert len(figs) == 1
    assert figs[0]["y_log"] is True  # 5e5/0.5 >= 1e3 -> the shared decade heuristic


def test_synthetic_xlog_type_byte_flags_x_log() -> None:
    """The combined scale byte 0x04 means X-log, Y-lin (pinned from fig_logx):
    X-scale is recovered from the flag, not the heuristic."""
    blob = _synthetic_opju(
        _layer_bytes(0.79, 8.22, 0.0, 1000.0, 200.0, 0x04, r"\l(1) %(1)")
    )
    figs = extract_figures_opju(blob)
    assert len(figs) == 1
    assert figs[0]["x_log"] is True  # 0x04 isolates X-log even though X spans <1 decade
    assert figs[0]["y_log"] is False


def test_axis_scales_mapping() -> None:
    """The combined-flag table, pinned from four controlled specimens; when Y
    is log (0x0d) the byte carries no X info, so X uses the decade heuristic."""
    from quantized.io.origin_project.figures_opju import _axis_scales

    assert _axis_scales(0x03, 1.0, 8.0, 0.0, 1000.0) == (False, False)
    assert _axis_scales(0x04, 1.0, 8.0, 0.0, 1000.0) == (True, False)
    # 0x0d: Y log for sure; X falls to heuristic (here <1 decade -> linear)
    assert _axis_scales(0x0D, 1.0, 8.0, 0.5, 500.0) == (False, True)
    # a many-decade X under Y-log still only reflects the heuristic for X
    assert _axis_scales(0x0D, 1.0, 1e5, 0.5, 500.0) == (True, True)
    # unrecognized byte -> heuristic for both
    assert _axis_scales(0xFF, 0.0, 10.0, 0.5, 5e5) == (False, True)


def test_synthetic_multi_layer_graph_yields_multiple_figures() -> None:
    blob = _synthetic_opju(
        _layer_bytes(0.0, 9.0, 0.0, 1000.0, 200.0, 0x03, r"\l(1) %(1)"),
        _layer_bytes(0.0, 9.0, -100.0, 1200.0, 200.0, 0x03, r"\l(1) %(1)"),
    )
    figs = extract_figures_opju(blob)
    assert len(figs) == 2
    assert (figs[0]["y_from"], figs[0]["y_to"]) == (0.0, 1000.0)
    assert (figs[1]["y_from"], figs[1]["y_to"]) == (-100.0, 1200.0)


def test_figures_absent_without_anchor() -> None:
    assert extract_figures_opju(b"CPYUA 4.3380 188\nno graph markers here") == []


def test_figures_absent_on_incomplete_record() -> None:
    """An anchor with no Y-transition marker within range (e.g. a real-corpus
    graph, or truncated data) drops cleanly instead of guessing."""
    blob = b"CPYUA 4.3811 222\n\x03\x00\x00\x1f" + b"\x00" * 50
    assert extract_figures_opju(blob) == []


def test_y_transition_marker_at_eof_does_not_crash() -> None:
    """A record whose Y-transition marker is the very last bytes of the buffer
    (so there is no type byte after it) must degrade to [] rather than index
    one past the end — this 500'd /import + /upload for truncated .opju files
    before the bounds guard was added."""
    blob = _ANCHOR + struct.pack("<d", 2.0) + _STEP_TAG + _Y_TRANSITION
    assert extract_figures_opju(blob) == []  # must not raise IndexError


# ── synthetic real-corpus-form records (item 33) ──────────────────────────────
#
# These byte layouts replicate — value for value — real anchors from the
# oracle corpus (RockingCurve @55114/@137209, "Fixed Lambdas SI" @567652),
# rebuilt in-test so CI needs no private data.


def _real_form_tagged_and_rle() -> bytes:
    """RockingCurve NbAuRocking: flag ``89 01`` + lead-form RLE x_from (0.2) +
    tagged x_to (2.0) + tagged step, then tagged Y values (1.0 .. 450000)."""
    return (
        b"\x03\x00\x00\x1f"  # anchor
        b"\x89\x01"  # 2-byte flag token
        b"\x9a\xc2\x99\x02\xc9\x3f"  # x_from = 0.2 (lead-form c2 RLE: run of 5)
        b"\x84\x01\x40"  # x_to = 2.0 (tagged compact-1)
        b"\x83\x02\xe0\x3f"  # x step = 0.5 (tagged compact-2)
        b"\x81\x0d\x08\x00\x00\x01"  # separator, plen=8
        b"\x3d\x0a\xd7\xa3\x70\x3d\x5d\x40\x01"  # geometry payload + filler
        b"\x85\x02\xf0\x3f"  # y_from = 1.0 (tagged — NOT a y-log flag)
        b"\x81\x04\x40\x77\x1b\x41"  # y_to = 450000.0 (tagged compact-4)
        b"\x83\x02\xf0\x3f"  # y step = 1.0
        b"\x81\x35\x08\x00\x00\x01"  # end separator
        b"\x8f\xc2\xf5\x28\x5c\x8f\x57\xc0"  # end-separator payload
        + b"\x00" * 32
    )


def _real_form_runfirst_rle_elided_from() -> bytes:
    """RockingCurve Graph2: bare ``91`` flag + run-first c3 RLE x_to (1.4,
    x_from elided = 0.0) + RLE step, then RLE/tagged Y values."""
    return (
        b"\x03\x00\x00\x1f"
        b"\x91"  # 1-byte flag (bare 0x91 before a run-first RLE value)
        b"\xc3\x66\x03\xf6\x3f"  # x_to = 1.4 (run-first c3 RLE: run of 6)
        b"\x9a\xc2\x99\x02\xc9\x3f"  # x step = 0.2
        b"\x81\x10\x08\x00\x00\x01"  # separator, plen=8
        b"\x42\x1d\xd4\x41\x1d\x54\x4f\x40\x01\x00\x00"  # geometry + filler
        b"\x9a\xc2\x99\x02\xd9\x3f"  # y_from = 0.4 (lead-form c2 RLE)
        b"\x82\x03\x88\xe3\x40"  # y_to = 40000.0 (tagged compact-3)
        b"\x83\x02\xf0\x3f"  # y step = 1.0
        b"\x81\x35\x08\x00\x00\x01"
        b"\x80\x83\xdb\x46\x5d\x33\x7f\xc0" + b"\x00" * 32
    )


def _real_form_bare_raw8() -> bytes:
    """"Fixed Lambdas SI" Graph1: flag ``89 18`` + three bare raw8 X values,
    a short (plen=7) separator, then RLE Y values."""
    return (
        b"\x03\x00\x00\x1f"
        b"\x89\x18"  # 2-byte flag token
        b"\x7c\x14\xae\x47\xe1\x7a\x74\x3f"  # x_from = 0.005 (bare raw8)
        b"\xeb\x51\xb8\x1e\x85\xeb\xa1\x3f"  # x_to = 0.035 (bare raw8)
        b"\x7c\x14\xae\x47\xe1\x7a\x74\x3f"  # x step = 0.005 (bare raw8)
        b"\x81\x04\x07\x00\x00\x01"  # separator, plen=7
        b"\x81\x08\xc0\xe5\x03\x41\x01\x00\x00"  # geometry payload + filler
        b"\x9a\xc2\x99\x03\xb9\xbf"  # y_from = -0.1 (lead-form c2 RLE)
        b"\x9a\xc2\x99\x03\xb9\x3f"  # y_to = 0.1
        b"\x9a\xc3\x99\x01\x3f"  # y step = 0.025 (lead-form c3 RLE: run of 6)
        b"\x81\x04\x09\x00\x00\x01"
        b"\x81\x2e\x40\x40\xd1\xc0\x01\x00\x00" + b"\x00" * 32
    )


def test_synthetic_real_form_tagged_and_rle_decodes() -> None:
    figs = extract_figures_opju(_synthetic_opju(_real_form_tagged_and_rle()))
    assert len(figs) == 1
    f = figs[0]
    assert (f["x_from"], f["x_to"]) == (0.2, 2.0)
    assert (f["y_from"], f["y_to"]) == (1.0, 450000.0)
    assert f["x_log"] is False
    assert f["y_log"] is True  # real form has no isolated flag: decade heuristic


def test_synthetic_real_form_runfirst_rle_and_elided_from() -> None:
    figs = extract_figures_opju(_synthetic_opju(_real_form_runfirst_rle_elided_from()))
    assert len(figs) == 1
    f = figs[0]
    assert (f["x_from"], f["x_to"]) == (0.0, 1.4)
    assert (f["y_from"], f["y_to"]) == (0.4, 40000.0)
    assert f["y_log"] is True


def test_synthetic_real_form_bare_raw8() -> None:
    figs = extract_figures_opju(_synthetic_opju(_real_form_bare_raw8()))
    assert len(figs) == 1
    f = figs[0]
    # the raw8 literals hold the GT's exact doubles (0.005000000000000001 …)
    assert (f["x_from"], f["x_to"]) == pytest.approx((0.005, 0.035), rel=1e-12)
    assert (f["y_from"], f["y_to"]) == (-0.1, 0.1)
    assert f["y_log"] is False


def test_synthetic_real_form_garbage_after_separator_drops() -> None:
    """A real-form record whose Y span never exact-fills drops cleanly."""
    blob = _synthetic_opju(
        b"\x03\x00\x00\x1f"
        b"\x89\x01"
        b"\x9a\xc2\x99\x02\xc9\x3f"
        b"\x84\x01\x40"
        b"\x83\x02\xe0\x3f"
        b"\x81\x0d\x08\x00\x00\x01" + b"\x11" * 40  # no decodable Y span
    )
    assert extract_figures_opju(blob) == []


# ── synthetic real-corpus-form Y-scale flag (the rf_* oracle, 2026-07-04) ─────
#
# Bytes below replicate -- value for value -- the actual `rf_linlin.opju` /
# `rf_logy.opju` anchor payloads (a controlled 4-file oracle: the SAME
# single-curve graph with identical custom ranges x=[0.2,20]/y=[50,2000],
# differing only in `layer.x.type`/`layer.y.type`), rebuilt in-test so CI
# needs no private data. Both carry the specimen-form's `81 04 06 00 00 01
# c3 66` Y-transition marker (unlike the true real-corpus files, e.g.
# RockingCurve) -- which is what previously made `_parse_specimen_record`
# accept them: the leading flag token `89 01` plus the first 6 bytes of the
# lead-form RLE `x_from` (`9a c2 99 02 c9 3f`) decode, by coincidence, as a
# *plausible* bare raw8 double (0.19539186479597628, not the true 0.2),
# silently corrupting `x_from` and losing the real Y-scale flag. The guard
# in `_value_candidates` (reject a bare raw8 whose leading byte is in the
# `0x81..0x8f` flag range) forces both through the real-form path instead.


def _rf_linlin_bytes() -> bytes:
    return bytes.fromhex(
        "03 00 00 1f 89 01 9a c2 99 02 c9 3f 83 02 34 40 83 02 f0 3f"
        "81 04 06 00 00 01 c3 66 03 7b 40 01 85 02 49 40 82 03 40 9f"
        "40 83 02 69 40 81 05 06 00 00 01 9a c1 99 2c 19 76 c0 01 00"
        "00 10 10 00 88 e9 6c 00 00 12".replace(" ", "")
    )


def _rf_logy_bytes() -> bytes:
    return bytes.fromhex(
        "03 00 00 1f 89 01 9a c2 99 02 c9 3f 83 02 34 40 83 02 f0 3f"
        "81 04 06 00 00 01 c3 66 03 7b 40 01 85 02 49 40 82 03 40 9f"
        "40 83 02 f0 3f 81 05 06 00 00 01 9a c1 99 2c 19 76 c0 08 01"
        "00 10 10 00 88 e9 6c 00 00 12".replace(" ", "")
    )


def test_synthetic_real_form_y_lin_flag_and_no_specimen_false_positive() -> None:
    """``rf_linlin``'s exact anchor bytes: x_from decodes to the true 0.2 (not
    the specimen-path's false-positive 0.195...), and the ``01 00`` flag
    (found from the ``00 10 10 00`` layer-style marker) reads Y as linear."""
    blob = _synthetic_opju(_rf_linlin_bytes() + b"\x00" * 32)
    figs = extract_figures_opju(blob)
    assert len(figs) == 1
    f = figs[0]
    assert (f["x_from"], f["x_to"]) == (0.2, 20.0)
    assert (f["y_from"], f["y_to"]) == (50.0, 2000.0)
    assert f["y_log"] is False


def test_synthetic_real_form_y_log_flag_matches_rf_logy() -> None:
    """``rf_logy``'s exact anchor bytes (same X, Y toggled to log10): only the
    ``08 01`` flag differs from ``rf_linlin`` above, and it alone is enough
    to flip ``y_log`` to ``True`` -- the axis ranges don't even span 2
    decades, so the decade heuristic alone would have called this linear."""
    blob = _synthetic_opju(_rf_logy_bytes() + b"\x00" * 32)
    figs = extract_figures_opju(blob)
    assert len(figs) == 1
    f = figs[0]
    assert (f["x_from"], f["x_to"]) == (0.2, 20.0)
    assert (f["y_from"], f["y_to"]) == (50.0, 2000.0)
    assert f["y_log"] is True


def test_synthetic_real_form_y_log_flag_overrides_heuristic_both_ways() -> None:
    """The flag wins even when it *disagrees* with the decade heuristic in
    either direction: a flagged log-Y axis spanning under 1 decade, and a
    flagged linear-Y axis spanning 6 decades (the shape that would normally
    trip the heuristic, per ``test_synthetic_unrecognized_type_byte_falls_
    back_to_heuristic``)."""
    flagged_log_small_range = (
        b"\x03\x00\x00\x1f"
        b"\x89\x01"
        b"\x9a\xc2\x99\x02\xc9\x3f"  # x_from = 0.2
        b"\x84\x01\x40"  # x_to = 2.0
        b"\x83\x02\xe0\x3f"  # x step = 0.5
        b"\x81\x0d\x08\x00\x00\x01"  # separator, plen=8
        b"\x3d\x0a\xd7\xa3\x70\x3d\x5d\x40\x01"  # geometry payload + filler
        b"\x85\x02\xf0\x3f"  # y_from = 1.0
        b"\x81\x02\x59\x40"  # y_to = 100.0 (tagged compact-2; <2 decades)
        b"\x83\x02\xf0\x3f"  # y step = 1.0
        b"\x81\x35\x08\x00\x00\x01"  # end separator
        b"\x8f\xc2\xf5\x28\x5c\x8f\x57\xc0"  # end-separator payload
        b"\x08\x01"  # Y-log flag
        b"\x00\x10\x10\x00"  # layer-style marker
        + b"\x00" * 32
    )
    flagged_lin_wide_range = (
        b"\x03\x00\x00\x1f"
        b"\x89\x01"
        b"\x9a\xc2\x99\x02\xc9\x3f"  # x_from = 0.2
        b"\x84\x01\x40"  # x_to = 2.0
        b"\x83\x02\xe0\x3f"  # x step = 0.5
        b"\x81\x0d\x08\x00\x00\x01"
        b"\x3d\x0a\xd7\xa3\x70\x3d\x5d\x40\x01"
        b"\x85\x02\xe0\x3f"  # y_from = 0.5
        b"\x81\x04\x40\x77\x1b\x41"  # y_to = 450000.0 (6 decades)
        b"\x83\x02\xf0\x3f"  # y step = 1.0
        b"\x81\x35\x08\x00\x00\x01"
        b"\x8f\xc2\xf5\x28\x5c\x8f\x57\xc0"
        b"\x01\x00"  # Y-linear flag
        b"\x00\x10\x10\x00"
        + b"\x00" * 32
    )
    figs = extract_figures_opju(_synthetic_opju(flagged_log_small_range))
    assert len(figs) == 1
    assert (figs[0]["y_from"], figs[0]["y_to"]) == (1.0, 100.0)
    assert figs[0]["y_log"] is True  # flagged log, even though <2 decades

    figs = extract_figures_opju(_synthetic_opju(flagged_lin_wide_range))
    assert len(figs) == 1
    assert (figs[0]["y_from"], figs[0]["y_to"]) == (0.5, 450000.0)
    assert figs[0]["y_log"] is False  # flagged linear, even though 6 decades


def test_synthetic_real_form_no_y_flag_marker_falls_back_to_heuristic() -> None:
    """When the ``00 10 10 00`` marker isn't found (e.g. genuine real-corpus
    files like RockingCurve, which lack the specimen-style Y-transition
    marker entirely), ``y_log`` still falls back to the decade heuristic --
    unchanged behavior, re-asserted here against the new flag-lookup path."""
    figs = extract_figures_opju(
        _synthetic_opju(_real_form_tagged_and_rle())
    )
    assert len(figs) == 1
    assert figs[0]["y_log"] is True  # no marker in this fixture -> heuristic (450000/1 >= 1e3)


# ── synthetic curve->column binding (item 35) ─────────────────────────────────
#
# Minimal .opju worksheet-column builder (constant "rep" segments — no FPC
# encoding needed) mirroring test_io_origin_project.py's ``_opju_record``, so
# ``opju_curves.book_columns_from_bytes`` sees a real ``{book: [cols...]}``
# shape without pulling in the full FPC encoder.


def _varint(v: int) -> bytes:
    out = bytearray()
    while True:
        b7 = v & 0x7F
        v >>= 7
        out.append(b7 | (0x80 if v else 0))
        if not v:
            return bytes(out)


def _zz(n: int) -> bytes:
    return _varint((n << 1) ^ (n >> 63) if n >= 0 else ((-n) << 1) - 1)


def _opju_const_column(name: str, value: float, count: int = 4) -> bytes:
    """A named .opju column record holding ``count`` copies of a constant."""
    fields = _zz(count) + (b"\x64" if value == 0.0 else b"\x50" + struct.pack("<d", value))
    body = b"\xff\xff" + _varint(count) + b"\x00" + bytes(fields)
    nm = name.encode("latin1")
    return bytes([len(nm)]) + nm + b"\x0a\x05" + _varint(count) + body


# Designation-marker windows-section builder, mirroring
# test_io_origin_project.py's ``_opju_window_section`` -- needed so
# ``opju_curves``'s designation gate (must independently confirm "Y") can
# resolve these synthetic books instead of dropping every curve.
_OPJU_MARK = {"X": b"\x21\x51", "Y": b"\x21\x61", "Y-error": b"\x30\x61"}


def _opju_window_section(book: str, designations: list[str]) -> bytes:
    book_b = book.encode("latin1")
    out = bytes([len(book_b) + 2]) + b"\x00\x00" + book_b
    for desig in designations:
        out += _OPJU_MARK[desig] + b"\x02\x01\x00"  # marker + empty-label placeholder
    return out


def _curve_token(flag: int, y_ord: int, konst: int = 1) -> bytes:
    """The 8-byte curve->column-ordinal token (see ``opju_curves.py``)."""
    return bytes([flag, 0x01, konst, 0x01, 0x80, 0x03, y_ord, 0x00])


def test_synthetic_curve_token_resolves_book_and_column() -> None:
    """A curve token whose y_ord=3 resolves to FBook's 3rd column (C), with
    x inferred as that book's own first column (A) -- mirroring the fig_pairs
    A-C diff that pinned this encoding."""
    blob = (
        b"CPYUA 4.3811 222\n"
        + _opju_const_column("FBook_A", 1.0)
        + _opju_const_column("FBook_B", 2.0)
        + _opju_const_column("FBook_C", 3.0)
        + _opju_window_section("FBook", ["X", "Y", "Y"])
        + _layer_bytes(0.0, 9.0, 0.0, 1000.0, 200.0, 0x03, r"\l(1) %(1)")
        + _curve_token(0xBA, y_ord=3)
    )
    figs = extract_figures_opju(blob)
    assert len(figs) == 1
    assert figs[0]["curves"] == [{"book": "FBook", "x": "A", "y": "C"}]


def test_synthetic_curve_token_missing_yields_empty_curves() -> None:
    """No curve token in the window -> ``curves`` is an empty list, not a guess."""
    blob = (
        b"CPYUA 4.3811 222\n"
        + _opju_const_column("FBook_A", 1.0)
        + _opju_const_column("FBook_B", 2.0)
        + _opju_window_section("FBook", ["X", "Y"])
        + _layer_bytes(0.0, 9.0, 0.0, 1000.0, 200.0, 0x03, r"\l(1) %(1)")
    )
    figs = extract_figures_opju(blob)
    assert len(figs) == 1
    assert figs[0]["curves"] == []


def test_synthetic_curve_token_out_of_range_ordinal_dropped() -> None:
    """A y_ord past the last known column resolves to nothing -- dropped, not guessed."""
    blob = (
        b"CPYUA 4.3811 222\n"
        + _opju_const_column("FBook_A", 1.0)
        + _opju_const_column("FBook_B", 2.0)
        + _opju_window_section("FBook", ["X", "Y"])
        + _layer_bytes(0.0, 9.0, 0.0, 1000.0, 200.0, 0x03, r"\l(1) %(1)")
        + _curve_token(0xBA, y_ord=9)  # only 2 columns exist
    )
    figs = extract_figures_opju(blob)
    assert len(figs) == 1
    assert figs[0]["curves"] == []


def _column_enum_token(marker: int, ordv: int) -> bytes:
    """The 7-byte per-book "column candidate list" shape found near every
    book reference in every specimen/real-corpus file checked (item 35
    recall push, 2026-07-04) -- NOT a curve binding, see the module
    docstring's "second near-miss shape" section. One byte shorter than the
    real curve token (single ``0x01`` then straight to ``0x80 0x03``, never
    the real token's double ``0x01``), so it can never satisfy ``_CURVE_RE``.
    """
    return bytes([0x33, 0x01, marker, 0x80, 0x03, ordv, 0x00])


def test_synthetic_column_enum_list_not_mistaken_for_curve_token() -> None:
    """A run of column-candidate-list tokens (one per column of a book, as
    observed enumerating every column A..D in the real corpus and both new
    curves_multi/curves_2books specimens) must never be reported as curves:
    they are missing the second ``0x01`` byte the real per-curve token
    requires, so the whole-file regex structurally cannot match them."""
    blob = (
        b"CPYUA 4.3811 222\n"
        + _opju_const_column("FBook_A", 1.0)
        + _opju_const_column("FBook_B", 2.0)
        + _opju_const_column("FBook_C", 3.0)
        + _opju_window_section("FBook", ["X", "Y", "Y"])
        + _layer_bytes(0.0, 9.0, 0.0, 1000.0, 200.0, 0x03, r"\l(1) %(1)")
        + b"".join(_column_enum_token(0x10, ordv) for ordv in (1, 2, 3))
    )
    figs = extract_figures_opju(blob)
    assert len(figs) == 1
    assert figs[0]["curves"] == []


def test_synthetic_curve_token_non_y_designation_dropped() -> None:
    """A curve token whose y_ord resolves to an X or Y-error column is dropped
    (the designation gate) -- e.g. "Fixed Lambdas SI"'s ``dQ`` Y-error column,
    which the whole-file regex scan alone can't rule out (see module docstring)."""
    blob = (
        b"CPYUA 4.3811 222\n"
        + _opju_const_column("FBook_A", 1.0)
        + _opju_const_column("FBook_B", 2.0)
        + _opju_window_section("FBook", ["X", "Y-error"])
        + _layer_bytes(0.0, 9.0, 0.0, 1000.0, 200.0, 0x03, r"\l(1) %(1)")
        + _curve_token(0xBA, y_ord=2)  # resolves to FBook's B, but B is Y-error
    )
    figs = extract_figures_opju(blob)
    assert len(figs) == 1
    assert figs[0]["curves"] == []


# ── synthetic curve->column binding, the 0x01-subtype all-columns token ──────
#
# The second curve-token family (item 35, closed 2026-07-04): ordinary
# single-curve default-dialog graphs (RockingCurve Graph1/Graph2, all of
# XAS, all of UnpolPlots) encode their Y column with subtype 0x01 instead of
# 0x03, counted cumulatively over EVERY allocated column of EVERY book --
# including empty/undecoded books and columns -- not just the FPC-decoded
# ones the 0x03 path's ``_global_column_map`` counts. See
# ``opju_curves_allcols.py``'s module docstring for the full byte-level
# trail and why this token is NOT designation-gated (unlike 0x03).


def _name_marker(name: str) -> bytes:
    """A bare length-prefixed dataset-name record with NO column data behind
    it -- simulating an empty/undecoded column (e.g. XAS's unused default
    ``Book1``), which still carries a name record but never appears in
    ``opju_codec.scan_columns`` / ``book_columns_from_bytes``."""
    nm = name.encode("latin1")
    return bytes([len(nm)]) + nm


def _curve_token_0x01(flag: int, val: int) -> bytes:
    """The 7-byte 0x01-subtype all-columns curve token (see
    ``opju_curves_allcols.py``) -- no fixed terminator, unlike the 0x03
    family's trailing ``0x00``."""
    return bytes([flag, 0x01, 0x01, 0x01, 0x80, 0x01, val])


def test_synthetic_allcols_token_resolves_across_empty_book() -> None:
    """``Book1`` carries name records but no decodable data (an empty
    default book, mirroring XAS's real ``Book1_A``/``Book1_B``) -- it still
    occupies 2 ordinals in the all-columns map, so ``FBook``'s columns start
    at ordinal 3. A 0x01 token with val=5 must resolve to ``FBook!C``."""
    blob = (
        b"CPYUA 4.3811 222\n"
        + _name_marker("Book1_A")
        + _name_marker("Book1_B")
        + _opju_const_column("FBook_A", 1.0)
        + _opju_const_column("FBook_B", 2.0)
        + _opju_const_column("FBook_C", 3.0)
        + _layer_bytes(0.0, 9.0, 0.0, 1000.0, 200.0, 0x03, r"\l(1) %(1)")
        + _curve_token_0x01(0xBA, val=5)
    )
    figs = extract_figures_opju(blob)
    assert len(figs) == 1
    assert figs[0]["curves"] == [{"book": "FBook", "x": "A", "y": "C"}]


def test_synthetic_allcols_token_out_of_range_dropped() -> None:
    """A val past the last allocated column of the last book resolves to
    nothing -- dropped, not guessed (mirrors the 0x03 path's own
    out-of-range test)."""
    blob = (
        b"CPYUA 4.3811 222\n"
        + _opju_const_column("FBook_A", 1.0)
        + _opju_const_column("FBook_B", 2.0)
        + _layer_bytes(0.0, 9.0, 0.0, 1000.0, 200.0, 0x03, r"\l(1) %(1)")
        + _curve_token_0x01(0xBA, val=9)  # only 2 allocated columns exist
    )
    figs = extract_figures_opju(blob)
    assert len(figs) == 1
    assert figs[0]["curves"] == []


def test_synthetic_allcols_token_not_designation_gated() -> None:
    """Unlike the 0x03 path, a 0x01 token resolving to a Y-error-designated
    column is KEPT, not dropped -- the deliberate difference documented in
    ``opju_curves_allcols.py`` (real corpus files legitimately plot a
    Y-error column, e.g. "dR Fresnel"/"dSA", as its own curve; requiring
    "Y" designation here would silently lose those true positives)."""
    blob = (
        b"CPYUA 4.3811 222\n"
        + _opju_const_column("FBook_A", 1.0)
        + _opju_const_column("FBook_B", 2.0)
        + _opju_window_section("FBook", ["X", "Y-error"])
        + _layer_bytes(0.0, 9.0, 0.0, 1000.0, 200.0, 0x03, r"\l(1) %(1)")
        + _curve_token_0x01(0xBA, val=2)  # resolves to FBook's B, which is Y-error
    )
    figs = extract_figures_opju(blob)
    assert len(figs) == 1
    assert figs[0]["curves"] == [{"book": "FBook", "x": "A", "y": "B"}]


def test_synthetic_curve_families_merge_and_dedup() -> None:
    """When both token families resolve to the SAME (book, y) pair inside one
    figure's window, the merged ``curves`` list reports it once, not twice."""
    blob = (
        b"CPYUA 4.3811 222\n"
        + _opju_const_column("FBook_A", 1.0)
        + _opju_const_column("FBook_B", 2.0)
        + _opju_const_column("FBook_C", 3.0)
        + _opju_window_section("FBook", ["X", "Y", "Y"])
        + _layer_bytes(0.0, 9.0, 0.0, 1000.0, 200.0, 0x03, r"\l(1) %(1)")
        + _curve_token(0xBA, y_ord=3)  # 0x03 family: FBook!C
        + _curve_token_0x01(0xBB, val=3)  # 0x01 family: also FBook!C
    )
    figs = extract_figures_opju(blob)
    assert len(figs) == 1
    assert figs[0]["curves"] == [{"book": "FBook", "x": "A", "y": "C"}]


# ── synthetic CPYUA text objects (title/legend/annotation routing) ────────────
#
# The name-header + framed-text grammar `opju_figure_text.py` decodes (see its
# module docstring for the byte-level trail and the hc2convert.opj
# cross-container validation). Shapes below replicate the real corpus bytes:
# axis titles use the `<tag> 04 10 00 00 <xx>` header + name tag 0x80,
# Legend/Text use `<tag> 01 10` + name tag 0x83; text is `<tag> 01 80 <len>
# <utf-8 ... 00>` with tag 0x86 or 0xa8 (both observed).


def _opju_text_object(
    name: str,
    text: str,
    *,
    hdr_tag: int = 0x8A,
    axis_shape: bool = False,
    text_tag: int = 0x86,
    pad: int = 24,
) -> bytes:
    """One CPYUA graph-child text object: name header, an inert style/format
    filler run (``pad`` bytes -- real objects put 49-66 bytes here), then the
    object's framed text."""
    nm = name.encode("ascii")
    if axis_shape:
        hdr = bytes([hdr_tag, 0x04, 0x10, 0x00, 0x00, 0x04, 0x80, len(nm)]) + nm
    else:
        hdr = bytes([hdr_tag, 0x01, 0x10, 0x83, len(nm)]) + nm
    raw = text.encode("utf-8") + b"\x00"
    style = b"\x9c\x02\xfb\x07\x85\x01\x08\x90\x00" + b"\x00" * pad
    return hdr + style + bytes([text_tag, 0x01, 0x80, len(raw)]) + raw


def test_synthetic_opju_text_objects_route_to_buckets() -> None:
    """YL/XB/Legend/Text objects route into y_title/x_title/legend_labels/
    annotations (never the flat bucket), with rich-text cleaned and the
    multi-line legend/textbox strings split per line -- mirroring the .opj
    routing test in test_io_origin_project.py."""
    blob = _synthetic_opju(
        _layer_bytes(0.0, 9.0, 0.0, 1000.0, 200.0, 0x03, r"\l(1) %(1)")
        + _opju_text_object("YL", "Resistance (Ohms)", axis_shape=True)
        + _opju_text_object("XB", r"\g(q) (degrees)", axis_shape=True)
        + _opju_text_object("Legend", "\\l(1) Nb\r\n\\l(2) %(2)")
        + _opju_text_object("Text", "Field applied in-plane\r\nT = 1.3 K")
    )
    figs = extract_figures_opju(blob)
    assert len(figs) == 1
    f = figs[0]
    assert f["y_title"] == "Resistance (Ohms)"
    assert f["x_title"] == "θ (degrees)"  # \g(q) -> theta
    assert f["y2_title"] == ""
    assert f["legend_labels"] == ["Nb", "%(2)"]
    assert f["annotations"] == ["Field applied in-plane", "T = 1.3 K"]
    assert "Resistance (Ohms)" not in f["annotations"]  # no flat-bucket leak


def test_synthetic_opju_alt_header_and_text_tags_with_utf8() -> None:
    """The header prelude tag varies (0x8a/0x84/0x92 observed) and the text
    field tag can be 0xa8 (Hc2 Graph33); text is UTF-8 (Hc2's raw ``⊥``/``∥``
    titles). All variants route identically."""
    blob = _synthetic_opju(
        _layer_bytes(0.0, 9.0, 0.0, 1000.0, 200.0, 0x03, r"\l(1) %(1)")
        + _opju_text_object(
            "YL", "H\\-(c2∥) (T)", axis_shape=True, hdr_tag=0x92, text_tag=0xA8
        )
        + _opju_text_object("XB", "Temperature (K)", axis_shape=True, hdr_tag=0x84)
    )
    f = extract_figures_opju(blob)[0]
    assert f["y_title"] == "Hc₂∥ (T)"  # subscript run + raw Unicode kept
    assert f["x_title"] == "Temperature (K)"


def test_synthetic_opju_auto_template_titles_stay_empty() -> None:
    """An untouched auto-title template (%(?Y)/%(?X)) never becomes a title
    (matching .opj, where _texts_in's letter filter drops it) and never
    leaks into annotations."""
    blob = _synthetic_opju(
        _layer_bytes(0.0, 9.0, 0.0, 1000.0, 200.0, 0x03, r"\l(1) %(1)")
        + _opju_text_object("YL", "%(?Y)", axis_shape=True)
        + _opju_text_object("XB", "%(?X)", axis_shape=True)
    )
    f = extract_figures_opju(blob)[0]
    assert f["x_title"] == "" and f["y_title"] == ""
    assert f["annotations"] == []


def test_synthetic_opju_unknown_object_text_dropped() -> None:
    """Text owned by an internal/unroutable object (__FRAMESRCDATAINFOS and
    friends) is dropped -- never guessed into a title or annotation."""
    blob = _synthetic_opju(
        _layer_bytes(0.0, 9.0, 0.0, 1000.0, 200.0, 0x03, r"\l(1) %(1)")
        + _opju_text_object("__FRAMESRCDATAINFOS", "Internal Config Text")
    )
    f = extract_figures_opju(blob)[0]
    assert f["x_title"] == "" and f["y_title"] == "" and f["y2_title"] == ""
    assert f["annotations"] == []


def test_synthetic_opju_orphan_text_defaults_to_annotations() -> None:
    """A framed text run with no governing name header lands in annotations
    (the same degrade .opj uses for text before its first header)."""
    raw = b"Floating note\x00"
    blob = _synthetic_opju(
        _layer_bytes(0.0, 9.0, 0.0, 1000.0, 200.0, 0x03, r"\l(1) %(1)")
        + bytes([0x86, 0x01, 0x80, len(raw)])
        + raw
    )
    f = extract_figures_opju(blob)[0]
    assert f["annotations"] == ["Floating note"]
    assert f["x_title"] == "" and f["y_title"] == ""


def test_synthetic_opju_stale_header_beyond_bound_not_paired() -> None:
    """A text further than _MAX_NAME_TO_TEXT past the last header does NOT
    inherit its bucket -- it demotes to annotations (missing title, never a
    wrong one)."""
    blob = _synthetic_opju(
        _layer_bytes(0.0, 9.0, 0.0, 1000.0, 200.0, 0x03, r"\l(1) %(1)")
        + _opju_text_object("YL", "Too Far Away", axis_shape=True, pad=600)
    )
    f = extract_figures_opju(blob)[0]
    assert f["y_title"] == ""
    assert f["annotations"] == ["Too Far Away"]


def test_synthetic_opju_no_framed_text_keeps_flat_fallback() -> None:
    """A window with no framed text objects at all (legacy/synthetic streams)
    keeps the historical flat-scrape annotations and empty titles/legend."""
    blob = _synthetic_opju(
        _layer_bytes(0.0, 9.0, 0.0, 1000.0, 200.0, 0x03, r"\l(1) %(1)")
        + b"Field Sweep (Oe)\x00"  # printable but unframed
    )
    f = extract_figures_opju(blob)[0]
    assert f["annotations"] == ["Field Sweep (Oe)"]
    assert f["x_title"] == "" and f["y_title"] == "" and f["y2_title"] == ""
    assert f["legend_labels"] == []


# ── curve plot-style (line vs scatter) — pure unit tests ──────────────────────


def test_curve_plot_style_line() -> None:
    """``0xC8`` -> "line" (Origin LabTalk ``plot:=200``)."""
    b = b"\x00" * 10 + b"\x8f\x01\xc8\x83"
    assert curve_plot_style(b, 0) == "line"


def test_curve_plot_style_scatter() -> None:
    """``0xC9`` -> "scatter" (Origin LabTalk ``plot:=201``)."""
    b = b"\x00" * 10 + b"\x8f\x01\xc9\x83"
    assert curve_plot_style(b, 0) == "scatter"


def test_curve_plot_style_no_tag_found() -> None:
    """No ``8f 01 <style> 83`` tag anywhere in the forward window -> ``None``,
    never a fabricated default (~8% of real-corpus tokens legitimately have none)."""
    b = b"\x00" * 50
    assert curve_plot_style(b, 0) is None


def test_curve_plot_style_unknown_byte() -> None:
    """A style byte outside the known ``{0xc8, 0xc9}`` set -> ``None``."""
    b = b"\x00" * 10 + b"\x8f\x01\xca\x83"
    assert curve_plot_style(b, 0) is None


def test_curve_plot_style_scans_forward_window_not_fixed_offset() -> None:
    """The tag is found at a variable offset (not a hardcoded position) as
    long as it falls inside the 400-byte forward window from ``token_start``."""
    b = b"\x00" * 30 + b"\x8f\x01\xc8\x83"
    assert curve_plot_style(b, 0) == "line"


# ── realdata: Origin ground-truth oracle (specimens only — see module docstring) ──


def _resolve_spec_dir() -> Path:
    """The local-only corpus's ``specimens`` dir.

    ``parents[1] / "../test-data"`` assumes this file sits one level below a
    repo root that is itself a sibling of ``test-data`` — true for the main
    checkout, but a worktree agent lives an extra ``.claude/worktrees/<name>``
    deep, so that relative path silently resolves to a nonexistent location.
    Fall back to walking up from ``__file__`` for a ``test-data`` sibling
    (works from any nesting depth) before giving up.
    """
    candidate = Path(__file__).resolve().parents[1] / ".." / "test-data" / "origin" / "specimens"
    if candidate.exists():
        return candidate
    for ancestor in Path(__file__).resolve().parents:
        walked = ancestor / "test-data" / "origin" / "specimens"
        if walked.exists():
            return walked
    return candidate  # let downstream `.exists()` checks skip cleanly


_SPEC = _resolve_spec_dir()
_GT = _SPEC / "ground_truth"


@pytest.mark.realdata
@pytest.mark.parametrize("stem", ["fig_lin", "fig_log", "fig_pairs"])
def test_realdata_matches_origin_ground_truth(stem: str) -> None:
    """Every decoded layer must match exactly one oracle layer (axis range +
    linear/log10 flag) within tight tolerance, and every oracle layer must be
    recovered (no drops) — these are the controlled specimens this decoder's
    record shape was reverse-engineered from."""
    src = _SPEC / f"{stem}.opju"
    index_path = _GT / stem / "index.json"
    if not src.exists() or not index_path.exists():
        pytest.skip("Origin specimen/ground-truth not present on this machine")
    index = json.loads(index_path.read_text(encoding="utf-8"))
    expected = [
        (layer["x"], layer["y"]) for g in index["graphs"] for layer in g["layers"]
    ]
    figs = extract_figures_opju(src.read_bytes())
    assert len(figs) == len(expected), f"{stem}: expected {len(expected)} layers, got {len(figs)}"
    remaining = list(expected)
    for f in figs:
        match = next(
            (
                (x, y)
                for x, y in remaining
                if abs(f["x_from"] - x[0]) < 1e-6
                and abs(f["x_to"] - x[1]) < 1e-6
                and abs(f["y_from"] - y[0]) < 1e-6
                and abs(f["y_to"] - y[1]) < 1e-6
            ),
            None,
        )
        assert match is not None, f"{stem}: decoded layer {f} matches no oracle layer"
        remaining.remove(match)
        assert f["y_log"] == (match[1][2] == 2.0), f"{stem}: y_log flag mismatch for {f}"


@pytest.mark.realdata
@pytest.mark.parametrize(
    ("stem", "x_log", "y_log"),
    [
        ("fig_linx", False, False),  # layer.x.type=1, y.type=1
        ("fig_logx", True, False),  # layer.x.type=2, y.type=1  -> byte 0x04
        ("fig_xylog", False, True),  # x.type=2, y.type=2 -> byte 0x0d can't encode X
    ],
)
def test_realdata_xscale_specimens(stem: str, x_log: bool, y_log: bool) -> None:
    """The X-scale diff pair + both-log specimen (generate_specimens2). Truth is
    by construction (the LabTalk axis type set at generation), not a GT export.
    fig_xylog's X is genuinely log but the 0x0d byte carries no X information,
    so the decoder honestly reports the heuristic (linear) there — a documented
    format limitation, asserted so it stays visible."""
    src = _SPEC / f"{stem}.opju"
    if not src.exists():
        pytest.skip(f"X-scale specimen '{stem}' not present on this machine")
    figs = extract_figures_opju(src.read_bytes())
    assert figs, f"{stem}: no figure decoded"
    assert figs[0]["x_log"] is x_log, f"{stem}: x_log"
    assert figs[0]["y_log"] is y_log, f"{stem}: y_log"


# ── realdata: the rf_* real-corpus-form axis-scale oracle (2026-07-04) ────────
#
# The controlled-specimen pair above (fig_linx/fig_logx/fig_xylog) all use
# the *specimen* record form (default axis dialog). This quad instead uses a
# *non-default* axis dialog (custom `layer.x.from/to` + `layer.y.from/to`),
# which -- like `axis_custom.opju` -- produces the *real-corpus* record
# form: the same shape RockingCurve/XAS/etc. use, not the specimen shape.
# All four share identical custom ranges (x=[0.2,20], y=[50,2000]),
# differing only in `layer.x.type`/`layer.y.type` (1=linear, 2=log10) --
# truth is by construction, like the specimen pair above. This is the
# oracle that isolated the real-form Y-scale flag (`_real_y_log_flag`).


@pytest.mark.realdata
@pytest.mark.parametrize(
    ("stem", "x_log", "y_log"),
    [
        ("rf_linlin", False, False),  # layer.x.type=1, layer.y.type=1
        ("rf_logx", True, False),  # layer.x.type=2, layer.y.type=1
        ("rf_logy", False, True),  # layer.x.type=1, layer.y.type=2
        ("rf_loglog", True, True),  # layer.x.type=2, layer.y.type=2
    ],
)
def test_realdata_real_form_scale_quad(stem: str, x_log: bool, y_log: bool) -> None:
    """The rf_* quad: identical custom ranges, only the axis types differ.
    Both X (via the pre-existing ``_scale_byte``/type-byte path, incidentally
    present here because these controlled specimens carry the specimen-form
    Y-transition marker even though they use real-form value encoding) and Y
    (via the new ``_real_y_log_flag``) must be exact -- not heuristic -- for
    all four, and the axis range must be the true ``(0.2, 20.0)``/
    ``(50.0, 2000.0)``, not the specimen-path false-positive's corrupted
    ``x_from``."""
    src = _SPEC / f"{stem}.opju"
    if not src.exists():
        pytest.skip(f"real-form scale specimen '{stem}' not present on this machine")
    figs = extract_figures_opju(src.read_bytes())
    assert len(figs) == 1, f"{stem}: expected 1 figure, got {len(figs)}"
    f = figs[0]
    assert (f["x_from"], f["x_to"]) == pytest.approx((0.2, 20.0), rel=1e-9), stem
    assert (f["y_from"], f["y_to"]) == pytest.approx((50.0, 2000.0), rel=1e-9), stem
    assert f["x_log"] is x_log, f"{stem}: x_log"
    assert f["y_log"] is y_log, f"{stem}: y_log"


@pytest.mark.realdata
def test_realdata_axis_custom_real_form_scale() -> None:
    """``axis_custom.opju`` (custom X range + log X, default linear Y) is an
    independently-generated 5th data point for the same real-form scale
    flags: byte-identical to ``rf_logx`` at the axis record (verified during
    RE), giving x_log=True (flag) and y_log=False (flag, not heuristic)."""
    src = _SPEC / "axis_custom.opju"
    if not src.exists():
        pytest.skip("axis_custom specimen not present on this machine")
    figs = extract_figures_opju(src.read_bytes())
    assert len(figs) == 1
    f = figs[0]
    assert (f["x_from"], f["x_to"]) == pytest.approx((0.2, 20.0), rel=1e-9)
    assert (f["y_from"], f["y_to"]) == pytest.approx((50.0, 2000.0), rel=1e-9)
    assert f["x_log"] is True
    assert f["y_log"] is False


@pytest.mark.realdata
@pytest.mark.parametrize(
    ("stem", "n_anchors"),
    [("XAS", 3), ("RockingCurve", 3), ("UnpolPlots", 4), ("Fixed Lambdas SI", 4)],
)
def test_realdata_real_corpus_anchors_decode_and_match(stem: str, n_anchors: int) -> None:
    """Item 33: every real-corpus axis anchor decodes, and every decoded figure
    matches an oracle layer's ranges within 1e-9 rel with correct lin/log.
    Anchors are fewer than GT layers: only *unique* layers are encoded —
    composite windows (RockingCurve/UnpolPlots ``Graph3``) reference existing
    layers, and sparkline/derived layers carry no ``03 00 00 1f`` record —
    so coverage is asserted per anchor, not per GT layer."""
    src = _SPEC.parent / f"{stem}.opju"
    index_path = _GT / stem / "index.json"
    if not src.exists() or not index_path.exists():
        pytest.skip(f"corpus file/ground-truth for '{stem}' not present on this machine")
    index = json.loads(index_path.read_text(encoding="utf-8"))
    expected = [
        (layer["x"], layer["y"]) for g in index["graphs"] for layer in g["layers"]
    ]

    def _tol(a: float, b: float) -> bool:
        return abs(a - b) <= 1e-9 * max(1.0, abs(a), abs(b))

    figs = extract_figures_opju(src.read_bytes())
    assert len(figs) == n_anchors, f"{stem}: expected {n_anchors} anchors, got {len(figs)}"
    for f in figs:
        assert any(
            _tol(f["x_from"], x[0])
            and _tol(f["x_to"], x[1])
            and _tol(f["y_from"], y[0])
            and _tol(f["y_to"], y[1])
            and f["x_log"] == (x[2] == 2.0)
            and f["y_log"] == (y[2] == 2.0)
            for x, y in expected
        ), f"{stem}: decoded figure {f} matches no oracle layer"


# ── realdata: curve->column binding (item 35) ─────────────────────────────────
#
# Origin's own GT exporter has no oracle for this (``index.json``'s
# ``plots`` list comes back empty for every project in this corpus — a
# LabTalk/COM limitation in ``export_ground_truth.py``, see
# ``opju_curves.py``'s module docstring). Two substitute checks:
#
# 1. ``fig_pairs`` against the *by-construction* truth: the LabTalk
#    ``plotxy iy:=`` calls in ``generate_specimens.py`` are the ground
#    truth we wrote ourselves (same category of oracle already used by
#    ``test_realdata_xscale_specimens`` above).
# 2. Real corpus: every curve found must resolve to a column that GT's
#    (independently populated) long-name metadata marks as a plausible
#    *dependent*-variable column -- never an independent/reference axis.


@pytest.mark.realdata
def test_realdata_fig_pairs_curve_bindings() -> None:
    """fig_pairs' 4 graphs (see module docstring / generate_specimens.py):
    graph1/2/4 plot FBook A,B; graph3 -- the deliberate diff -- plots A,C."""
    src = _SPEC / "fig_pairs.opju"
    if not src.exists():
        pytest.skip("fig_pairs specimen not present on this machine")
    figs = extract_figures_opju(src.read_bytes())
    assert len(figs) == 4
    expected = [
        {"book": "FBook", "x": "A", "y": "B", "style": "scatter"},
        {"book": "FBook", "x": "A", "y": "B", "style": "scatter"},
        {"book": "FBook", "x": "A", "y": "C", "style": "scatter"},  # the deliberate A-C diff
        {"book": "FBook", "x": "A", "y": "B", "style": "line"},
    ]
    for i, (f, want) in enumerate(zip(figs, expected, strict=True)):
        assert f["curves"] == [want], f"fig_pairs graph{i + 1}: curves={f['curves']}"


@pytest.mark.realdata
def test_realdata_fig_pairs_curve_plot_styles() -> None:
    """Dedicated style-field assertion for the plot-style wiring (curve_plot_style):
    Graph1's curves 1-3 plot ``:=201`` (scatter), curve 4 plots ``:=200`` (line) --
    see ``opju_codec.curve_plot_style``'s module docstring for the byte-level trail."""
    src = _SPEC / "fig_pairs.opju"
    if not src.exists():
        pytest.skip("fig_pairs specimen not present on this machine")
    figs = extract_figures_opju(src.read_bytes())
    assert len(figs) == 4
    styles = [f["curves"][0]["style"] for f in figs]
    assert styles == ["scatter", "scatter", "scatter", "line"]


@pytest.mark.realdata
def test_realdata_curves_multi_bindings() -> None:
    """``curves_multi``: one graph, one layer, three curves (MBook B/C/D vs
    A) -- pins the multi-curve-per-layer byte layout (see module docstring's
    "Multi-curve-per-layer and multi-book layout" section). By-construction
    truth: ``ground_truth/curves_multi/plots.json``."""
    src = _SPEC / "curves_multi.opju"
    if not src.exists():
        pytest.skip("curves_multi specimen not present on this machine")
    figs = extract_figures_opju(src.read_bytes())
    assert len(figs) == 1
    assert figs[0]["curves"] == [
        {"book": "MBook", "x": "A", "y": "B", "style": "scatter"},
        {"book": "MBook", "x": "A", "y": "C", "style": "scatter"},
        {"book": "MBook", "x": "A", "y": "D", "style": "scatter"},
    ]


@pytest.mark.realdata
def test_realdata_curves_2books_bindings() -> None:
    """``curves_2books``: one graph, curves from two different books
    (``BookOne!B``, ``BookTwo!C``) -- pins the cumulative-ordinal base
    carrying over a book boundary. By-construction truth:
    ``ground_truth/curves_2books/plots.json``."""
    src = _SPEC / "curves_2books.opju"
    if not src.exists():
        pytest.skip("curves_2books specimen not present on this machine")
    figs = extract_figures_opju(src.read_bytes())
    assert len(figs) == 1
    assert figs[0]["curves"] == [
        {"book": "BookOne", "x": "A", "y": "B", "style": "scatter"},
        {"book": "BookTwo", "x": "A", "y": "C", "style": "scatter"},
    ]


# Long-names GT independently confirms belong to an independent/reference axis
# (Theta, Energy/E, depth Z, momentum-transfer Q and its uncertainty dQ, time
# T, flux F) -- a curve's decoded Y column must never be one of these.
_INDEPENDENT_VAR_NAMES = {"Theta", "Energy", "E", "Z", "Q", "dQ", "T", "F"}


@pytest.mark.realdata
@pytest.mark.parametrize("stem", ["XAS", "RockingCurve", "UnpolPlots", "Fixed Lambdas SI"])
def test_realdata_real_corpus_curves_are_plausible(stem: str) -> None:
    """Every curve found in the real corpus resolves to a GT-known book/column
    whose long-name is never an independent-variable axis (Theta/Energy/Q/...)
    -- the strongest check available without a ``plots`` oracle (see above)."""
    src = _SPEC.parent / f"{stem}.opju"
    index_path = _GT / stem / "index.json"
    if not src.exists() or not index_path.exists():
        pytest.skip(f"corpus file/ground-truth for '{stem}' not present on this machine")
    index = json.loads(index_path.read_text(encoding="utf-8"))
    long_names: dict[tuple[str, str], str] = {}
    for book in index["books"]:
        for sheet in book["sheets"]:
            for col in sheet["columns"]:
                long_names[(book["book"], col["dataset"])] = col["long_name"]

    figs = extract_figures_opju(src.read_bytes())
    n_curves = 0
    for f in figs:
        for curve in f["curves"]:
            n_curves += 1
            key = (curve["book"], curve["y"])
            assert key in long_names, f"{stem}: curve {curve} references an unknown column"
            assert long_names[key] not in _INDEPENDENT_VAR_NAMES, (
                f"{stem}: curve {curve} plots an independent-variable column as Y"
            )
    if n_curves == 0:
        pytest.skip(f"{stem}: no curve tokens found within any decoded figure's window")


# ── realdata: the real plots.json oracle (item 35 rework, 2026-07-04) ────────
#
# tools/origin_trial/export_plot_refs.py's `range -w` LabTalk recipe recovers
# the real per-plot dataset references that export_ground_truth.py's
# `layer.nplots`/`range __rp` approach could never populate (both described in
# opju_curves.py's module docstring). Where `plots.json` exists, it is the
# strongest oracle available: `{"<graph>": {"<layer>": ["<ref>", ...]}}` with
# each ref shaped `[Book]Sheet!Col"LongName"` (or an unquoted sheet name, or
# no long-name suffix for the by-construction fig_pairs specimen).

_PLOT_REF_RE = re.compile(r'\[(?P<book>[^\]]+)\](?:"[^"]*"|[^!"]*)!(?P<col>[A-Za-z]+)')


def _oracle_pairs(plots_path: Path) -> set[tuple[str, str]]:
    """Every ``(book, column)`` pair referenced anywhere in one ``plots.json``,
    across all graphs and layers (recall/precision are checked file-wide, not
    per-graph, since this decoder's own figure-to-curve attribution is a
    documented best-effort heuristic -- see opju_curves.py's "Known gap")."""
    data = json.loads(plots_path.read_text(encoding="utf-8"))
    out: set[tuple[str, str]] = set()
    for layers in data.values():
        for refs in layers.values():
            for ref in refs:
                m = _PLOT_REF_RE.match(ref)
                if m:
                    out.add((m.group("book"), m.group("col")))
    return out


# Measured 2026-07-04 against the real plots.json oracle (see
# docs/origin_project_format.md sec 6.2.1 for the full table). Precision is
# 100% on every stem -- asserted unconditionally below, no floor needed.
# These floors exist to catch a regression, not to claim a ceiling.
#
# ``curves_multi``/``curves_2books`` (item 35 recall push, same day) are two
# purpose-built specimens pinning the multi-curve-per-layer and cross-book-
# ordinal layout; both decode at 100% recall via the existing (0x03-subtype)
# pipeline (see opju_curves.py's module docstring).
#
# The 0x01-subtype all-columns token (item 35 CLOSED, same-day rework --
# see opju_curves_allcols.py's module docstring) then raised every real-
# corpus stem to 100%: it decodes exactly the ordinary, single-curve
# default-dialog graphs (RockingCurve Graph1/Graph2, all of XAS, all of
# UnpolPlots, most of "Fixed Lambdas SI") the 0x03-subtype path could never
# reach, using an ordinal counted over ALL allocated columns of ALL books
# (not just FPC-decoded ones). Aggregate oracle-covered recall: 36/36
# (100%), up from 11/36 (30.6%).
_RECALL_FLOOR = {
    "fig_pairs": 1.0,  # 2/2 -- the by-construction specimen this was reverse-engineered from
    "curves_multi": 1.0,  # 3/3 -- multi-curve-per-layer specimen (2026-07-04)
    "curves_2books": 1.0,  # 2/2 -- cross-book-ordinal specimen (2026-07-04)
    "XAS": 1.0,  # 3/3 -- all 3 now via the 0x01-subtype all-columns token
    "RockingCurve": 1.0,  # 4/4 -- NbAuRocking's D+F (0x03) + Nb!B/NbAl!B (0x01)
    "UnpolPlots": 1.0,  # 8/8 -- all 8 now via the 0x01-subtype all-columns token
    "Fixed Lambdas SI": 1.0,  # 14/14 -- all 14 now via the 0x01-subtype all-columns token
}

# Stems that live directly in specimens/ (purpose-built, by-construction
# truth) rather than in the parent test-data/origin/ dir (the real corpus).
_SPECIMEN_DIR_STEMS = {"fig_pairs", "curves_multi", "curves_2books"}


@pytest.mark.realdata
@pytest.mark.parametrize(
    "stem",
    [
        "fig_pairs",
        "curves_multi",
        "curves_2books",
        "XAS",
        "RockingCurve",
        "UnpolPlots",
        "Fixed Lambdas SI",
    ],
)
def test_realdata_curve_bindings_vs_plots_oracle(stem: str) -> None:
    """Strict precision (every decoded curve must be IN the oracle, file-wide,
    no exceptions) plus a recall floor (must not regress below what's
    currently achieved) against the real per-plot ``plots.json`` oracle."""
    plots_path = _GT / stem / "plots.json"
    src = _SPEC / f"{stem}.opju" if stem in _SPECIMEN_DIR_STEMS else _SPEC.parent / f"{stem}.opju"
    if not src.exists() or not plots_path.exists():
        pytest.skip(f"corpus file/plots-oracle for '{stem}' not present on this machine")
    oracle = _oracle_pairs(plots_path)
    figs = extract_figures_opju(src.read_bytes())
    decoded = {(c["book"], c["y"]) for f in figs for c in f["curves"]}

    wrong = decoded - oracle
    assert not wrong, f"{stem}: decoded curve(s) contradict the oracle: {sorted(wrong)}"

    recall = len(decoded & oracle) / len(oracle) if oracle else 1.0
    floor = _RECALL_FLOOR[stem]
    assert recall >= floor - 1e-9, f"{stem}: recall {recall:.3f} regressed below floor {floor:.3f}"


# ── realdata: the GT-free all-columns map builder (item 35 rework) ───────────
#
# ``_allocated_column_map`` (opju_curves_allcols.py) is the piece that makes
# the 0x01-subtype token decodable WITHOUT a curve oracle: it recovers every
# book's total allocated-column count (including empty/undecoded books and
# columns) from name records alone. This guards that builder directly
# against each stem's independently-exported ``index.json`` book/column
# inventory -- the one oracle that WAS always available (unlike plots.json).


@pytest.mark.realdata
@pytest.mark.parametrize("stem", ["XAS", "RockingCurve", "UnpolPlots", "Fixed Lambdas SI"])
def test_realdata_allocated_column_map_matches_index(stem: str) -> None:
    """The GT-free ``_allocated_column_map`` must reproduce, for every book,
    the exact total column count ``index.json`` independently reports --
    including empty default books (XAS/UnpolPlots/"Fixed Lambdas SI"'s
    ``Book1``, 2 columns, never FPC-decoded) and books whose FPC-decoded
    column count (``book_columns_from_bytes``) is SMALLER than their true
    allocated count (e.g. RockingCurve's ``NbAu``: 7 allocated, only 6
    FPC-decodable) -- this map must report the larger, allocated total."""
    from quantized.io.origin_project.opju_curves_allcols import _allocated_column_map

    src = _SPEC.parent / f"{stem}.opju"
    index_path = _GT / stem / "index.json"
    if not src.exists() or not index_path.exists():
        pytest.skip(f"corpus file/ground-truth for '{stem}' not present on this machine")
    index = json.loads(index_path.read_text(encoding="utf-8"))
    expected = {
        book["book"]: sum(len(sheet["columns"]) for sheet in book["sheets"])
        for book in index["books"]
    }
    got = dict(_allocated_column_map(src.read_bytes()))
    assert got == expected, f"{stem}: allocated column map {got} != index.json {expected}"


# ── the global column-id table path (2026-07-05 rework) ──────────────────────
#
# The curve token's value is the plotted column's global creation-order id,
# resolved through the per-column id table stored in the windows section --
# see opju_figure_curves.py's module docstring for the byte grammar and the
# full validation trail (Hc2 per-graph oracle). These synthetics build a
# minimal id table + page headers, so extract_figures_opju takes the id
# path (the counting-fallback tests above deliberately build NO id table
# and keep exercising the legacy path).


def _opju_page_header(name: str) -> bytes:
    """A ``0a``-framed page header (`tree_opju._OPJU_WIN_RE` shape)."""
    nm = name.encode("latin1")
    return b"\x0a\x80\x01" + bytes([len(nm) + 2]) + b"\x00\x00" + nm + b"\x80"


def _column_id_record(
    cid: int, name: str, desig: str, partner: int | None = None, form_b: bool = False
) -> bytes:
    """One windows-section column record (form A/B) -- see opju_figure_curves."""
    head = (
        b"\x80\x32"
        + (b"\x07\x10\x01\x00\x00" if form_b else b"\x01\x10\x80\x03")
        + cid.to_bytes(2, "little")
        + b"\x0b"
    )
    nm = name.encode("latin1")
    if desig == "X":
        name_field = bytes([0x82, len(nm) + 1, 0x03]) + nm
        marker_field = b"\x83\x02\x21\x51"
    elif desig == "Y" and partner is not None:
        name_field = bytes([0x82, len(nm)]) + nm
        marker_field = b"\x81\x04" + partner.to_bytes(2, "little") + b"\x21\x61"
    elif desig == "Y":
        name_field = bytes([0x82, len(nm)]) + nm
        marker_field = b"\x83\x02\x21\x61"
    else:  # Y-error
        name_field = bytes([0x82, len(nm) + 1, 0x02]) + nm
        marker_field = b"\x83\x02\x30\x61"
    return head + name_field + b"\x88\x01\x09" + marker_field


def _id_curve_token(flag: int, cid: int, width: int = 3) -> bytes:
    """The unified curve token: u8 (width 1) or u16 LE + flag byte (width 3)."""
    if width == 1:
        return bytes([flag, 1, 1, 1, 0x80, 0x01, cid])
    return bytes([flag, 1, 1, 1, 0x80, 0x03]) + cid.to_bytes(2, "little") + b"\x09"


def _id_table_blob(*graph_payloads: bytes, records: bytes | None = None) -> bytes:
    """Magic + a WBook page carrying id records + one graph page per payload."""
    recs = records if records is not None else (
        _column_id_record(1, "A", "X")
        + _column_id_record(2, "B", "Y", partner=1)
        + _column_id_record(3, "C", "Y", partner=1)
    )
    out = b"CPYUA 4.3811 222\n" + _opju_page_header("WBook") + recs
    for i, payload in enumerate(graph_payloads, start=1):
        out += _opju_page_header(f"Graph{i}") + payload
    return out


def test_synthetic_id_table_resolves_u16_token_and_page_name() -> None:
    """A u16 curve token resolves through the id table (never a counting
    map), and the figure carries its graph page's own window name."""
    blob = _id_table_blob(
        _layer_bytes(0.0, 9.0, 0.0, 1000.0, 200.0, 0x03, r"\l(1) %(1)")
        + _id_curve_token(0xBA, cid=3)
    )
    figs = extract_figures_opju(blob)
    assert len(figs) == 1
    assert figs[0]["name"] == "Graph1"
    assert figs[0]["curves"] == [{"book": "WBook", "x": "A", "y": "C"}]


def test_synthetic_id_table_u8_token() -> None:
    """The 1-byte-id token form resolves through the same table."""
    blob = _id_table_blob(
        _layer_bytes(0.0, 9.0, 0.0, 1000.0, 200.0, 0x03, r"\l(1) %(1)")
        + _id_curve_token(0xBA, cid=2, width=1)
    )
    figs = extract_figures_opju(blob)
    assert len(figs) == 1
    assert figs[0]["curves"] == [{"book": "WBook", "x": "A", "y": "B"}]


def test_synthetic_id_table_unknown_id_dropped() -> None:
    """A token whose id has no column record resolves to nothing -- dropped,
    never guessed (the Hc2 Graph12-family deleted-column case)."""
    blob = _id_table_blob(
        _layer_bytes(0.0, 9.0, 0.0, 1000.0, 200.0, 0x03, r"\l(1) %(1)")
        + _id_curve_token(0xBA, cid=9)
    )
    figs = extract_figures_opju(blob)
    assert len(figs) == 1
    assert figs[0]["curves"] == []


def test_synthetic_id_table_form_b_record_resolves() -> None:
    """A column stored via the rarer form-B id record (``07 10 01 00 00``)
    resolves identically (RockingCurve NbAu!D / UnpolPlots PrNiO3STOprof!B)."""
    records = (
        _column_id_record(1, "A", "X")
        + _column_id_record(2, "B", "Y", partner=1, form_b=True)
    )
    blob = _id_table_blob(
        _layer_bytes(0.0, 9.0, 0.0, 1000.0, 200.0, 0x03, r"\l(1) %(1)")
        + _id_curve_token(0xBA, cid=2),
        records=records,
    )
    figs = extract_figures_opju(blob)
    assert len(figs) == 1
    assert figs[0]["curves"] == [{"book": "WBook", "x": "A", "y": "B"}]


def test_synthetic_id_table_x_partner_wins_over_book_x() -> None:
    """A Y column whose record stores an X-partner id pairs with THAT column,
    not the book's first X (the Hc2 ``Derivative Y1``/``Derivative X1`` case:
    AH pairs with AG, not column A)."""
    records = (
        _column_id_record(1, "A", "X")
        + _column_id_record(2, "B", "Y", partner=1)
        + _column_id_record(3, "C", "X")
        + _column_id_record(4, "D", "Y", partner=3)
    )
    blob = _id_table_blob(
        _layer_bytes(0.0, 9.0, 0.0, 1000.0, 200.0, 0x03, r"\l(1) %(1)")
        + _id_curve_token(0xBA, cid=4),
        records=records,
    )
    figs = extract_figures_opju(blob)
    assert len(figs) == 1
    assert figs[0]["curves"] == [{"book": "WBook", "x": "C", "y": "D"}]


def test_synthetic_id_table_window_scoped_to_page() -> None:
    """Each graph page's tokens bind only to that page's own figure -- the
    cross-window attribution leak the old [anchor, next_anchor) scoping had."""
    blob = _id_table_blob(
        _layer_bytes(0.0, 9.0, 0.0, 1000.0, 200.0, 0x03, r"\l(1) %(1)")
        + _id_curve_token(0xBA, cid=2),
        _layer_bytes(0.0, 5.0, 0.0, 100.0, 20.0, 0x03, r"\l(1) %(1)")
        + _id_curve_token(0xBB, cid=3),
    )
    figs = extract_figures_opju(blob)
    assert len(figs) == 2
    assert figs[0]["name"] == "Graph1"
    assert figs[0]["curves"] == [{"book": "WBook", "x": "A", "y": "B"}]
    assert figs[1]["name"] == "Graph2"
    assert figs[1]["curves"] == [{"book": "WBook", "x": "A", "y": "C"}]


# ── realdata: per-graph bindings vs the populated index.json oracle ──────────
#
# 'Hc2 data' is the first corpus export whose ``graphs[].layers[].plots``
# came back populated (the older stems' index.json carries empty plots
# lists -- those assert nothing per-graph and are covered file-wide by
# plots.json above). The oracle itself is TRUNCATED by Origin's eval page
# limit, so it is authoritative for the bindings of the graphs it lists,
# never a completeness denominator.


@pytest.mark.realdata
def test_realdata_hc2_per_graph_bindings_vs_index_oracle() -> None:
    """Every decoded figure whose page name matches an oracle graph must have
    ZERO wrong bindings; at least 7 of the 8 oracle graphs that exist as real
    graph pages must match the oracle exactly (all but Graph5, the documented
    tokenless negative -- see opju_figure_curves.py's module docstring)."""
    src = _SPEC.parent / "Hc2 data.opju"
    index_path = _GT / "Hc2 data" / "index.json"
    if not src.exists() or not index_path.exists():
        pytest.skip("Hc2 corpus file/ground-truth not present on this machine")
    index = json.loads(index_path.read_text(encoding="utf-8"))
    oracle: dict[str, set[tuple[str, str]]] = {}
    for g in index["graphs"]:
        refs = [ref for layer in g["layers"] for ref in layer.get("plots", [])]
        pairs = {
            (m.group("book"), m.group("col"))
            for ref in refs
            if (m := _PLOT_REF_RE.match(ref))
        }
        if pairs:
            oracle[g["graph"]] = pairs

    figs = extract_figures_opju(src.read_bytes())
    named: dict[str, set[tuple[str, str]]] = {}
    for f in figs:
        if f["name"]:
            named.setdefault(f["name"], set()).update(
                (c["book"], c["y"]) for c in f["curves"]
            )

    exact = []
    for gname, pairs in oracle.items():
        decoded = named.get(gname)
        if decoded is None:
            continue  # graph page not decoded (or not a page at all): missing, not wrong
        wrong = decoded - pairs
        assert not wrong, f"Hc2 {gname}: wrong binding(s) {sorted(wrong)}"
        if decoded == pairs:
            exact.append(gname)
    assert len(exact) >= 7, f"Hc2: only {sorted(exact)} matched the oracle exactly"
    # Graph5 is the sole known incomplete page: bindings missing, never wrong.
    assert named.get("Graph5") == set(), "Graph5 grew bindings -- re-verify before trusting"


@pytest.mark.realdata
def test_realdata_hc2_opju_text_routing_matches_opj_conversion() -> None:
    """hc2convert.opj is a COM Save-As of the same project as Hc2 data.opju
    (saved at a slightly different edit state). For every shared graph whose
    LAYER STATE matches across the two containers (same axis ranges and same
    curve (book, column) multiset -- i.e. the same window snapshot), the
    independently-framed .opju text routing must produce IDENTICAL x/y/y2
    titles, legend labels, AND annotations to the independently-decoded .opj
    (2026-07-05: 24 of 32 shared graphs state-match; 0 mismatched fields).
    Graphs whose state diverged between the two saves are excluded by the
    guard, not compared -- each container is decoded faithfully to its own
    bytes (verified live: .opju Graph3 is the 6-curve R/R_N-normalized edit,
    y range (-0.1, 1.1), where .opj still holds the older 3-curve resistance
    plot, y (-0.05, 0.45); Graph7/9/15/22 dropped their legends for "T ="
    text labels; Graph28/29 gained a \\g(m)\\-(0) title prefix)."""
    from quantized.io.origin_project.figures import extract_figures

    src = _SPEC.parent / "Hc2 data.opju"
    conv = _SPEC.parent / "hc2convert.opj"
    if not src.exists() or not conv.exists():
        pytest.skip("Hc2 .opju/.opj corpus pair not present on this machine")
    opju = {}
    for f in extract_figures_opju(src.read_bytes()):
        if f["name"]:
            opju.setdefault(f["name"], f)
    opj = {}
    for f in extract_figures(conv.read_bytes()):
        opj.setdefault(f["name"], f)

    def _same_state(a: dict, b: dict) -> bool:  # type: ignore[type-arg]
        ranges = all(
            abs(a[k] - b[k]) <= 1e-9 * max(1.0, abs(a[k]), abs(b[k]))
            for k in ("x_from", "x_to", "y_from", "y_to")
        )
        curves_a = sorted((c["book"], c["y"]) for c in a["curves"])
        curves_b = sorted((c["book"], c["y"]) for c in b["curves"])
        return ranges and curves_a == curves_b

    matched = [g for g in sorted(set(opju) & set(opj)) if _same_state(opju[g], opj[g])]
    assert len(matched) >= 20, f"only {len(matched)} state-matched graphs -- corpus changed?"
    mismatches = [
        (g, key, opju[g][key], opj[g][key])
        for g in matched
        for key in ("x_title", "y_title", "y2_title", "legend_labels", "annotations")
        if opju[g][key] != opj[g][key]
    ]
    assert not mismatches, f"routed .opju text disagrees with the .opj decode: {mismatches}"
    # Graph1 pinned exactly (state-matched flagship: hand-edited titles, a
    # hand-edited legend, and a 2-line floating text annotation).
    g1 = opju["Graph1"]
    assert g1["x_title"] == "Applied Magnetic Field μ₀H (T)"
    assert g1["y_title"] == "Resistance (Ohms)"
    assert g1["legend_labels"] == ["Nb", "Nb/Al", "Nb/Au"]
    assert g1["annotations"] == ["Field applied in-plane", "T = 1.3 K"]


@pytest.mark.realdata
def test_realdata_hc2_opju_titles_match_live_com_oracle() -> None:
    """The strongest title oracle: 'Hc2 data'/index.json's ``x_title_raw``/
    ``y_title_raw`` came from live COM against this very .opju (truncated by
    Origin's eval page limit to Graph1/2/4/5/6/8/10/11 -- 16 title slots).
    Every routed title must equal the oracle's exactly (auto-templates
    ``%(?X)``/``%(?Y)`` map to ``""``, hand-edited titles to their
    rich-text-cleaned form). 16/16 exact at pin time (2026-07-05)."""
    from quantized.io.origin_project.origin_richtext import clean_richtext

    src = _SPEC.parent / "Hc2 data.opju"
    index_path = _GT / "Hc2 data" / "index.json"
    if not src.exists() or not index_path.exists():
        pytest.skip("Hc2 corpus file/ground-truth not present on this machine")
    index = json.loads(index_path.read_text(encoding="utf-8"))
    named = {}
    for f in extract_figures_opju(src.read_bytes()):
        if f["name"]:
            named.setdefault(f["name"], f)
    checked = 0
    for g in index["graphs"]:
        if not g["graph"].startswith("Graph") or not g["layers"]:
            continue
        layer = g["layers"][0]
        fig = named.get(g["graph"])
        assert fig is not None, f"{g['graph']}: no decoded figure"
        for key, raw in (
            ("x_title", layer.get("x_title_raw", {}).get("xb")),
            ("y_title", layer.get("y_title_raw", {}).get("yl")),
        ):
            if raw is None:
                continue
            want = "" if raw in ("%(?X)", "%(?Y)") else clean_richtext(raw)
            assert fig[key] == want, f"{g['graph']}.{key}: {fig[key]!r} != oracle {want!r}"
            checked += 1
    assert checked >= 16, f"only {checked} oracle title slots checked -- oracle changed?"


@pytest.mark.realdata
def test_realdata_rockingcurve_figures_carry_page_names() -> None:
    """Real graph pages label their figures with the window's own name."""
    src = _SPEC.parent / "RockingCurve.opju"
    if not src.exists():
        pytest.skip("RockingCurve corpus file not present on this machine")
    figs = extract_figures_opju(src.read_bytes())
    names = {f["name"] for f in figs}
    assert {"Graph1", "Graph2", "NbAuRocking"} <= names


def test_clean_annotations_drops_system_and_png_noise() -> None:
    # The real Hc2 annotation shape: internal storage markers, the real title,
    # then the embedded-PNG thumbnail bytes decoded as text.
    raw = [
        "SYSTEM",
        "AxesDlgSettings",
        "<OriginStorage><UseSameOptions>{1073741893=0,",
        "dR/dB",
        r"/Applied Magnetic Field \g(\i(m))\-(0)\i(H) (T)",
        "-__STYLEHOLDERSOURCEINFO",
        "Sheet1<",
        "T = 1.3 K",
        "IHDR",
        "IDATx",
        "2YMcD",
    ]
    cleaned = _clean_annotations(raw)
    # internal markers, sheet ref, and everything at/after the PNG chunk are gone
    assert cleaned == [
        "dR/dB",
        r"/Applied Magnetic Field \g(\i(m))\-(0)\i(H) (T)",
        "T = 1.3 K",
    ]
    assert "SYSTEM" not in cleaned and "IHDR" not in cleaned


def test_drop_nonactionable_keeps_curves_or_source_only() -> None:
    curve = [{"book": "B", "x": 0, "y": 1}]
    figs = [
        {"annotations": ["dR/dB"], "curves": [], "source_hint": ""},  # neither → drop
        {"annotations": ["A"], "curves": curve, "source_hint": ""},  # has curves → keep
        {"annotations": [], "curves": [], "source_hint": "Book3"},  # has source → keep
        {"annotations": ["SYSTEM"], "curves": [], "source_hint": "  "},  # blank source → drop
    ]
    kept = drop_nonactionable_figures(figs)
    assert len(kept) == 2
    assert kept[0]["annotations"] == ["A"]  # curve-bound
    assert kept[1]["source_hint"] == "Book3"  # source-resolvable

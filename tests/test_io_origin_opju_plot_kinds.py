"""``.opju`` area / step plot kinds (``opju_plot_kinds``;
plans/ORIGIN_PLOT_TYPE_PARITY_PLAN.md item 5)."""

from __future__ import annotations

from quantized.io.origin_project.opju_plot_gates import CONNECT_OFF, PLOT_TYPE_OFF
from quantized.io.origin_project.opju_plot_kinds import (
    apply_marker_modifiers,
    apply_plot_kind,
    token_modifiers,
)


def _record(kind: int, connect: int) -> bytes:
    rec = bytearray(400)
    rec[PLOT_TYPE_OFF] = kind
    rec[CONNECT_OFF] = connect
    return bytes(rec)


def test_area_plot_type() -> None:
    curve: dict[str, str | float] = {"book": "B", "x": "A", "y": "B"}
    apply_plot_kind(curve, _record(0xCC, 1))
    assert curve["plotType"] == "area"


def test_step_connect_on_a_line_plot_is_a_step_and_drops_the_line_style() -> None:
    curve: dict[str, str | float] = {"book": "B", "x": "A", "y": "B", "style": "line"}
    apply_plot_kind(curve, _record(0xC8, 11))
    assert curve["plotType"] == "step"
    assert "style" not in curve


def test_other_records_get_no_plot_type() -> None:
    for kind, connect in ((0xC8, 1), (0xC9, 0), (0xCA, 1), (0xD9, 1)):
        curve: dict[str, str | float] = {"book": "B", "x": "A", "y": "B", "style": "line"}
        apply_plot_kind(curve, _record(kind, connect))
        assert "plotType" not in curve, hex(kind)
    # 214 stacked area / 205 high-low-close: a provisional kind ``opju_bar_kinds``
    # resolves per layer (an area for a stack of one, else left out)
    for kind, provisional in ((0xD6, "stacked_area"), (0xCD, "not_drawn")):
        curve = {"book": "B", "x": "A", "y": "B", "style": "line"}
        apply_plot_kind(curve, _record(kind, 1))
        assert curve["plotType"] == provisional, hex(kind)
    curve = {"book": "B", "x": "A", "y": "B"}
    apply_plot_kind(curve, None)
    assert curve == {"book": "B", "x": "A", "y": "B"}


# -- bubble / colour-mapped modifier columns (plan item 7) -----------------


def _mod_block(*entries: str) -> bytes:
    body = b"".join(bytes([len(e.encode())]) + e.encode() for e in entries)
    return b"\x0bSYSTEM\x03\x00\xce\x02\x01\xd0\x02\x06" + bytes([len(entries)]) + body


def _marker_record(size: bytes = b"\xa0\x0f", edge: bytes = b"\x00\x00\x00\x00") -> bytes:
    rec = bytearray(519)
    rec[PLOT_TYPE_OFF] = 0xC9
    rec[25:27] = size
    rec[306:310] = edge
    return bytes(rec)


def _mods(*entries: str) -> list[tuple[int, str]] | None:
    b = b"\x00" * 8 + _mod_block(*entries) + b"\x00" * 8
    return token_modifiers(b, 0, len(b))


def test_modifier_block_entries() -> None:
    assert _mods("12|Clean_C", "9|Clean_C") == [(12, "Clean_C"), (9, "Clean_C")]
    assert token_modifiers(b"\x00" * 40, 0, 40) is None
    truncated = _mod_block("18|Clean_C")[:-3]
    assert token_modifiers(truncated, 0, len(truncated)) is None


def test_bubble_size_column_and_its_sentinel_size() -> None:
    curve: dict[str, str | float] = {"book": "Clean", "x": "A", "y": "B", "symbolSize": 0.202}
    apply_marker_modifiers(curve, _mods("12|Clean_C", "9|Clean_C"), _marker_record(b"\x65\x00"))
    assert curve["sizeBy"] == "C" and "symbolSize" not in curve


def test_colour_mapped_column_on_the_curve_sheet() -> None:
    curve: dict[str, str | float] = {"book": "Bk@2", "x": "A", "y": "B"}
    apply_marker_modifiers(curve, _mods("18|Bk_F@2"), _marker_record(edge=b"\x65\x00\x40\x00"))
    assert curve["colorBy"] == "F"


def test_unproven_modifiers_leave_the_curve_alone() -> None:
    mapped = b"\x65\x00\x40\x00"
    cases = [
        (_mods("9|Clean_C"), _marker_record()),  # size field is not "from the column"
        (_mods("18|Clean_C"), _marker_record(edge=b"\x65\x00\x00\x00")),  # indexed colour
        (_mods("18|Clean_C"), _marker_record(edge=b"\x71\x00\x48\x00")),  # unproven flag
        (_mods("18|Other_C"), _marker_record(edge=mapped)),  # another book
        (_mods("18|Clean_C@2"), _marker_record(edge=mapped)),  # another sheet
        (_mods("19|Clean_C", "18|Clean_C"), _marker_record(edge=mapped)),
        (_mods("12|Clean_C", "9|Clean_D"), _marker_record(b"\x65\x00")),
        (None, _marker_record(b"\x65\x00")),
    ]
    for mods, rec in cases:
        curve: dict[str, str | float] = {"book": "Clean", "x": "A", "y": "B"}
        apply_marker_modifiers(curve, mods, rec)
        assert curve == {"book": "Clean", "x": "A", "y": "B"}, mods
    line = bytearray(_marker_record(b"\x65\x00"))
    line[PLOT_TYPE_OFF] = 0xC8
    curve = {"book": "Clean", "x": "A", "y": "B"}
    apply_marker_modifiers(curve, _mods("9|Clean_C"), bytes(line))
    assert "sizeBy" not in curve

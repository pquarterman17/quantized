"""``.opju`` area / step plot kinds (``opju_plot_kinds``;
plans/ORIGIN_PLOT_TYPE_PARITY_PLAN.md item 5)."""

from __future__ import annotations

from quantized.io.origin_project.opju_plot_gates import CONNECT_OFF, PLOT_TYPE_OFF
from quantized.io.origin_project.opju_plot_kinds import apply_plot_kind


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
    for kind, connect in ((0xC8, 1), (0xC9, 0), (0xCA, 1), (0xD6, 1), (0xCC + 1, 1)):
        curve: dict[str, str | float] = {"book": "B", "x": "A", "y": "B", "style": "line"}
        apply_plot_kind(curve, _record(kind, connect))
        assert "plotType" not in curve, hex(kind)
    curve = {"book": "B", "x": "A", "y": "B"}
    apply_plot_kind(curve, None)
    assert curve == {"book": "B", "x": "A", "y": "B"}

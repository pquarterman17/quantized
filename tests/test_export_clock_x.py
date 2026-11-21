"""A time-of-day X (``metadata["time_is_clock"]``) exports with the clock
tick mode, as the canvas draws it, instead of plain seconds."""

from types import SimpleNamespace

from quantized.calc.axis_categories import XAxisKind
from quantized.routes.export_figures_schema import TickFormatSpec, _x_tick_fmt


def _resolved(**kw: object) -> SimpleNamespace:
    return SimpleNamespace(x_axis=XAxisKind(**kw))  # type: ignore[arg-type]


def test_auto_on_a_clock_x_exports_as_clock() -> None:
    fmt = _x_tick_fmt(None, _resolved(is_clock=True))  # type: ignore[arg-type]
    assert fmt is not None and fmt["mode"] == "clock"


def test_explicit_mode_on_a_clock_x_is_kept() -> None:
    fmt = _x_tick_fmt(TickFormatSpec(mode="fixed"), _resolved(is_clock=True))  # type: ignore[arg-type]
    assert fmt is not None and fmt["mode"] == "fixed"


def test_clock_mode_is_accepted_on_the_wire() -> None:
    assert TickFormatSpec(mode="clock").mode == "clock"


def test_plain_x_stays_auto() -> None:
    fmt = _x_tick_fmt(None, _resolved())  # type: ignore[arg-type]
    assert fmt is None or fmt.get("mode", "auto") == "auto"

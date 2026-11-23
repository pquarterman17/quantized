"""Point labels (gap audit 8, LBL): validation and export drawing."""

from __future__ import annotations

import numpy as np
import pytest

from quantized.calc.figure import render_figure
from quantized.calc.figure_point_labels import (
    MAX_POINT_LABELS,
    apply_point_labels,
    validate_point_labels,
)

X = np.linspace(0.0, 9.0, 10)
Y = X * 2.0
GOOD = {
    "points": [
        {"x": 1.0, "y": 2.0, "text": "S-1", "s": 0},
        {"x": 5.0, "y": 10.0, "text": "S-5", "s": 0},
    ]
}


def _svg(point_labels: object, **kw: object) -> str:
    ov = {} if point_labels is None else {"point_labels": point_labels}
    ov.update(kw.pop("ov", {}))  # type: ignore[arg-type]
    out = render_figure(X, [("sample", Y)], fmt="svg", overrides=ov, **kw)  # type: ignore[arg-type]
    return out.decode() if isinstance(out, bytes) else str(out)


def test_absent_means_nothing_drawn_and_nothing_validated() -> None:
    assert validate_point_labels({}) == ([], None)
    assert "S-1" not in _svg(None)


def test_labels_and_note_reach_the_export() -> None:
    text = _svg({**GOOD, "note": "1 of 2 labels drawn; 1 crowded label left out"})
    # Default SVG text may be glyph paths; the strings are kept as comments/ids by matplotlib.
    assert "S-1" in text and "S-5" in text
    assert "crowded label left out" in text


def test_a_note_alone_draws_without_points() -> None:
    assert "Point labels are not drawn" in _svg(
        {"points": [], "note": "Point labels are not drawn here"}
    )


def test_labels_do_not_widen_the_limits() -> None:
    import matplotlib

    matplotlib.use("Agg")
    from matplotlib.figure import Figure

    ax = Figure().add_subplot()
    line = ax.plot(X, Y)[0]
    before = (ax.get_xlim(), ax.get_ylim())
    far = {"points": [{"x": 1e6, "y": 1e6, "text": "far", "s": 0}]}
    apply_point_labels(ax, {"point_labels": far}, [line])
    assert (ax.get_xlim(), ax.get_ylim()) == before


def test_series_colour_follows_the_series_index() -> None:
    import matplotlib

    matplotlib.use("Agg")
    from matplotlib.figure import Figure

    ax = Figure().add_subplot()
    a = ax.plot(X, Y, color="#ff0000")[0]
    b = ax.plot(X, Y + 1, color="#0000ff")[0]
    pts = {
        "points": [
            {"x": 1.0, "y": 2.0, "text": "A", "s": 0},
            {"x": 2.0, "y": 5.0, "text": "B", "s": 1},
        ]
    }
    apply_point_labels(ax, {"point_labels": pts}, [a, b])
    colours = {t.get_text(): t.get_color() for t in ax.texts}
    assert colours == {"A": "#ff0000", "B": "#0000ff"}


@pytest.mark.parametrize(
    "bad",
    [
        "nope",
        {"points": "x"},
        {"points": [{"x": float("nan"), "y": 1.0, "text": "a", "s": 0}]},
        {"points": [{"x": 1.0, "y": True, "text": "a", "s": 0}]},
        {"points": [{"x": 1.0, "y": 1.0, "text": "", "s": 0}]},
        {"points": [{"x": 1.0, "y": 1.0, "text": "x" * 201, "s": 0}]},
        {"points": [{"x": 1.0, "y": 1.0, "text": "a", "s": -1}]},
        {"points": [{"x": 1.0, "y": 1.0, "text": "a", "s": 0}], "note": 3},
        {"points": [{"x": 1.0, "y": 1.0, "text": "a", "s": 0}] * (MAX_POINT_LABELS + 1)},
    ],
)
def test_malformed_lists_are_refused(bad: object) -> None:
    with pytest.raises(ValueError):
        validate_point_labels({"point_labels": bad})


def test_refuses_exchanged_axes_breaks_and_horizontal_bars() -> None:
    with pytest.raises(ValueError, match="exchange_xy"):
        _svg(GOOD, ov={"exchange_xy": True})
    with pytest.raises(ValueError, match="x_breaks"):
        _svg(GOOD, ov={"x_breaks": [[4.0, 5.0]]})
    with pytest.raises(ValueError, match="horizontal bars"):
        _svg(GOOD, series_styles=[{"bars": "horizontal"}])


def test_a_refusal_note_alone_still_exports_on_a_view_the_labels_refuse() -> None:
    """The live plot prints "Point labels are not drawn ..." there; the export must too, not 422."""
    note = {"points": [], "note": "Point labels are not drawn with exchanged X and Y axes"}
    assert "exchanged X and Y axes" in _svg(note, ov={"exchange_xy": True})
    assert "exchanged X and Y axes" in _svg(note, series_styles=[{"bars": "horizontal"}])
    with pytest.raises(ValueError, match="x_breaks"):
        _svg(note, ov={"x_breaks": [[4.0, 5.0]]})


def test_labels_leave_autoscale_as_they_found_it() -> None:
    import matplotlib

    matplotlib.use("Agg")
    from matplotlib.figure import Figure

    ax = Figure().add_subplot()
    line = ax.plot(X, Y)[0]
    apply_point_labels(ax, {"point_labels": GOOD}, [line])
    assert ax.get_autoscalex_on() and ax.get_autoscaley_on()

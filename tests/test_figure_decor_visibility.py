"""Region shades and reference lines never vanish silently (publication-
figures audit #11).

A shade inserted with the old default y1 = 0 .. y2 = 1 drew nothing on a log
axis (0 has no position) and was silently missing from the export; a
reference line placed off the axis range gave no hint either. Now a
``full_height`` shade spans the axes on any scale, a data-y shade with a side
<= 0 runs from the log axis floor, and whatever still cannot be seen is
reported as a render warning.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pytest
from matplotlib.patches import Rectangle

import quantized.calc.figure as figure_mod
from quantized.calc.figure import render_figure
from quantized.calc.figure_warnings import collect_figure_warnings


def _render(
    monkeypatch: pytest.MonkeyPatch, *, y_scale: str = "linear", **ov: Any
) -> tuple[Any, list[str]]:
    seen: list[Any] = []
    real = figure_mod.savefig_bytes

    def spy(fig: Any, fmt: str, **kw: Any) -> bytes:
        seen.append(fig)
        return real(fig, fmt, **kw)

    monkeypatch.setattr(figure_mod, "savefig_bytes", spy)
    x = np.linspace(0.1, 9.9, 20)
    with collect_figure_warnings() as notes:
        render_figure(
            x, [("I", 1e5 * np.exp(-x / 2))], fmt="png", dpi=40, y_scale=y_scale, overrides=ov
        )
    return seen[-1].axes[0], notes


def _shade_patches(ax: Any) -> list[Any]:
    return [p for p in ax.patches if isinstance(p, Rectangle) and p.get_alpha() == 0.25]


def test_a_full_height_shade_spans_a_log_axis(monkeypatch: pytest.MonkeyPatch) -> None:
    shade = {"x1": 2.0, "x2": 4.0, "y1": 0.0, "y2": 1.0, "fill": "#3388cc", "full_height": True}
    ax, notes = _render(monkeypatch, y_scale="log", region_shades=[shade])
    patches = _shade_patches(ax)
    assert len(patches) == 1
    # Axes-fraction y: the patch covers the whole axes height.
    box = patches[0].get_window_extent()
    axes_box = ax.get_window_extent()
    assert box.y0 == pytest.approx(axes_box.y0, abs=1) and box.y1 == pytest.approx(
        axes_box.y1, abs=1
    )
    assert notes == []


def test_a_zero_floor_shade_runs_from_the_log_axis_floor(monkeypatch: pytest.MonkeyPatch) -> None:
    shade = {"x1": 2.0, "x2": 4.0, "y1": 0.0, "y2": 1e3, "fill": "#3388cc"}
    ax, notes = _render(monkeypatch, y_scale="log", region_shades=[shade])
    patches = _shade_patches(ax)
    assert len(patches) == 1
    assert patches[0].get_y() == pytest.approx(min(ax.get_ylim()))
    assert notes == []


def test_a_shade_below_zero_on_a_log_axis_is_reported(monkeypatch: pytest.MonkeyPatch) -> None:
    shade = {"x1": 2.0, "x2": 4.0, "y1": -5.0, "y2": 0.0, "fill": "#3388cc"}
    ax, notes = _render(monkeypatch, y_scale="log", region_shades=[shade])
    assert _shade_patches(ax) == []
    assert any("Region shade 1" in n and "log axis" in n for n in notes)


def test_an_off_scale_reference_line_is_reported(monkeypatch: pytest.MonkeyPatch) -> None:
    _, notes = _render(
        monkeypatch, ref_lines=[{"axis": "x", "value": 25.0}, {"axis": "x", "value": 5.0}]
    )
    assert len(notes) == 1
    assert "x = 25" in notes[0] and "outside the x axis range" in notes[0]


def test_an_off_scale_shade_is_reported(monkeypatch: pytest.MonkeyPatch) -> None:
    shade = {"x1": 50.0, "x2": 60.0, "y1": 0.0, "y2": 1.0, "fill": "#3388cc", "full_height": True}
    _, notes = _render(monkeypatch, region_shades=[shade])
    assert any("Region shade 1" in n and "not visible" in n for n in notes)


def test_full_height_must_be_a_boolean() -> None:
    x = np.linspace(0.0, 1.0, 3)
    shade = {"x1": 0.0, "x2": 1.0, "fill": "#3388cc", "full_height": "yes"}
    with pytest.raises(ValueError, match="full_height"):
        render_figure(x, [("a", x)], overrides={"region_shades": [shade]})


def test_a_full_height_shade_needs_no_y() -> None:
    x = np.linspace(0.0, 1.0, 3)
    shade = {"x1": 0.2, "x2": 0.4, "fill": "#3388cc", "full_height": True}
    assert render_figure(x, [("a", x)], fmt="png", dpi=30, overrides={"region_shades": [shade]})


def test_an_unlabelled_reference_line_warning_states_its_value_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, notes = _render(monkeypatch, ref_lines=[{"axis": "x", "value": 25.0}])
    assert notes == [
        "Reference line x = 25 is outside the x axis range (0.1 to 9.9) and is not visible."
    ]


def test_a_text_box_pads_by_its_screen_pixels_not_a_fixed_quarter_font(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Live check (audit #11): the exported text box was ~3x the screen's
    (pad px / 4 font-sizes), big enough to cover an arrow drawn to it. Its
    padding is now the screen's CSS px converted exactly (x 0.75 pt)."""
    seen: list[Any] = []
    real = figure_mod.savefig_bytes

    def spy(fig: Any, fmt: str, **kw: Any) -> bytes:
        out = real(fig, fmt, **kw)
        r = fig.canvas.get_renderer()
        txt = fig.axes[0].texts[0]
        # The patch keeps the geometry of the 72-dpi PNG draw (1 pt = 1 px).
        seen.append(txt.get_bbox_patch().get_window_extent(r).height)
        return out

    monkeypatch.setattr(figure_mod, "savefig_bytes", spy)
    x = np.linspace(0.0, 1.0, 5)
    for pad in (4, 16):
        ann = {"x": 0.5, "y": 0.5, "text": "tau = 2 s", "frame": {"pad": pad}}
        render_figure(x, [("a", x)], fmt="png", dpi=72, overrides={"annotations": [ann]})
    small, big = seen[-2:]
    # 12 more CSS px a side = 9 pt a side = 18 px taller at 72 dpi (the old
    # px/4-font-sizes rule gave 60).
    assert big - small == pytest.approx(18.0, abs=1.0)

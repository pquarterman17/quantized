"""Guard tests for the publication figure-style table.

These are transcription guards: the values are frozen from
``quantized_matlab/+styles/template.m`` (the behavioural reference). If MATLAB
changes a spec, update both the source and these expectations together.
"""

from __future__ import annotations

import pytest

from quantized.calc.figure_styles import FIGURE_STYLES, figure_style, style_names


def test_default_listed_first() -> None:
    names = style_names()
    assert names[0] == "default"
    assert set(names) == set(FIGURE_STYLES)


@pytest.mark.parametrize(
    ("name", "font", "fs", "lw", "w_cm", "dpi", "grid_alpha", "legend_box"),
    [
        # name           font               fs   lw    w_cm  dpi  grid  legend_box
        ("aps", "Helvetica", 9, 1.25, 8.6, 600, 0.0, False),
        ("nature", "Arial", 7, 1.0, 8.9, 600, 0.0, False),
        ("thesis", "Times New Roman", 11, 1.5, 15.0, 300, 0.15, True),
        ("report", "Times New Roman", 10, 1.4, 12.0, 300, 0.0, True),
        ("web", "Arial", 13, 2.0, 16.0, 150, 0.12, False),
        ("presentation", "Arial", 18, 2.5, 25.0, 150, 0.2, False),
        ("poster", "Arial", 24, 3.0, 30.0, 150, 0.15, False),
    ],
)
def test_template_values_match_matlab(
    name: str,
    font: str,
    fs: float,
    lw: float,
    w_cm: float,
    dpi: int,
    grid_alpha: float,
    legend_box: bool,
) -> None:
    st = figure_style(name)
    assert st.font_name == font
    assert st.font_size == fs
    assert st.line_width == lw
    assert st.fig_width_cm == w_cm
    assert st.dpi == dpi
    assert st.grid_alpha == grid_alpha
    assert st.legend_box == legend_box


def test_cm_to_inch_conversion() -> None:
    st = figure_style("aps")
    assert st.fig_width_in == pytest.approx(8.6 / 2.54)
    assert st.fig_height_in == pytest.approx(6.5 / 2.54)


def test_font_generic_picks_serif_for_times() -> None:
    assert figure_style("report").font_generic == "serif"
    assert figure_style("aps").font_generic == "sans-serif"


def test_unknown_style_raises() -> None:
    with pytest.raises(ValueError, match="unknown style"):
        figure_style("definitely-not-a-style")

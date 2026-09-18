"""BUG-016: a grouped figure's per-level series carry their channel's style.

The pure half of the fix -- ``calc.figure_group_styles.
expand_grouped_series_styles``, the mapping ``routes.export_figures``' thin
``group_col`` branch delegates to. The RENDERED half (that the expanded list
really reaches the SVG's artists) lives in
``tests/test_export_vector_structure.py``; a mapping test alone could not see
a route that built the right list and then dropped it, which is the shape
BUG-016 itself had.
"""

from __future__ import annotations

from typing import Any

from quantized.calc.figure_group_styles import expand_grouped_series_styles

_STYLE: dict[str, Any] = {"color": "#ff0000", "line": "dashed", "width": 3}


def test_one_channel_repeats_its_style_once_per_level() -> None:
    out = expand_grouped_series_styles([_STYLE], 1, 3)
    assert out == [_STYLE, _STYLE, _STYLE]


def test_the_nesting_is_channel_major_level_minor() -> None:
    # The SAME nesting `build_grouped_series` produces (channel, then level),
    # which is what makes `i // n_levels` the right channel for series `i`.
    a: dict[str, Any] = {"color": "#ff0000"}
    b: dict[str, Any] = {"color": "#0000ff"}
    assert expand_grouped_series_styles([a, b], 2, 6) == [a, a, a, b, b, b]


def test_an_unstyled_channel_stays_unstyled_on_every_level() -> None:
    a: dict[str, Any] = {"width": 2}
    assert expand_grouped_series_styles([None, a], 2, 4) == [None, None, a, a]


def test_a_missing_trailing_entry_is_treated_as_unstyled() -> None:
    # `series_styles` is a loose wire list and may be short; a ragged list
    # degrades rather than raising (the contract `resolve_style_channels`
    # documents for every key in that dict).
    assert expand_grouped_series_styles([_STYLE], 2, 4) == [_STYLE, _STYLE, None, None]


def test_an_empty_style_dict_is_the_same_as_no_style() -> None:
    assert expand_grouped_series_styles([{}], 1, 2) == [None, None]


def test_no_styles_requested_stays_none() -> None:
    assert expand_grouped_series_styles(None, 2, 6) is None


def test_a_series_count_that_is_not_a_multiple_of_the_channels_degrades() -> None:
    # Nothing can be assigned soundly, so the branch renders exactly as it did
    # before BUG-016 rather than mis-assigning a style.
    assert expand_grouped_series_styles([_STYLE, _STYLE], 2, 5) is None


def test_zero_channels_or_zero_series_degrades() -> None:
    assert expand_grouped_series_styles([], 0, 0) is None
    assert expand_grouped_series_styles([_STYLE], 1, 0) is None


def test_color_by_and_its_colormap_are_dropped() -> None:
    # The canvas suppresses the colour-mapped scatter for a grouped render
    # (`Stage/usePlotPayload.ts` builds `colorByColumns` only when
    # `groupCol === null`), so honouring it here would draw a point cloud and a
    # colourbar the screen never showed.
    spec: dict[str, Any] = {"color": "#ff0000", "color_by": [1.0, 2.0], "colormap": "viridis"}
    assert expand_grouped_series_styles([spec], 1, 2) == [{"color": "#ff0000"}] * 2
    assert spec["color_by"] == [1.0, 2.0]  # the caller's dict is never mutated


def test_a_fill_reference_is_re_indexed_onto_the_expanded_series_list() -> None:
    # `resolve_style_channels` resolved `vs` to a display position among the
    # plotted CHANNELS; the renderer indexes the expanded list. The canvas
    # resolves the same reference with `plotted.indexOf(vs)` over its expanded
    # channel map -- the FIRST level of that channel, i.e. `vs * n_levels`.
    spec: dict[str, Any] = {"fill": {"vs": 1}}
    assert expand_grouped_series_styles([spec, None], 2, 6) == [
        {"fill": {"vs": 3}},
        {"fill": {"vs": 3}},
        {"fill": {"vs": 3}},
        None,
        None,
        None,
    ]


def test_a_fill_under_passes_through_unchanged() -> None:
    assert expand_grouped_series_styles([{"fill": "under"}], 1, 2) == [{"fill": "under"}] * 2


def test_the_legend_rename_is_not_carried_into_a_style_entry() -> None:
    # BUG-014's `legend` is consumed at the route layer (`series_legends` names
    # the channel half of the level label); no renderer reads it off a style.
    assert expand_grouped_series_styles([{"legend": "Loop 1", "width": 2}], 1, 2) == [
        {"width": 2},
        {"width": 2},
    ]


def test_each_level_gets_its_own_dict() -> None:
    out = expand_grouped_series_styles([_STYLE], 1, 3)
    assert out is not None
    first = out[0]
    assert first is not None
    first["color"] = "#00ff00"
    assert [entry["color"] for entry in out[1:] if entry] == ["#ff0000", "#ff0000"]
    assert _STYLE["color"] == "#ff0000"

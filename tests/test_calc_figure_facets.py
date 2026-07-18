"""Faceted (small-multiples) publication rendering (calc.figure_facets,
gap #21 + GUI_INTERACTION #12 slice 4b). Magic-byte / non-trivial-size
checks only — the split itself (frontend lib/facet.facetPayloads) is
unit-tested on the row-partitioning logic; this only confirms the
matplotlib grid renders. `render_stat_facets_figure`/
`render_categorical_facets_figure` cover the StatStage box/violin/bar
"facet by" grid; their single-panel drawing is covered (and pixel-format
tested) in test_calc_figure_statplots.py/test_calc_figure_categorical.py —
these tests only confirm the GRID composition (panel count, per-facet kind
fidelity, malformed input)."""

from __future__ import annotations

import pytest

from quantized.calc.figure_facets import (
    render_categorical_facets_figure,
    render_facets_figure,
    render_stat_facets_figure,
)

_MAGIC = {"pdf": b"%PDF", "svg": b"<?xml", "png": b"\x89PNG"}


def _panels(n: int) -> list[dict]:
    return [
        {
            "label": f"level {i}",
            "x": [0, 1, 2, 3],
            "series": [{"label": "y", "y": [i, i + 1, i, i + 1]}],
        }
        for i in range(n)
    ]


@pytest.mark.parametrize("fmt", ["pdf", "svg", "png"])
@pytest.mark.parametrize("n", [1, 2, 3, 4, 5])
def test_renders_every_format_and_panel_count(fmt: str, n: int) -> None:
    out = render_facets_figure(_panels(n), fmt=fmt, title="t", x_label="x", y_label="y")
    assert out[: len(_MAGIC[fmt])] == _MAGIC[fmt]
    assert len(out) > 500


def test_tiff_magic_bytes() -> None:
    out = render_facets_figure(_panels(2), fmt="tiff", dpi=120)
    assert out[:4] in (b"II*\x00", b"MM\x00*")


def test_multi_series_per_panel_renders() -> None:
    panels = [
        {
            "label": "level 0",
            "x": [0, 1, 2],
            "series": [{"label": "a", "y": [1, 2, 3]}, {"label": "b", "y": [3, 2, 1]}],
        },
    ]
    out = render_facets_figure(panels, fmt="png")
    assert out[:4] == b"\x89PNG"


def test_non_square_panel_count_hides_unused_cells() -> None:
    # 5 panels -> a 3x2 grid with one hidden trailing cell; must not raise.
    out = render_facets_figure(_panels(5), fmt="pdf")
    assert out[:4] == b"%PDF"


def test_x_log_and_y_log_do_not_raise() -> None:
    panels = [{"label": "l", "x": [1, 2, 3], "series": [{"label": "y", "y": [1, 2, 3]}]}]
    out = render_facets_figure(panels, fmt="pdf", x_log=True, y_log=True)
    assert out[:4] == b"%PDF"


def test_panel_titles_render_in_svg() -> None:
    out = render_facets_figure(_panels(2), fmt="svg")
    svg = out.decode("utf-8", "ignore")
    assert "level 0" in svg
    assert "level 1" in svg


def test_bad_format_raises() -> None:
    with pytest.raises(ValueError, match="fmt"):
        render_facets_figure(_panels(1), fmt="bmp")


def test_empty_panels_raises() -> None:
    with pytest.raises(ValueError, match="non-empty"):
        render_facets_figure([])


def test_named_styles_render() -> None:
    for style in ("aps", "report", "web", "nature", "presentation"):
        out = render_facets_figure(_panels(2), fmt="pdf", style=style)
        assert out[:4] == b"%PDF"


# ── render_stat_facets_figure (GUI_INTERACTION #12 slice 4b: box/violin) ────

_GROUP_A = [1.0, 2.0, 3.0, 4.0, 5.0]
_GROUP_B = [2.0, 3.0, 4.0, 5.0, 6.0]


def _stat_panels(n: int, kind: str = "box") -> list[dict]:
    return [
        {"label": f"level {i}", "kind": kind, "data": [_GROUP_A, _GROUP_B], "labels": ["A", "B"]}
        for i in range(n)
    ]


@pytest.mark.parametrize("fmt", ["pdf", "svg", "png"])
@pytest.mark.parametrize("kind", ["box", "violin"])
def test_stat_facets_render_every_kind_and_format(fmt: str, kind: str) -> None:
    out = render_stat_facets_figure(
        _stat_panels(3, kind), default_kind=kind, fmt=fmt, title="t", y_label="value",
    )
    assert out[: len(_MAGIC[fmt])] == _MAGIC[fmt]
    assert len(out) > 500


def test_stat_facets_per_panel_kind_overrides_default() -> None:
    # A mixed grid (2 box + 1 violin) must not raise — per-facet mode
    # fidelity: a violin slice that degraded to box on screen carries its
    # own "kind" independent of the request's top-level default_kind.
    panels = [
        {"label": "a", "kind": "violin", "data": [_GROUP_A, _GROUP_B]},
        {"label": "b", "kind": "box", "data": [_GROUP_A, _GROUP_B]},
        {"label": "c", "data": [_GROUP_A, _GROUP_B]},  # omitted -> falls back to default_kind
    ]
    out = render_stat_facets_figure(panels, default_kind="violin", fmt="pdf")
    assert out[:4] == b"%PDF"


def test_stat_facets_panel_titles_render_in_svg() -> None:
    out = render_stat_facets_figure(_stat_panels(2), default_kind="box", fmt="svg")
    svg = out.decode("utf-8", "ignore")
    assert "level 0" in svg
    assert "level 1" in svg


def test_stat_facets_empty_panels_raises() -> None:
    with pytest.raises(ValueError, match="non-empty"):
        render_stat_facets_figure([], default_kind="box")


def test_stat_facets_bad_kind_raises() -> None:
    with pytest.raises(ValueError, match="facet kind must be"):
        render_stat_facets_figure(
            [{"label": "a", "kind": "swarm", "data": [_GROUP_A]}], default_kind="box",
        )


def test_stat_facets_bad_format_raises() -> None:
    with pytest.raises(ValueError, match="fmt"):
        render_stat_facets_figure(_stat_panels(1), default_kind="box", fmt="bmp")


def test_stat_facets_dpi_none_uses_style_preset() -> None:
    small = render_stat_facets_figure(
        _stat_panels(2), default_kind="box", fmt="png", style="web", dpi=None
    )
    large = render_stat_facets_figure(
        _stat_panels(2), default_kind="box", fmt="png", style="aps", dpi=None
    )
    assert len(large) > len(small)


# ── render_categorical_facets_figure (GUI_INTERACTION #12 slice 4b: bar) ────


def _bar_panels(n: int) -> list[dict]:
    return [
        {
            "label": f"level {i}",
            "groups": ["Low", "High"],
            "series": ["A", "B"],
            "values": [[10.0, 20.0], [15.0, 25.0]],
            "errors": [[1.0, None], [2.0, 3.0]],
        }
        for i in range(n)
    ]


@pytest.mark.parametrize("fmt", ["pdf", "svg", "png"])
@pytest.mark.parametrize("stacked", [False, True])
def test_categorical_facets_render_every_format_grouped_and_stacked(
    fmt: str, stacked: bool
) -> None:
    out = render_categorical_facets_figure(_bar_panels(3), stacked=stacked, fmt=fmt, title="t")
    assert out[: len(_MAGIC[fmt])] == _MAGIC[fmt]
    assert len(out) > 500


def test_categorical_facets_panels_may_have_different_category_sets() -> None:
    # A facet-column level can be absent from one slice — panels are
    # self-contained, never forced to share one `groups` list.
    panels = [
        {"label": "a", "groups": ["Low", "High"], "series": ["A"], "values": [[1.0], [2.0]]},
        {"label": "b", "groups": ["Low"], "series": ["A"], "values": [[3.0]]},
    ]
    out = render_categorical_facets_figure(panels, fmt="pdf")
    assert out[:4] == b"%PDF"


def test_categorical_facets_panel_titles_render_in_svg() -> None:
    out = render_categorical_facets_figure(_bar_panels(2), fmt="svg")
    svg = out.decode("utf-8", "ignore")
    assert "level 0" in svg
    assert "level 1" in svg


def test_categorical_facets_empty_panels_raises() -> None:
    with pytest.raises(ValueError, match="non-empty"):
        render_categorical_facets_figure([])


def test_categorical_facets_missing_groups_raises() -> None:
    with pytest.raises(ValueError, match="groups"):
        render_categorical_facets_figure(
            [{"label": "a", "groups": [], "series": ["A"], "values": []}]
        )


def test_categorical_facets_missing_series_raises() -> None:
    with pytest.raises(ValueError, match="series"):
        render_categorical_facets_figure(
            [{"label": "a", "groups": ["Low"], "series": [], "values": [[]]}]
        )


def test_categorical_facets_bad_format_raises() -> None:
    with pytest.raises(ValueError, match="fmt"):
        render_categorical_facets_figure(_bar_panels(1), fmt="bmp")

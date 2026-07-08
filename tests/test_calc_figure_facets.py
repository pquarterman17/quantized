"""Faceted (small-multiples) publication rendering (calc.figure_facets,
gap #21). Magic-byte / non-trivial-size checks only — the split itself
(frontend lib/facet.facetPayloads) is unit-tested on the row-partitioning
logic; this only confirms the matplotlib grid renders."""

from __future__ import annotations

import pytest

from quantized.calc.figure_facets import render_facets_figure

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

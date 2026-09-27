"""Grouped/stacked bar-chart publication rendering (calc.figure_categorical,
gap #20). Rendering can't be pixel-asserted, so these confirm each
mode/format produces a valid non-trivial file and malformed input is
rejected — the mean/SEM computation itself is tested on the frontend side
(lib/barlayout, cross-checked against a hand oracle)."""

from __future__ import annotations

import pytest

from quantized.calc.figure_categorical import render_categorical_figure

_MAGIC = {"pdf": b"%PDF", "svg": b"<?xml", "png": b"\x89PNG", "tiff": None}
GROUPS = ["Low", "Mid", "High"]
SERIES = ["A", "B"]
VALUES = [[10.0, 20.0], [15.0, 5.0], [-3.0, 8.0]]
ERRORS: list[list[float | None]] = [[1.0, 2.0], [0.5, None], [1.2, 0.8]]


@pytest.mark.parametrize("fmt", ["pdf", "svg", "png"])
@pytest.mark.parametrize("stacked", [False, True])
def test_renders_every_format_grouped_and_stacked(fmt: str, stacked: bool) -> None:
    out = render_categorical_figure(
        GROUPS, SERIES, VALUES, ERRORS, stacked=stacked, fmt=fmt,
        title="t", x_label="group", y_label="value",
    )
    assert out[: len(_MAGIC[fmt])] == _MAGIC[fmt]
    assert len(out) > 500


def test_tiff_magic_bytes() -> None:
    out = render_categorical_figure(GROUPS, SERIES, VALUES, fmt="tiff", dpi=150)
    assert out[:4] in (b"II*\x00", b"MM\x00*")


def test_no_errors_renders() -> None:
    out = render_categorical_figure(GROUPS, SERIES, VALUES, fmt="png")
    assert out[:4] == b"\x89PNG"


def test_single_group_single_series() -> None:
    out = render_categorical_figure(["A"], ["x"], [[5.0]], fmt="png")
    assert out[:4] == b"\x89PNG"


def test_single_series_omits_legend_but_still_renders() -> None:
    out = render_categorical_figure(GROUPS, ["only"], [[1.0], [2.0], [3.0]], fmt="svg")
    assert out[:5] == b"<?xml"


def test_negative_values_render() -> None:
    values = [[-1.0, -2.0], [-3.0, 4.0], [5.0, -6.0]]
    out = render_categorical_figure(GROUPS, SERIES, values, fmt="pdf")
    assert out[:4] == b"%PDF"


def test_stacked_output_differs_from_grouped() -> None:
    grouped = render_categorical_figure(GROUPS, SERIES, VALUES, fmt="png", stacked=False)
    stacked = render_categorical_figure(GROUPS, SERIES, VALUES, fmt="png", stacked=True)
    assert grouped != stacked


def test_bad_format_raises() -> None:
    with pytest.raises(ValueError, match="fmt"):
        render_categorical_figure(GROUPS, SERIES, VALUES, fmt="bmp")


def test_empty_groups_raises() -> None:
    with pytest.raises(ValueError, match="groups"):
        render_categorical_figure([], SERIES, [])


def test_empty_series_raises() -> None:
    with pytest.raises(ValueError, match="series"):
        render_categorical_figure(GROUPS, [], [[], [], []])


def test_values_shape_mismatch_raises() -> None:
    with pytest.raises(ValueError, match="values must have shape"):
        render_categorical_figure(GROUPS, SERIES, [[1.0, 2.0]])  # only 1 of 3 groups


def test_errors_row_count_mismatch_raises() -> None:
    with pytest.raises(ValueError, match="errors must have"):
        render_categorical_figure(GROUPS, SERIES, VALUES, [[1.0, 2.0]])


def test_errors_row_length_mismatch_raises() -> None:
    with pytest.raises(ValueError, match="errors row"):
        render_categorical_figure(GROUPS, SERIES, VALUES, [[1.0], [1.0, 2.0], [1.0, 2.0]])


def test_named_styles_render() -> None:
    for style in ("aps", "report", "web", "nature", "presentation"):
        out = render_categorical_figure(GROUPS, SERIES, VALUES, fmt="pdf", style=style)
        assert out[:4] == b"%PDF"


def test_explicit_size_overrides_style() -> None:
    out = render_categorical_figure(GROUPS, SERIES, VALUES, fmt="pdf", width_in=8.0, height_in=5.0)
    assert out[:4] == b"%PDF"


def test_x_title_lands_below_the_outer_tier_not_the_inner_ticks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """P2.6 review finding 5: `_draw_categorical_bars` returns the outer-tier
    axis whenever `axis_style` draws a two-tier nested layout -- discarding
    it and setting the x title on the plain inner `ax` puts the title ON TOP
    OF (a smaller y-in-points offset than) the second tier's own row instead
    of clearing it, exactly the collision `figure_statplots.py`'s flat path
    already avoids with `(outer or ax).set_xlabel`. Reads the Axes back (via
    a patched `savefig_bytes`) to compare the title's actual y position
    against the outer tier's, rather than just checking the render
    doesn't crash."""
    from quantized.calc import figure_categorical

    captured: dict[str, object] = {}

    def fake_savefig(fig: object, fmt: str, **kwargs: object) -> bytes:
        captured["fig"] = fig
        return b""

    monkeypatch.setattr(figure_categorical, "savefig_bytes", fake_savefig)
    nested_groups = ["lot = 1 / w = a", "lot = 1 / w = b", "lot = 2 / w = a", "lot = 2 / w = b"]
    figure_categorical.render_categorical_figure(
        nested_groups, SERIES, [[1.0, 2.0]] * 4, x_label="lot / w",
        axis_style={"tiered": True},
    )
    fig = captured["fig"]
    ax = fig.axes[0]  # type: ignore[attr-defined]
    # `_draw_categorical_bars` drew a two-tier axis: matplotlib parents the
    # outer tier's `secondary_xaxis` on `ax` as a CHILD axes (it never joins
    # `fig.axes` itself) -- the title is on whichever axes actually carries
    # the text (never `ax` itself, once this is fixed).
    candidates = [ax, *ax.child_axes]
    titled = [a for a in candidates if a.xaxis.get_label().get_text() == "lot / w"]
    assert len(titled) == 1
    title_ax = titled[0]
    assert title_ax is not ax
    title = title_ax.xaxis.get_label()
    outer_ticklabels = [t for t in title_ax.get_xticklabels(minor=True) if t.get_text()]
    assert outer_ticklabels  # the outer tier's own "lot = 1" / "lot = 2" labels
    fig.canvas.draw()
    title_y = title.get_window_extent().y0
    tier_y = min(t.get_window_extent().y0 for t in outer_ticklabels)
    assert title_y < tier_y  # strictly below (smaller y = lower on a standard canvas)

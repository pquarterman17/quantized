"""Unit tests for the secondary (right) Y axis / matplotlib twinx export
(``calc.figure_y2``, dispatched from ``calc.figure.render_figure`` via
``y2_mask``) -- the fix for the bug where a plotted y2 channel silently
rendered on the primary axis (wrong scale) instead of a real twin axis."""

from __future__ import annotations

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pytest  # noqa: E402

from quantized.calc.figure import render_figure  # noqa: E402
from quantized.calc.figure_styles import figure_style  # noqa: E402
from quantized.calc.figure_y2 import (  # noqa: E402
    _split_by_mask,
    render_with_secondary_axis,
)
from quantized.calc.plotting import validate_y2_subset  # noqa: E402


# ── validate_y2_subset ────────────────────────────────────────────────────
class TestValidateY2Subset:
    def test_none_y2_keys_is_a_no_op(self):
        validate_y2_subset([0, 1], None)  # must not raise

    def test_empty_y2_keys_is_a_no_op(self):
        validate_y2_subset([0, 1], [])

    def test_y_keys_none_means_every_channel_is_eligible(self):
        # build_series' own default ("every channel") -- any y2_keys passes
        # here; an out-of-range channel is caught later by resolution.
        validate_y2_subset(None, [3])

    def test_subset_passes(self):
        validate_y2_subset([0, 1, 2], [2])

    def test_non_subset_raises(self):
        with pytest.raises(ValueError, match="subset"):
            validate_y2_subset([0, 1], [2])

    def test_mixed_str_and_int_keys(self):
        validate_y2_subset(["a", 1], ["a"])
        with pytest.raises(ValueError, match="subset"):
            validate_y2_subset(["a", 1], ["b"])


# ── render_figure(y2_mask=...) -- smoke + dispatch ────────────────────────
def test_no_y2_mask_is_byte_identical_to_omitting_it():
    # PNG (not PDF): a PDF embeds a /CreationDate second-resolution
    # timestamp, so two renders of the SAME figure straddling a second
    # boundary would differ by those bytes alone (see test_calc_figure.py's
    # `_stable_pdf` for the same precedent) -- PNG has no such timestamp.
    x = np.linspace(0, 10, 10)
    series = [("a", x), ("b", 2 * x)]
    omitted = render_figure(x, series, fmt="png")
    explicit_false = render_figure(x, series, fmt="png", y2_mask=[False, False])
    assert omitted == explicit_false


def test_y2_mask_wrong_length_raises():
    x = np.linspace(0, 10, 10)
    with pytest.raises(ValueError, match="same length"):
        render_figure(x, [("a", x)], fmt="pdf", y2_mask=[False, True])


def test_y2_renders_pdf_and_svg():
    x = np.linspace(0, 10, 20)
    series = [("a", x), ("b", 2 * x), ("c", 1000 * np.cos(x))]
    mask = [False, False, True]
    pdf = render_figure(x, series, fmt="pdf", y2_mask=mask, y2_label="c axis")
    assert pdf[:5] == b"%PDF-"
    svg = render_figure(x, series, fmt="svg", y2_mask=mask, y2_label="c axis")
    assert b"<svg" in svg[:400]
    assert "c axis" in svg.decode("utf-8", "ignore")


def test_y2_and_x_breaks_together_raises():
    x = np.linspace(0, 10, 20)
    series = [("a", x), ("b", 1000 * np.cos(x))]
    with pytest.raises(ValueError, match="x_breaks"):
        render_figure(
            x, series, fmt="png", y2_mask=[False, True],
            overrides={"x_breaks": [[3.0, 4.0]]},
        )


def test_y2_lim_fixes_the_secondary_range():
    x = np.linspace(0, 10, 20)
    series = [("a", x), ("b", 1000 * np.cos(x))]
    mask = [False, True]
    default = render_figure(x, series, fmt="png", y2_mask=mask)
    fixed = render_figure(
        x, series, fmt="png", y2_mask=mask, overrides={"y2_lim": [-2000, 2000]}
    )
    assert default != fixed


# ── render_with_secondary_axis -- the direct axes-level contract ─────────
class TestRenderWithSecondaryAxis:
    def _render(self, series, mask, **kw):
        fig, ax = plt.subplots()
        x = np.linspace(0, 10, len(series[0][1]))
        artists = render_with_secondary_axis(
            fig, ax, x, series, kw.pop("series_styles", None), mask,
            st=figure_style("default"), ov=kw.pop("ov", {}),
            x_log=False, y_log=False, x_scale=None, y_scale=None,
            title="", x_label="", y_label=kw.pop("y_label", ""),
            x_fmt=None, y_fmt=None, x_step=None, y_step=None,
            y2_label=kw.pop("y2_label", ""), y2_scale=None, y2_fmt=None, y2_step=None,
        )
        return fig, ax, artists

    def test_twinx_creates_a_real_second_axes(self):
        x = np.linspace(0, 10, 10)
        fig, ax, artists = self._render([("a", x), ("b", x)], [False, True])
        try:
            assert len(fig.axes) == 2
            assert len(artists) == 2
            assert fig.axes[1] is not ax
        finally:
            plt.close(fig)

    def test_y2_right_spine_stays_visible_even_when_box_off(self):
        x = np.linspace(0, 10, 10)
        fig, ax, _ = self._render(
            [("a", x), ("b", x)], [False, True], ov={"spines": {"right": False}}
        )
        try:
            ax2 = fig.axes[1]
            assert ax2.spines["right"].get_visible() is True
        finally:
            plt.close(fig)

    def test_y2_label_applies_only_to_the_secondary_axis(self):
        x = np.linspace(0, 10, 10)
        fig, ax, _ = self._render(
            [("a", x), ("b", x)], [False, True], y_label="primary", y2_label="secondary"
        )
        try:
            assert ax.get_ylabel() == "primary"
            assert fig.axes[1].get_ylabel() == "secondary"
        finally:
            plt.close(fig)

    # ── COLOR STABILITY (the critical regression surface) ────────────────
    def test_primary_only_colors_are_the_untouched_matplotlib_auto_cycle(self):
        # No y2 series at all: draw_series_axes' own primary-only path must
        # be completely unaffected by this module even existing.
        x = np.linspace(0, 10, 10)
        fig, ax, artists = self._render([("a", x), ("b", 2 * x)], [False, False])
        try:
            default_cycle = plt.rcParams["axes.prop_cycle"].by_key()["color"]
            assert artists[0].get_color() == default_cycle[0]
            assert artists[1].get_color() == default_cycle[1]
        finally:
            plt.close(fig)

    def test_y2_color_continues_the_primary_cycle_instead_of_restarting(self):
        # 2 primary (C0, C1) + 1 y2 series with no explicit color: the y2
        # series must NOT restart at C0 (a fresh twinx axes' own cycle) —
        # it must continue as C2.
        x = np.linspace(0, 10, 10)
        series = [("a", x), ("b", x), ("c", x)]
        fig, ax, artists = self._render(series, [False, False, True])
        try:
            assert artists[2].get_color() == "C2"
        finally:
            plt.close(fig)

    def test_explicit_y2_color_wins_over_the_auto_offset(self):
        x = np.linspace(0, 10, 10)
        series = [("a", x), ("b", x)]
        styles = [None, {"color": "#ff00ff"}]
        fig, ax, artists = self._render(series, [False, True], series_styles=styles)
        try:
            assert artists[1].get_color() == "#ff00ff"
        finally:
            plt.close(fig)

    # ── legend combines both axes ─────────────────────────────────────────
    def test_legend_covers_both_axes_labels(self):
        x = np.linspace(0, 10, 10)
        fig, ax, _ = self._render([("primary series", x), ("y2 series", x)], [False, True])
        try:
            leg = ax.get_legend()
            assert leg is not None
            labels = {t.get_text() for t in leg.get_texts()}
            assert labels == {"primary series", "y2 series"}
        finally:
            plt.close(fig)

    def test_no_legend_rebuilt_for_a_single_total_series(self):
        x = np.linspace(0, 10, 10)
        fig, ax, _ = self._render([("only", x)], [True])
        try:
            assert ax.get_legend() is None
        finally:
            plt.close(fig)


# ── _split_by_mask -- the off-by-one class ────────────────────────────────
class TestSplitByMask:
    def test_styles_stay_aligned_to_their_own_series_after_the_split(self):
        x = np.linspace(0, 10, 5)
        series = [("a", x), ("b", x), ("c", x), ("d", x)]
        styles = [
            {"color": "#111111"},
            {"color": "#222222"},
            {"color": "#333333"},
            {"color": "#444444"},
        ]
        mask = [False, True, False, False]
        primary, primary_styles, y2, y2_styles = _split_by_mask(series, styles, mask)
        assert [s[0] for s in primary] == ["a", "c", "d"]
        assert primary_styles == [{"color": "#111111"}, {"color": "#333333"}, {"color": "#444444"}]
        assert [s[0] for s in y2] == ["b"]
        assert y2_styles == [{"color": "#222222"}]

    def test_none_series_styles_stays_none_on_both_sides(self):
        x = np.linspace(0, 10, 5)
        series = [("a", x), ("b", x)]
        primary, primary_styles, y2, y2_styles = _split_by_mask(series, None, [False, True])
        assert primary_styles is None
        assert y2_styles is None

    def test_fill_vs_remaps_to_the_new_local_index_within_the_same_subset(self):
        # full-list order: A(y2)=0, B(primary)=1, C(primary)=2, D(primary)=3.
        # D's fill.vs=1 means "fill D against B" in ORIGINAL positions; after
        # dropping A, B moves from position 1 to local position 0 within the
        # primary subset, so vs must follow it to 0, not stay 1 (which would
        # now silently mean C instead).
        x = np.linspace(0, 10, 5)
        series = [("A", x), ("B", x), ("C", x), ("D", x)]
        styles = [None, None, None, {"fill": {"vs": 1}}]
        mask = [True, False, False, False]
        primary, primary_styles, _y2, _y2s = _split_by_mask(series, styles, mask)
        assert [s[0] for s in primary] == ["B", "C", "D"]
        assert primary_styles[2] == {"fill": {"vs": 0}}  # D -> B, now at local index 0

    def test_fill_vs_crossing_to_the_other_axis_is_dropped_not_misapplied(self):
        x = np.linspace(0, 10, 5)
        series = [("A", x), ("B", x), ("C", x)]
        # C's fill.vs=1 -> B, which lands on the OTHER (y2) axis.
        styles = [None, None, {"fill": {"vs": 1}, "color": "#abcdef"}]
        primary, primary_styles, _y2, _y2s = _split_by_mask(series, styles, [False, True, False])
        assert primary_styles[-1] == {"color": "#abcdef"}  # fill dropped, color kept

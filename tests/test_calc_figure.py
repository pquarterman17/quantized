"""Unit tests for the matplotlib figure renderer (magic-byte / format checks)."""

from __future__ import annotations

import numpy as np
import pytest

from quantized.calc.figure import render_figure, render_figure_map


def test_pdf_has_pdf_signature() -> None:
    x = np.linspace(0, 10, 50)
    out = render_figure(x, [("y", np.sin(x))], x_label="x", y_label="y", fmt="pdf")
    assert out[:5] == b"%PDF-"


def test_svg_is_xml_svg() -> None:
    x = np.linspace(0, 10, 50)
    out = render_figure(x, [("y", np.sin(x))], fmt="svg")
    head = out[:300].decode("utf-8", "ignore")
    assert "<svg" in head


def test_png_signature() -> None:
    x = np.linspace(0, 10, 50)
    out = render_figure(x, [("y", x)], fmt="png")
    assert out[:8] == b"\x89PNG\r\n\x1a\n"


def test_tiff_signature() -> None:
    x = np.linspace(0, 10, 50)
    out = render_figure(x, [("y", x)], fmt="tiff", dpi=150)
    # TIFF magic: little-endian "II*\0" or big-endian "MM\0*" (Pillow writes LE).
    assert out[:4] in (b"II*\x00", b"MM\x00*")


def test_dpi_scales_raster_output() -> None:
    x = np.linspace(0, 10, 50)
    lo = render_figure(x, [("y", np.sin(x))], fmt="png", dpi=72)
    hi = render_figure(x, [("y", np.sin(x))], fmt="png", dpi=300)
    assert len(hi) > len(lo)  # more pixels at higher dpi


def test_multi_series_renders() -> None:
    x = np.linspace(0, 10, 50)
    out = render_figure(x, [("a", x), ("b", 2 * x)], fmt="pdf")
    assert out[:5] == b"%PDF-"


def test_bad_format_raises() -> None:
    with pytest.raises(ValueError, match="fmt"):
        render_figure(np.array([0.0, 1.0]), [("y", np.array([0.0, 1.0]))], fmt="bmp")


def test_named_styles_render() -> None:
    x = np.linspace(0, 10, 50)
    for style in ("aps", "report", "web", "nature", "presentation"):
        out = render_figure(x, [("y", np.sin(x))], fmt="pdf", style=style)
        assert out[:5] == b"%PDF-"


def test_explicit_size_overrides_style() -> None:
    # Passing width_in/height_in must win over the preset geometry.
    x = np.linspace(0, 10, 20)
    out = render_figure(x, [("y", x)], fmt="pdf", style="aps", width_in=8.0, height_in=5.0)
    assert out[:5] == b"%PDF-"


def test_bad_style_raises() -> None:
    with pytest.raises(ValueError, match="unknown style"):
        render_figure(np.array([0.0, 1.0]), [("y", np.array([0.0, 1.0]))], style="nope")


def test_title_renders_in_svg() -> None:
    x = np.linspace(0, 10, 30)
    out = render_figure(x, [("y", np.sin(x))], fmt="svg", title="My Sample")
    # SVG embeds text glyphs; the title text appears in the markup.
    assert "My Sample" in out.decode("utf-8", "ignore")


def test_custom_axis_labels_render_in_svg() -> None:
    x = np.linspace(0, 10, 30)
    out = render_figure(
        x, [("y", x)], fmt="svg", x_label="Field (Oe)", y_label="Moment (emu)"
    )
    svg = out.decode("utf-8", "ignore")
    assert "Field (Oe)" in svg
    assert "Moment (emu)" in svg


def test_series_styles_render() -> None:
    x = np.linspace(0, 10, 30)
    styles = [
        {"color": "#ff0000", "width": 3, "line": "dashed", "marker": True, "marker_size": 6}
    ]
    out = render_figure(x, [("y", np.sin(x))], fmt="pdf", series_styles=styles)
    assert out[:5] == b"%PDF-"


def test_series_styles_color_appears_in_svg() -> None:
    x = np.linspace(0, 10, 30)
    out = render_figure(
        x, [("y", x)], fmt="svg", series_styles=[{"color": "#123456"}]
    )
    # matplotlib serializes the stroke colour into the SVG path style.
    assert "#123456" in out.decode("utf-8", "ignore")


def test_extra_or_missing_series_styles_are_safe() -> None:
    x = np.linspace(0, 10, 10)
    # Fewer styles than series (second series → default) and a None entry.
    out = render_figure(
        x, [("a", x), ("b", 2 * x)], fmt="pdf", series_styles=[None]
    )
    assert out[:5] == b"%PDF-"


# ── Fill under/between curves (MAIN #13) ─────────────────────────────────────
def test_fill_under_renders_and_changes_output() -> None:
    x = np.linspace(0, 10, 30)
    plain = render_figure(x, [("y", np.sin(x))], fmt="png")
    filled = render_figure(x, [("y", np.sin(x))], fmt="png", series_styles=[{"fill": "under"}])
    assert filled[:8] == b"\x89PNG\r\n\x1a\n"
    assert filled != plain


def test_fill_under_svg_contains_a_fill_path() -> None:
    x = np.linspace(0, 10, 20)
    out = render_figure(
        x, [("y", x)], fmt="svg", series_styles=[{"fill": "under", "color": "#112233"}]
    )
    svg = out.decode("utf-8", "ignore")
    # fill_between's patch renders as a filled (non-"none") path in the SVG.
    assert "#112233" in svg


def test_fill_between_two_series_renders() -> None:
    x = np.linspace(0, 10, 20)
    # {"vs": 1} is already a DISPLAY INDEX here — this is the pure render
    # layer, downstream of calc.plotting.resolve_style_channels.
    out = render_figure(
        x,
        [("a", x), ("b", x + 2)],
        fmt="pdf",
        series_styles=[{"fill": {"vs": 1}}, None],
    )
    assert out[:5] == b"%PDF-"


def test_fill_between_out_of_range_vs_is_ignored_not_error() -> None:
    x = np.linspace(0, 10, 10)
    out = render_figure(
        x, [("a", x)], fmt="pdf", series_styles=[{"fill": {"vs": 99}}]
    )
    assert out[:5] == b"%PDF-"


def test_fill_none_is_a_no_op() -> None:
    x = np.linspace(0, 10, 10)
    a = render_figure(x, [("y", x)], fmt="png", series_styles=[{"fill": "none"}])
    b = render_figure(x, [("y", x)], fmt="png")
    assert a == b


# ── Colour-mapped scatter (MAIN #14) ─────────────────────────────────────────
def test_color_by_scatter_renders() -> None:
    x = np.linspace(0, 10, 25)
    z = np.cos(x)
    out = render_figure(
        x, [("y", np.sin(x))], fmt="png", series_styles=[{"color_by": z.tolist()}]
    )
    assert out[:8] == b"\x89PNG\r\n\x1a\n"


def test_color_by_scatter_differs_from_plain_line() -> None:
    x = np.linspace(0, 10, 25)
    z = np.cos(x)
    plain = render_figure(x, [("y", np.sin(x))], fmt="pdf")
    scattered = render_figure(
        x, [("y", np.sin(x))], fmt="pdf", series_styles=[{"color_by": z.tolist()}]
    )
    assert scattered != plain


def test_color_by_scatter_honors_colormap_name() -> None:
    x = np.linspace(0, 10, 25)
    z = np.linspace(0, 1, 25)
    viridis = render_figure(
        x, [("y", x)], fmt="pdf", series_styles=[{"color_by": z.tolist(), "colormap": "viridis"}]
    )
    magma = render_figure(
        x, [("y", x)], fmt="pdf", series_styles=[{"color_by": z.tolist(), "colormap": "magma"}]
    )
    assert viridis != magma


def test_color_by_scatter_mixed_with_plain_series() -> None:
    # One colour-mapped series alongside a normal line series — exercises the
    # draw_series_axes branch that must handle both artist kinds in one pass.
    x = np.linspace(0, 10, 15)
    out = render_figure(
        x,
        [("a", x), ("b", 2 * x)],
        fmt="pdf",
        series_styles=[{"color_by": np.sin(x).tolist()}, None],
    )
    assert out[:5] == b"%PDF-"


def test_color_by_scatter_hitmap_keeps_series_indices_aligned() -> None:
    # Regression guard: a colour-mapped series draws via ax.scatter, so it has
    # NO entry in ax.lines -- _collect_map must key off draw_series_axes's
    # returned artist list, not `ax.lines[:n_series]`, or the SECOND (plain
    # line) series' hit-box would silently point at the wrong artist.
    x = np.linspace(0, 10, 12)
    out = render_figure_map(
        x,
        [("a", x), ("b", 2 * x)],
        series_styles=[{"color_by": np.sin(x).tolist()}, None],
        dpi=100,
    )
    ids = {e["id"] for e in out["elements"]}
    assert {"series:0", "series:1"} <= ids
    boxes = {e["id"]: e for e in out["elements"]}
    # Both hit-boxes are real (non-degenerate, on-image) regions.
    for sid in ("series:0", "series:1"):
        b = boxes[sid]
        assert b["x0"] < b["x1"] and b["y0"] < b["y1"]


# ── Property overrides (gap #11) ─────────────────────────────────────────────
class TestOverrides:
    X = [1.0, 2.0, 3.0, 4.0]
    SERIES = [("a", [1.0, 4.0, 9.0, 16.0]), ("b", [2.0, 3.0, 5.0, 7.0])]

    def _png(self, **overrides):
        from quantized.calc.figure import render_figure

        return render_figure(self.X, self.SERIES, fmt="png", overrides=overrides or None)

    def test_full_override_set_renders(self):
        data = self._png(
            font_size=9,
            font_name="DejaVu Sans",
            title_size=11,
            legend={"show": True, "loc": "outside right", "frame": False},
            ticks={"dir": "out", "len": 5, "minor": True},
            spines={"top": False, "right": False},
            x_lim=[0, 5],
            y_lim=[None, 20],
            margins={"left": 0.2, "right": 0.05, "top": 0.05, "bottom": 0.15},
            grid=True,
            annotations=[{"x": 2.0, "y": 4.0, "text": "peak"}],
        )
        assert data[:8] == b"\x89PNG\r\n\x1a\n"
        # and it actually changed the output vs the un-overridden render
        assert data != self._png()

    def test_legend_hide_and_outside_top(self):
        assert self._png(legend={"show": False})[:4] == b"\x89PNG"
        assert self._png(legend={"loc": "outside top"})[:4] == b"\x89PNG"

    def test_invalid_values_raise_value_error(self):
        import pytest

        with pytest.raises(ValueError, match="legend loc"):
            self._png(legend={"loc": "over the rainbow"})
        with pytest.raises(ValueError, match="ticks dir"):
            self._png(ticks={"dir": "sideways"})
        with pytest.raises(ValueError, match="lo, hi"):
            self._png(x_lim=[1, 2, 3])
        with pytest.raises(ValueError, match="fraction"):
            self._png(margins={"left": 3.0})

    def test_unknown_keys_are_ignored(self):
        assert self._png(some_future_key=1)[:4] == b"\x89PNG"


# ── Reciprocal (1/x) axis scale (MAIN #12 -- Arrhenius-style plots) ─────────
def test_reciprocal_x_scale_renders() -> None:
    t = np.linspace(100.0, 300.0, 30)  # T in Kelvin -- always positive
    out = render_figure(t, [("rate", np.exp(-1000.0 / t))], fmt="png", x_scale="reciprocal")
    assert out[:8] == b"\x89PNG\r\n\x1a\n"


def test_reciprocal_y_scale_renders() -> None:
    x = np.linspace(1.0, 10.0, 20)
    out = render_figure(x, [("y", x)], fmt="pdf", y_scale="reciprocal")
    assert out[:5] == b"%PDF-"


def test_reciprocal_scale_hitmap_reports_the_resolved_scale_name() -> None:
    # The figure-hitmap axes block (gap #13) carries the RESOLVED scale name
    # (not derived from ax.get_xscale(), which reports a reciprocal axis as
    # the generic "function" -- see _collect_map's doc) so the client's
    # lib/previewmap.ts can invert a preview pixel drag correctly.
    t = np.linspace(100.0, 300.0, 20)
    out = render_figure_map(t, [("rate", np.exp(-1000.0 / t))], x_scale="reciprocal", dpi=100)
    assert out["axes"]["xscale"] == "reciprocal"
    assert out["axes"]["yscale"] == "linear"
    assert out["axes"]["xlog"] is False  # back-compat field: reciprocal != log


def test_log_scale_hitmap_sets_both_the_legacy_and_new_fields() -> None:
    x = np.linspace(1.0, 10.0, 20)
    out = render_figure_map(x, [("y", x)], y_scale="log", dpi=100)
    assert out["axes"]["yscale"] == "log"
    assert out["axes"]["ylog"] is True


def test_reciprocal_scale_differs_from_linear() -> None:
    t = np.linspace(100.0, 300.0, 30)
    y = np.exp(-1000.0 / t)
    linear = render_figure(t, [("rate", y)], fmt="pdf")
    reciprocal = render_figure(t, [("rate", y)], fmt="pdf", x_scale="reciprocal")
    assert linear != reciprocal


def test_x_scale_takes_precedence_over_legacy_x_log() -> None:
    # x_scale, when given, wins over x_log (MAIN #12 back-compat contract).
    t = np.linspace(100.0, 300.0, 20)
    y = np.exp(-1000.0 / t)
    a = render_figure(t, [("y", y)], fmt="pdf", x_log=True, x_scale="reciprocal")
    b = render_figure(t, [("y", y)], fmt="pdf", x_scale="reciprocal")
    assert a == b


def test_legacy_x_log_still_works_when_x_scale_absent() -> None:
    x = np.linspace(1.0, 100.0, 20)
    y = x**2
    via_log = render_figure(x, [("y", y)], fmt="pdf", x_log=True)
    via_scale = render_figure(x, [("y", y)], fmt="pdf", x_scale="log")
    assert via_log == via_scale


def test_reciprocal_scale_with_x_breaks_does_not_crash() -> None:
    # The manual-axis-break renderer (figure_break) also threads x_scale/
    # y_scale through -- exercise that path too, not just the plain axes one.
    t = np.linspace(50.0, 400.0, 40)
    y = np.exp(-1000.0 / t)
    out = render_figure(
        t, [("rate", y)], fmt="png", x_scale="reciprocal",
        overrides={"x_breaks": [[150.0, 200.0]]},
    )
    assert out[:8] == b"\x89PNG\r\n\x1a\n"


def test_reciprocal_scale_on_figure_page() -> None:
    from quantized.calc.figure_page import PagePanel, render_figure_page

    t = np.linspace(100.0, 300.0, 20)
    y = np.exp(-1000.0 / t)
    panel = PagePanel(x=t, series=[("rate", y)], row=0, col=0, x_scale="reciprocal")
    out = render_figure_page([panel], rows=1, cols=1, fmt="png")
    assert out[:8] == b"\x89PNG\r\n\x1a\n"

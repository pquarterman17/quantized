"""Unit tests for the matplotlib figure renderer (magic-byte / format checks)."""

from __future__ import annotations

import numpy as np
import pytest

from quantized.calc.figure import render_figure


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

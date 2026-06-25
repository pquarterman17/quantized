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

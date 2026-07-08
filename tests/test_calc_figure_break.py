"""Unit tests for manual axis breaks (gap #21, `overrides.x_breaks`) —
magic-byte checks (render_figure dispatches into calc.figure_break) and the
`_validate_overrides` guard rails."""

from __future__ import annotations

import numpy as np
import pytest

from quantized.calc.figure import _validate_overrides, render_figure
from quantized.calc.figure_break import render_breaks_impl
from quantized.calc.figure_styles import figure_style


def _gapped_x() -> np.ndarray:
    # Typical spacing 1 throughout each cluster; one big gap between 9 and 60.
    return np.concatenate([np.linspace(0, 9, 20), np.linspace(60, 63, 8)])


class TestValidation:
    def test_empty_list_raises(self):
        with pytest.raises(ValueError, match="non-empty"):
            _validate_overrides({"x_breaks": []})

    def test_wrong_shape_entry_raises(self):
        with pytest.raises(ValueError, match=r"\[lo, hi\] pair"):
            _validate_overrides({"x_breaks": [[5]]})
        with pytest.raises(ValueError, match=r"\[lo, hi\] pair"):
            _validate_overrides({"x_breaks": [[1, 2, 3]]})

    def test_lo_must_be_less_than_hi(self):
        with pytest.raises(ValueError, match="lo < hi"):
            _validate_overrides({"x_breaks": [[5, 5]]})
        with pytest.raises(ValueError, match="lo < hi"):
            _validate_overrides({"x_breaks": [[10, 5]]})

    def test_overlapping_or_unsorted_breaks_raise(self):
        with pytest.raises(ValueError, match="sorted and non-overlapping"):
            _validate_overrides({"x_breaks": [[5, 20], [10, 30]]})
        with pytest.raises(ValueError, match="sorted and non-overlapping"):
            _validate_overrides({"x_breaks": [[20, 30], [5, 10]]})

    def test_valid_breaks_do_not_raise(self):
        _validate_overrides({"x_breaks": [[5, 10], [20, 30]]})  # no error

    def test_absent_x_breaks_is_a_no_op(self):
        _validate_overrides({})  # no error
        _validate_overrides({"x_breaks": None})  # no error


class TestRenderFigureWithBreaks:
    def test_pdf_magic_bytes(self):
        x = _gapped_x()
        out = render_figure(x, [("sig", np.sin(x))], fmt="pdf", overrides={"x_breaks": [[9, 60]]})
        assert out[:5] == b"%PDF-"

    def test_svg_magic_bytes(self):
        x = _gapped_x()
        out = render_figure(x, [("sig", np.sin(x))], fmt="svg", overrides={"x_breaks": [[9, 60]]})
        assert "<svg" in out[:300].decode("utf-8", "ignore")

    def test_png_magic_bytes(self):
        x = _gapped_x()
        out = render_figure(x, [("sig", np.sin(x))], fmt="png", overrides={"x_breaks": [[9, 60]]})
        assert out[:8] == b"\x89PNG\r\n\x1a\n"

    def test_tiff_magic_bytes(self):
        x = _gapped_x()
        out = render_figure(x, [("sig", np.sin(x))], fmt="tiff", overrides={"x_breaks": [[9, 60]]})
        assert out[:4] in (b"II*\x00", b"MM\x00*")

    def test_multi_series_with_legend_renders(self):
        x = _gapped_x()
        out = render_figure(
            x, [("a", np.sin(x)), ("b", np.cos(x))], fmt="pdf", overrides={"x_breaks": [[9, 60]]}
        )
        assert out[:5] == b"%PDF-"

    def test_multiple_breaks_render(self):
        x = np.concatenate(
            [np.linspace(0, 4, 10), np.linspace(20, 24, 10), np.linspace(100, 104, 10)]
        )
        out = render_figure(
            x, [("sig", np.sin(x))], fmt="pdf", overrides={"x_breaks": [[4, 20], [24, 100]]}
        )
        assert out[:5] == b"%PDF-"

    def test_title_and_labels_render_in_svg(self):
        x = _gapped_x()
        out = render_figure(
            x, [("sig", np.sin(x))], fmt="svg", title="Broken Axis Demo",
            x_label="Field (Oe)", y_label="Moment (emu)",
            overrides={"x_breaks": [[9, 60]]},
        )
        svg = out.decode("utf-8", "ignore")
        assert "Broken Axis Demo" in svg
        assert "Field (Oe)" in svg
        assert "Moment (emu)" in svg

    def test_x_log_and_y_log_do_not_raise(self):
        x = np.concatenate([np.linspace(1, 9, 10), np.linspace(60, 63, 5)])
        y = np.abs(np.sin(x)) + 0.1
        out = render_figure(
            x, [("sig", y)], fmt="pdf", x_log=True, y_log=True,
            overrides={"x_breaks": [[9, 60]]},
        )
        assert out[:5] == b"%PDF-"

    def test_a_break_outside_the_data_range_still_renders(self):
        # A break entirely past the data's max is harmless (an empty trailing panel).
        x = np.linspace(0, 10, 20)
        out = render_figure(x, [("sig", x)], fmt="pdf", overrides={"x_breaks": [[20, 30]]})
        assert out[:5] == b"%PDF-"

    def test_output_differs_from_the_unbroken_render(self):
        x = _gapped_x()
        y = np.sin(x)
        broken = render_figure(x, [("sig", y)], fmt="png", overrides={"x_breaks": [[9, 60]]})
        plain = render_figure(x, [("sig", y)], fmt="png")
        assert broken != plain

    def test_hitmap_collection_ignores_x_breaks(self):
        # figure-hitmap's single-axes pixel harvesting is not compatible with
        # a multi-panel broken figure; render_figure_map should still work,
        # just without breaks applied (documented scope limitation).
        from quantized.calc.figure import render_figure_map

        x = _gapped_x()
        result = render_figure_map(x, [("sig", np.sin(x))], overrides={"x_breaks": [[9, 60]]})
        assert "image" in result
        assert result["width"] > 0


class TestRenderBreaksImplDirect:
    """A couple of direct calls to the extracted sibling module, so the split
    itself (calc.figure_break) has its own coverage independent of the
    override-dispatch path in calc.figure."""

    def test_direct_call_renders_pdf(self):
        x = _gapped_x()
        st = figure_style("default")
        out = render_breaks_impl(
            x, [("sig", np.sin(x))], breaks=[(9.0, 60.0)], x_log=False, y_log=False,
            title="", x_label="", y_label="", fmt="pdf", st=st, ov={}, dpi=150,
            figsize=(6.0, 4.0), series_styles=None,
        )
        assert out[:5] == b"%PDF-"

    def test_series_styles_are_honored(self):
        x = _gapped_x()
        st = figure_style("default")
        out = render_breaks_impl(
            x, [("sig", np.sin(x))], breaks=[(9.0, 60.0)], x_log=False, y_log=False,
            title="", x_label="", y_label="", fmt="svg", st=st, ov={}, dpi=150,
            figsize=(6.0, 4.0), series_styles=[{"color": "#123456"}],
        )
        assert "#123456" in out.decode("utf-8", "ignore")

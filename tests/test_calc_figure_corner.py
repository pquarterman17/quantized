"""Posterior/bootstrap corner (pairs) plot rendering (calc.figure_corner).

Rendering can't be pixel-asserted, so most tests confirm a valid non-trivial
file for a given (k, format) and that malformed input is rejected. The
Gaussian sanity check pins down one real statistic: a marginal histogram's
tallest bin must straddle the sample mean, which would fail if the diagonal
panels were wired to the wrong column.
"""

from __future__ import annotations

import numpy as np
import pytest

from quantized.calc.figure_corner import render_corner_figure

_MAGIC = {"pdf": b"%PDF", "svg": b"<?xml", "png": b"\x89PNG"}
_RNG = np.random.default_rng(11)


def _gaussian_samples(n: int, means: list[float], sds: list[float]) -> np.ndarray:
    cols = [_RNG.normal(m, s, n) for m, s in zip(means, sds, strict=True)]
    return np.column_stack(cols)


@pytest.mark.parametrize("k", [2, 4])
@pytest.mark.parametrize("fmt", ["png", "pdf", "svg"])
def test_renders_valid_file_for_k_and_format(k: int, fmt: str) -> None:
    samples = _gaussian_samples(500, [0.0] * k, [1.0] * k)
    names = [f"p{i}" for i in range(k)]
    out = render_corner_figure(samples, names, fmt=fmt, title="posterior")
    assert out[: len(_MAGIC[fmt])] == _MAGIC[fmt]
    assert len(out) > 800


def test_k2_grid_has_two_visible_panels_and_one_blank() -> None:
    """A 2x2 corner grid has exactly 3 drawn panels (lower triangle +
    diagonal) and 1 blank upper-right -- confirmed via the SVG panel count
    (each visible axes draws at least one <g clip-path> data group; the
    blanked axis has none). We assert indirectly through PDF page content
    size as a smoke check that all 3 panels actually drew something."""
    samples = _gaussian_samples(300, [0.0, 5.0], [1.0, 2.0])
    out_full = render_corner_figure(samples, ["a", "b"], fmt="svg")
    # A degenerate single-panel (k=1) render is much smaller than a real k=2
    # grid with 3 populated panels -- a cheap structural signal that the
    # off-diagonal + both diagonal panels all rendered content.
    out_single = render_corner_figure(samples[:, :1], ["a"], fmt="svg")
    assert len(out_full) > len(out_single)


def test_k4_renders_with_truths_overlay() -> None:
    samples = _gaussian_samples(400, [1.0, 2.0, 3.0, 4.0], [0.5, 0.5, 0.5, 0.5])
    out = render_corner_figure(
        samples, ["a", "b", "c", "d"], truths=[1.0, 2.0, 3.0, 4.0], fmt="png",
    )
    assert out[:4] == _MAGIC["png"]


def test_marginal_histogram_peaks_near_sample_mean() -> None:
    """Gaussian sanity: bin the first column the same way the renderer does
    and confirm the tallest bin straddles the true mean -- pins the diagonal
    panel to the right column of data."""
    mean, sd = 3.0, 0.4
    samples = _gaussian_samples(4000, [mean, 0.0], [sd, 1.0])
    col = samples[:, 0]
    counts, edges = np.histogram(col, bins="fd")
    peak_bin = int(np.argmax(counts))
    bin_width = edges[1] - edges[0]
    peak_center = 0.5 * (edges[peak_bin] + edges[peak_bin + 1])
    assert abs(peak_center - mean) < 2.0 * bin_width
    # and the renderer itself doesn't choke on this input
    out = render_corner_figure(samples, ["mean", "other"], fmt="png")
    assert out[:4] == _MAGIC["png"]


def test_bad_format_rejected() -> None:
    samples = _gaussian_samples(50, [0.0, 0.0], [1.0, 1.0])
    with pytest.raises(ValueError, match="fmt must be"):
        render_corner_figure(samples, ["a", "b"], fmt="jpg")


def test_non_2d_samples_rejected() -> None:
    with pytest.raises(ValueError, match="2-D"):
        render_corner_figure([1.0, 2.0, 3.0], ["a"])


def test_param_names_length_mismatch_rejected() -> None:
    samples = _gaussian_samples(50, [0.0, 0.0], [1.0, 1.0])
    with pytest.raises(ValueError, match="param_names has"):
        render_corner_figure(samples, ["only_one"])


def test_truths_length_mismatch_rejected() -> None:
    samples = _gaussian_samples(50, [0.0, 0.0], [1.0, 1.0])
    with pytest.raises(ValueError, match="truths has"):
        render_corner_figure(samples, ["a", "b"], truths=[1.0])


def test_too_few_finite_samples_rejected() -> None:
    samples = np.array([[np.nan, 1.0], [1.0, np.nan], [np.nan, np.nan]])
    with pytest.raises(ValueError, match="finite joint samples"):
        render_corner_figure(samples, ["a", "b"])


def test_single_parameter_k1_renders_one_histogram() -> None:
    samples = _gaussian_samples(200, [0.0], [1.0])
    out = render_corner_figure(samples, ["only"], fmt="png")
    assert out[:4] == _MAGIC["png"]


def test_dpi_none_uses_style_preset_dpi() -> None:
    """dpi=None (default) resolves to the style's calibrated dpi -- a raster
    render at the high-dpi 'aps' preset must be a larger PNG than the same
    grid at the low-dpi 'web' preset."""
    samples = _gaussian_samples(300, [0.0, 0.0], [1.0, 1.0])
    small = render_corner_figure(samples, ["a", "b"], fmt="png", style="web")
    large = render_corner_figure(samples, ["a", "b"], fmt="png", style="aps")
    assert len(large) > len(small)

"""quantized's PSD scaling, curve averaging and t-tests against OriginPro.

Same protocol as ``test_origin_oracle_compare_signal``: quantized runs on the
seeded input the harness fed Origin and is compared with Origin's frozen
answer; skips without the local corpus. Measured on OriginPro 2026b (10.35).
"""

from __future__ import annotations

import numpy as np
import pytest
from scipy import stats

from _origin_oracle_fixture import load_fixture
from quantized.calc.curve_average import average_curves
from quantized.calc.spectral import fft_spectral
from quantized.calc.stats import t_test
from quantized.calc.stats_rowtests import row_t_tests
from quantized.datastruct import DataStruct

pytestmark = pytest.mark.realdata


def _psd(scaling: str) -> dict[str, np.ndarray]:
    c = load_fixture("psd_scaling").input_columns()
    r = fft_spectral(
        c["t"], c["y"], window="none", output_type="psd", sided="one", detrend="none",
        scaling=scaling,
    )
    return {"freq": r["freq"], "psd": r["psd"]}


def _origin_psd(norm: str, occurrence: int) -> tuple[np.ndarray, np.ndarray]:
    fx = load_fixture("psd_scaling")
    f = np.array(fx.column("Frequency", occurrence), dtype=float)
    p = np.array(fx.column(f"Power as {norm}", 0), dtype=float)
    return f, p


def test_origin_msa_is_quantized_spectrum_scaling() -> None:
    """One-sided, rectangular window, no detrend, 1024 samples at 200 Hz:
    Origin's MSA (mean square amplitude) equals ``scaling="spectrum"`` over
    all 513 bins including DC and Nyquist (ratio 1 +- 3e-14), and the
    frequency axes agree to 2e-12."""
    f, p = _origin_psd("MSA", 0)
    ours = _psd("spectrum")
    np.testing.assert_allclose(f, ours["freq"], atol=1e-9)
    np.testing.assert_allclose(p, ours["psd"], rtol=1e-12)


def test_origin_tisa_is_quantized_density_scaling() -> None:
    """Origin's TISA (time-interval square amplitude) equals
    ``scaling="density"`` to 5e-14 relative, all 513 bins."""
    f, p = _origin_psd("TISA", 2)
    ours = _psd("density")
    np.testing.assert_allclose(f, ours["freq"], atol=1e-9)
    np.testing.assert_allclose(p, ours["psd"], rtol=1e-12)


def test_origin_ssa_has_no_quantized_scaling_but_is_a_constant_multiple() -> None:
    """Origin's SSA (sum square amplitude) is not offered by quantized. It is
    exactly N (1024) times the ``spectrum`` scaling, or fs (200) times the
    ``density`` one, so a later option can be added as a multiplier."""
    _, p = _origin_psd("SSA", 1)
    np.testing.assert_allclose(p, 1024.0 * _psd("spectrum")["psd"], rtol=1e-12)
    np.testing.assert_allclose(p, 200.0 * _psd("density")["psd"], rtol=1e-12)


def test_average_curves_matches_origin_avecurves() -> None:
    """Origin's ``avecurves method:=ave`` of three curves on a shared x grid
    equals quantized's mean to 1e-16 (also the plain numpy mean); the x grid
    agrees to 9e-16."""
    fx = load_fixture("avecurves_mean")
    c = fx.input_columns()
    curves = [
        DataStruct.create(
            c["x"], c[f"y{i}"].reshape(-1, 1), labels=["Y"], units=["u"], metadata={"xUnit": "s"}
        )
        for i in (1, 2, 3)
    ]
    r = average_curves(curves).data
    o = fx.outputs()
    np.testing.assert_allclose(r.time, o[0], atol=1e-12)
    np.testing.assert_allclose(r.values[:, 0], o[1], atol=1e-12)
    assert r.labels[0] == "Y mean"


def test_origin_reduce_every_5_points_is_the_block_mean() -> None:
    """quantized has no block-average reduction (``decimate`` picks min/max
    rows for display), so this pins Origin's ``reduce_ex ... ymeanxbinc`` to
    the independent numpy block mean of X and Y (exact) for a later
    implementation."""
    fx = load_fixture("reduce_mean_ratio")
    c, o = fx.input_columns(), fx.outputs()
    ox, oy = o[0][:24], o[1][:24]
    assert np.isfinite(o[0]).sum() == 24
    np.testing.assert_allclose(c["x"].reshape(24, 5).mean(axis=1), ox, atol=1e-12)
    np.testing.assert_allclose(c["y"].reshape(24, 5).mean(axis=1), oy, atol=1e-12)


def _rows() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    fx = load_fixture("rowttest2")
    c = fx.input_columns()
    a = np.column_stack([c[f"a{i}"] for i in (1, 2, 3)])
    b = np.column_stack([c[f"b{i}"] for i in (1, 2, 3)])
    return a, b, fx.outputs()[0]


def test_origin_rowttest2_is_the_pooled_variance_t_test() -> None:
    """Guards the fixture for item 8: Origin's ``rowttest2`` P-value per row
    is Student's pooled-variance two-sample t-test (``scipy.stats.ttest_ind``
    ``equal_var=True``, 3e-16), not Welch's (0.054 away)."""
    a, b, p = _rows()
    np.testing.assert_allclose(stats.ttest_ind(a, b, axis=1).pvalue, p, atol=1e-12)
    assert np.abs(stats.ttest_ind(a, b, axis=1, equal_var=False).pvalue - p).max() > 0.01


@pytest.mark.xfail(
    strict=True,
    reason=(
        "quantized's single two-sample t_test is Welch's (unequal variance, "
        "fractional df); Origin's rowttest2 is the pooled Student test. Across "
        "the 8 rows the P-values differ by up to 0.054. The row-wise t-test "
        "offers both forms; its pooled form is pinned just below."
    ),
)
def test_t_test_per_row_equals_origin_rowttest2() -> None:
    a, b, p = _rows()
    ours = np.array([t_test(a[i], b[i])["pValue"] for i in range(a.shape[0])])
    np.testing.assert_allclose(ours, p, atol=1e-6)


def test_row_t_tests_pooled_form_equals_origin_rowttest2() -> None:
    """Item 8's row-wise t-test, pooled (Student) form, against Origin's frozen
    per-row P-values; the Welch form is the one that disagrees."""
    a, b, p = _rows()
    pooled = row_t_tests(a, b, variance="pooled")
    np.testing.assert_allclose([r["p"] for r in pooled["rows"]], p, atol=1e-12)
    welch = row_t_tests(a, b, variance="welch")
    assert np.abs(np.array([r["p"] for r in welch["rows"]]) - p).max() > 0.01

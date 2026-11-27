"""Origin's wavelets, power and sample size, and t-tests, frozen in wave 6.

quantized has no wavelet or power module yet, so the wavelet and power tests
pin the convention a future implementation must use (numpy / scipy are the
reference); the t-test comparison runs the real ``calc.stats.t_test``.
Skips without the corpus. Measured on OriginPro 2026b (10.35).
"""

from __future__ import annotations

import numpy as np
import pytest
from scipy import stats

from _origin_oracle_fixture import OracleFixture, load_fixture
from _origin_oracle_sheets import numeric, sheet_columns, trimmed
from quantized.calc.stats import t_test

pytestmark = pytest.mark.realdata

# The db4 constants below are typed to 16 digits from memory of the published
# table and agree with Origin to ~1e-12 (the pywt table is the reference), so
# the wavelet comparisons use 1e-10.
WT_TOL = 1e-10
S3 = np.sqrt(3.0)
DB4_LO = np.array([
    -0.010597401784997278, 0.032883011666982945, 0.030841381835986965, -0.18703481171888114,
    -0.02798376941698385, 0.6308807679295904, 0.7148465705525415, 0.23037781330885523,
])
FILTERS = {
    "haar": np.array([1.0, 1.0]) / np.sqrt(2.0),
    "db2": np.array([1 - S3, 3 - S3, 3 + S3, 1 + S3]) / (4 * np.sqrt(2.0)),
    "db4": DB4_LO,
}


def _hi(lo: np.ndarray) -> np.ndarray:
    n = len(lo)
    return np.array([(-1.0) ** (k + 1) * lo[n - 1 - k] for k in range(n)])


def _analysis(x: np.ndarray, w: str, mode: str) -> tuple[np.ndarray, np.ndarray]:
    """One level. P: circular convolution, odd samples kept. Z: zero-padded
    full convolution, odd samples kept (PyWavelets 'zero')."""
    lo = FILTERS[w]
    out = []
    for f in (lo, _hi(lo)):
        if mode == "P":
            n = len(x)
            full = np.array([sum(f[k] * x[(i - k) % n] for k in range(len(f))) for i in range(n)])
        else:
            full = np.convolve(x, f)
        out.append(full[1::2])
    return out[0], out[1]


def _synthesis_p(a: np.ndarray, d: np.ndarray, w: str) -> np.ndarray:
    lo = FILTERS[w]
    n = 2 * len(a)
    x = np.zeros(n)
    for f, c in ((lo, a), (_hi(lo), d)):
        up = np.zeros(n)
        up[1::2] = c
        for k in range(len(f)):
            x += f[k] * np.roll(up, -k)
    return x


def _wavedec(x: np.ndarray, w: str, mode: str, level: int):
    a, det = x, []
    for _ in range(level):
        a, d = _analysis(a, w, mode)
        det.append(d)
    return a, det


def _waverec(a: np.ndarray, det: list[np.ndarray], w: str) -> np.ndarray:
    for d in det[::-1]:
        a = _synthesis_p(a, d, w)
    return a


def _y(fx: OracleFixture) -> np.ndarray:
    return fx.input_columns()["y"]


# --- dwt / mdwt / idwt ------------------------------------------------------


@pytest.mark.parametrize(
    "idx,w,mode,length",
    [(0, "db4", "P", 128), (1, "db4", "Z", 131), (2, "haar", "P", 128), (3, "db2", "P", 128)],
)
def test_dwt_single_level_convention(idx: int, w: str, mode: str, length: int) -> None:
    """Periodic = circular convolution with the pywt analysis filters keeping the
    odd samples (not pywt 'periodization'); zero-padded = full convolution."""
    fx = load_fixture("dwt_single_level")
    out = fx.outputs()
    ca, cd = trimmed(out[2 * idx].tolist()), trimmed(out[2 * idx + 1].tolist())
    assert len(ca) == len(cd) == length
    a, d = _analysis(_y(fx), w, mode)
    np.testing.assert_allclose(ca, a, rtol=0, atol=WT_TOL)
    np.testing.assert_allclose(cd, d, rtol=0, atol=WT_TOL)


@pytest.mark.parametrize(
    "step,w,mode,level",
    [(1, "db4", "P", 4), (2, "db4", "Z", 4), (3, "haar", "P", 3), (4, "db2", "P", 6)],
)
def test_mdwt_is_repeated_dwt_of_the_approximation(
    step: int, w: str, mode: str, level: int
) -> None:
    fx = load_fixture("mdwt_levels")
    cols = dict(sheet_columns(fx, f"MDWT{step}"))
    a, det = _wavedec(_y(fx), w, mode, level)
    np.testing.assert_allclose(trimmed(cols[f"Approxi{level}"]), a, atol=WT_TOL)
    for lv in range(1, level + 1):
        np.testing.assert_allclose(trimmed(cols[f"Detail{lv}"]), det[lv - 1], atol=WT_TOL)


def test_idwt_reconstructs_both_extension_modes() -> None:
    fx = load_fixture("idwt_roundtrip")
    for name in ("IDWT_Result1", "IDWT_Result2"):
        res = next(v for b in fx.oracle["books"] for s in b["sheets"]
                   for c in s["columns"] if c["long"] == name for v in [c["values"]])
        np.testing.assert_allclose(trimmed(res)[:256], _y(fx), rtol=0, atol=WT_TOL)


# --- denoise / smooth -------------------------------------------------------


def _pairs(fx: OracleFixture) -> list[np.ndarray]:
    out = fx.outputs()
    return [trimmed(out[i + 1].tolist()) for i in range(0, len(out), 2)]


def test_wtsmooth_zeroes_the_tail_of_the_finest_levels_first() -> None:
    """cutoff p zeroes floor(p/100 * 252) detail coefficients, taking level 1
    first and, inside each level, from the LAST index backwards (so cutoff 20
    zeroes indices 78-127 of level 1). 6 levels of a 256-sample record."""
    fx = load_fixture("wtsmooth_cutoff")
    y = _y(fx)
    got = _pairs(fx)
    for idx, w, cut in ((0, "db4", 20), (1, "db4", 80), (2, "db4", 95), (3, "haar", 80)):
        a, det = _wavedec(y, w, "P", 6)
        budget = int(cut / 100 * 252)
        kept = []
        for d in det:
            d = d.copy()
            m = min(budget, len(d))
            if m:
                d[len(d) - m:] = 0.0
            budget -= m
            kept.append(d)
        np.testing.assert_allclose(_waverec(a, kept, w), got[idx], rtol=0, atol=WT_TOL)


def test_wtdenoise_custom_threshold_is_hard_and_global() -> None:
    """thrt custom, 50 percent: hard threshold T = 0.5 * max|detail| over the
    levels, the same T on every level; the approximation is untouched."""
    fx = load_fixture("wtdenoise_variants")
    y = _y(fx)
    a, det = _wavedec(y, "db4", "P", 4)
    t = 0.5 * max(np.abs(d).max() for d in det)
    kept = [np.where(np.abs(d) > t, d, 0.0) for d in det]
    np.testing.assert_allclose(_waverec(a, kept, "db4"), _pairs(fx)[2], rtol=0, atol=WT_TOL)


@pytest.mark.parametrize("idx,w,level", [(0, "db4", 4), (1, "db4", 6), (3, "haar", 4)])
def test_wtdenoise_sqtwolog_is_hard_thresholding(idx: int, w: str, level: int) -> None:
    """The universal threshold rule is not identified (see conventions) but its
    effect is: every detail coefficient is either kept exactly or zeroed."""
    fx = load_fixture("wtdenoise_variants")
    y = _y(fx)
    a, det = _wavedec(y, w, "P", level)
    a2, det2 = _wavedec(_pairs(fx)[idx], w, "P", level)
    np.testing.assert_allclose(a2, a, atol=WT_TOL)
    for d, d2 in zip(det, det2, strict=True):
        zero = np.abs(d2) < 1e-12
        np.testing.assert_allclose(d2[~zero], d[~zero], rtol=0, atol=WT_TOL)
        assert zero.any() or np.allclose(d2, d)
    kept_min = min(
        (np.abs(d[np.abs(d2) >= 1e-12]).min() for d, d2 in zip(det, det2, strict=True)
         if (np.abs(d2) >= 1e-12).any()), default=np.inf)
    zeroed_max = max(np.abs(d[np.abs(d2) < 1e-12]).max()
                     for d, d2 in zip(det, det2, strict=True) if (np.abs(d2) < 1e-12).any())
    assert zeroed_max < kept_min  # one global threshold separates them


def test_cwt_fixture_shape_and_zero_mean_kernels() -> None:
    """Pins what exists, not a formula: 4 wavelet runs of 12 scales x 256 rows,
    and Morlet 5 pseudo-frequency = 208 / scale for this record."""
    fx = load_fixture("cwt_wavelets")
    for k in range(1, 5):
        cols = sheet_columns(fx, f"CWTResults{k}")
        assert len(cols) == 12
        assert all(len(numeric(v)) >= 256 for _, v in cols)
    pf = next(v for b in fx.oracle["books"] for s in b["sheets"] for c in s["columns"]
              if c["long"] == "Pseudo-Frequency" for v in [c["values"]])
    scales = fx.input_columns()["scale"][:12]
    np.testing.assert_allclose(numeric(pf, 12) * scales, 208.0, rtol=1e-12)


# --- power and sample size --------------------------------------------------

SIZES = np.array([5, 8, 10, 15, 20, 30, 50, 100.0])
POWERS = np.array([0.5, 0.8, 0.9, 0.95, 0.99])


def _t_power(kind: int, n: float, m1: float, m2: float, sd: float, tail: int) -> float:
    alpha = 0.05
    if kind == 1:
        df, nc = n - 1, (m2 - m1) / sd * np.sqrt(n)
    elif kind == 2:
        df, nc = 2 * n - 2, (m1 - m2) / sd * np.sqrt(n / 2)
    else:
        df, nc = n - 1, (m1 - m2) / sd * np.sqrt(n)
    if tail == 0:
        tc = stats.t.ppf(1 - alpha / 2, df)
        return float(stats.nct.sf(tc, df, nc) + stats.nct.cdf(-tc, df, nc))
    tc = stats.t.ppf(1 - alpha, df)
    return float(stats.nct.sf(tc, df, nc) if tail == 1 else stats.nct.cdf(-tc, df, nc))


def _smallest_n(kind: int, m1: float, m2: float, sd: float, tail: int, p: float) -> int:
    n = 2
    while _t_power(kind, n, m1, m2, sd, tail) < p:
        n += 1
    return n


CASES = [
    ("pss_ttest1", 1, 0.0, 0.5, 1.2, [("a", 0), ("b", 1)]),
    ("pss_ttest2", 2, 0.0, 1.0, 1.5, [("a", 0)]),
    ("pss_ttestpair", 3, 10.0, 10.8, 1.4, [("a", 0), ("b", 2)]),
]


@pytest.mark.parametrize("case,kind,m1,m2,sd,tails", CASES)
def test_t_power_is_noncentral_t_and_size_is_the_smallest_integer(
    case: str, kind: int, m1: float, m2: float, sd: float, tails: list[tuple[str, int]]
) -> None:
    fx = load_fixture(case)
    cols = {c["long"]: numeric(c["values"]) for b in fx.oracle["books"]
            for s in b["sheets"] for c in s["columns"]}
    for tag, tail in tails:
        got = cols[f"{tag} power at size"][:8]
        want = [_t_power(kind, n, m1, m2, sd, tail) for n in SIZES]
        np.testing.assert_allclose(got, want, rtol=0, atol=1e-6)
        sizes = cols[f"{tag} size for power"][:5]
        want_n = [_smallest_n(kind, m1, m2, sd, tail, p) for p in POWERS]
        np.testing.assert_array_equal(sizes, want_n)
        actual = cols[f"{tag} actual power"][:5]
        want_p = [_t_power(kind, n, m1, m2, sd, tail) for n in sizes]
        np.testing.assert_allclose(actual, want_p, rtol=0, atol=1e-6)


def test_two_sample_greater_is_mean1_above_mean2_and_size_ignores_direction() -> None:
    """Means 0 and 1: 'greater' tests Mean1 > Mean2, so the power at size is tiny
    (a convention, not a defect) while the default sample-size route ignores
    the direction and gives the size for |difference|."""
    fx = load_fixture("pss_ttest2")
    cols = {c["long"]: numeric(c["values"]) for b in fx.oracle["books"]
            for s in b["sheets"] for c in s["columns"]}
    assert cols["b power at size"][:8].max() < 0.01
    np.testing.assert_array_equal(cols["b size for power"][:5], [13, 29, 40, 50, 72])
    np.testing.assert_array_equal(
        cols["b size for power"][:5],
        [_smallest_n(2, 1.0, 0.0, 1.5, 1, p) for p in POWERS],
    )


def test_anova_power_is_noncentral_f_with_css_over_sd_squared() -> None:
    fx = load_fixture("pss_anova1")
    cols = {c["long"]: numeric(c["values"]) for b in fx.oracle["books"]
            for s in b["sheets"] for c in s["columns"]}
    k, css, sd = 4, 2.0, 2.5

    def power(n: float) -> float:
        df1, df2 = k - 1, k * (n - 1)
        return float(stats.ncf.sf(stats.f.ppf(0.95, df1, df2), df1, df2, n * css / sd**2))

    np.testing.assert_allclose(cols["a power at size"][:8], [power(n) for n in SIZES], atol=1e-6)
    want = []
    for p in POWERS:
        n = 2
        while power(n) < p:
            n += 1
        want.append(n)
    np.testing.assert_array_equal(cols["a size for power"][:5], want)


# --- t-tests ----------------------------------------------------------------


def _groups(fx: OracleFixture) -> tuple[np.ndarray, np.ndarray]:
    c = fx.input_columns()
    b = c["b"]
    return c["a"], b[~np.isnan(b)]


def test_welch_t_test_matches_origin_equal_0() -> None:
    """quantized ``t_test`` (Welch) equals ttest2 equal:=0: statistic, df, P."""
    fx = load_fixture("ttest2_pooled_welch")
    v = fx.oracle["values"]
    a, b = _groups(fx)
    r = t_test(a, b)
    assert r["tStat"] == pytest.approx(v["ts2"], rel=1e-12)
    assert r["df"] == pytest.approx(v["df2"], rel=1e-12)
    assert r["pValue"] == pytest.approx(v["pr2"], rel=1e-6)


def test_pooled_t_test_matches_scipy_and_origin_equal_1() -> None:
    """quantized has no pooled form (item 8): scipy supplies the reference."""
    fx = load_fixture("ttest2_pooled_welch")
    v = fx.oracle["values"]
    a, b = _groups(fx)
    for i, alt in ((1, "two-sided"), (3, "greater")):
        r = stats.ttest_ind(a, b, equal_var=True, alternative=alt)
        assert v[f"ts{i}"] == pytest.approx(r.statistic, rel=1e-12)
        assert v[f"df{i}"] == 19.0
        assert v[f"pr{i}"] == pytest.approx(r.pvalue, rel=1e-9)


def test_origin_welch_confidence_limits_are_the_pooled_interval() -> None:
    """Origin quirk: equal:=0 changes t, df and P but lcl / ucl stay the POOLED
    interval, which quantized's (Welch) interval does not equal."""
    fx = load_fixture("ttest2_pooled_welch")
    v = fx.oracle["values"]
    a, b = _groups(fx)
    pooled = stats.ttest_ind(a, b, equal_var=True).confidence_interval(0.95)
    assert v["lo2"] == pytest.approx(pooled.low, rel=1e-7)  # Origin's t quantile: ~3e-10
    assert v["up2"] == pytest.approx(pooled.high, rel=1e-7)
    ci = t_test(a, b)["ci"]
    assert abs(ci[0] - v["lo2"]) > 0.1


def test_one_sided_limits_are_the_two_sided_interval_at_1_minus_2_alpha() -> None:
    fx = load_fixture("ttest2_pooled_welch")
    v = fx.oracle["values"]
    a, b = _groups(fx)
    ci90 = stats.ttest_ind(a, b, equal_var=True).confidence_interval(0.90)
    assert v["lo3"] == pytest.approx(ci90.low, rel=1e-7)
    assert v["up3"] == pytest.approx(ci90.high, rel=1e-7)

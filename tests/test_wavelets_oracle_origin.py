"""quantized's OriginPro-convention wavelet options against Origin's frozen answers.

``wavelet_origin`` (mode ``origin-periodic``, rule ``percent``, smooth
``cutoff``) run through ``calc.wavelets`` on the same seeded input the oracle
harness fed Origin. Skips without the corpus. OriginPro 2026b (10.35).

``wtdenoise thrt:=sqtwolog`` is NOT reproduced and not pinned; the last tests
record the evidence (what the frozen cases do and do not identify)."""

from __future__ import annotations

import numpy as np
import pytest

pywt = pytest.importorskip("pywt")

from _origin_oracle_fixture import OracleFixture, load_fixture  # noqa: E402
from _origin_oracle_sheets import numeric, sheet_columns, trimmed  # noqa: E402
from quantized.calc import wavelets as wv  # noqa: E402

pytestmark = pytest.mark.realdata

TOL = 1e-10
ORIGIN = "origin-periodic"


def _y(fx: OracleFixture) -> np.ndarray:
    return fx.input_columns()["y"]


def _pairs(fx: OracleFixture) -> list[np.ndarray]:
    out = fx.outputs()
    return [trimmed(out[i + 1].tolist()) for i in range(0, len(out), 2)]


@pytest.mark.parametrize("idx,w", [(0, "db4"), (2, "haar"), (3, "db2")])
def test_dwt_periodic_level_one(idx: int, w: str) -> None:
    fx = load_fixture("dwt_single_level")
    out = fx.outputs()
    ca, cd = trimmed(out[2 * idx].tolist()), trimmed(out[2 * idx + 1].tolist())
    got, _ = wv.wavedec(_y(fx), w, 1, ORIGIN)
    np.testing.assert_allclose(got[0], ca, rtol=0, atol=TOL)
    np.testing.assert_allclose(got[1], cd, rtol=0, atol=TOL)


@pytest.mark.parametrize("step,w,level", [(1, "db4", 4), (3, "haar", 3), (4, "db2", 6)])
def test_multilevel_periodic(step: int, w: str, level: int) -> None:
    fx = load_fixture("mdwt_levels")
    cols = dict(sheet_columns(fx, f"MDWT{step}"))
    got, _ = wv.wavedec(_y(fx), w, level, ORIGIN)
    np.testing.assert_allclose(trimmed(cols[f"Approxi{level}"]), got[0], atol=TOL)
    for lv in range(1, level + 1):
        np.testing.assert_allclose(trimmed(cols[f"Detail{lv}"]), got[-lv], atol=TOL)


@pytest.mark.parametrize(
    "idx,w,cut", [(0, "db4", 20), (1, "db4", 80), (2, "db4", 95), (3, "haar", 80)]
)
def test_wtsmooth_cutoff(idx: int, w: str, cut: int) -> None:
    fx = load_fixture("wtsmooth_cutoff")
    rec, _, _ = wv.smooth_cutoff(_y(fx), w, 6, ORIGIN, cut)
    np.testing.assert_allclose(rec, _pairs(fx)[idx], rtol=0, atol=TOL)


def test_wtdenoise_custom_percent() -> None:
    fx = load_fixture("wtdenoise_variants")
    rec, _ = wv.denoise(_y(fx), "db4", 4, ORIGIN, rule="percent", threshold_mode="hard", percent=50)
    np.testing.assert_allclose(rec, _pairs(fx)[2], rtol=0, atol=TOL)


def test_wtdenoise_sqtwolog_sigma_is_not_identified() -> None:
    """Evidence only. Every sqtwolog output removes ALL detail from the planted
    sinusoid, so the frozen cases give a LOWER bound on Origin's threshold T and
    (db4, level 6) an upper bound of 3.52. quantized's default sigma, the MAD of
    the finest level (T = 0.674), is below the lower bound: it is excluded. Several
    other sigmas (1, std(y)) fit, so none is pinned."""
    fx = load_fixture("wtdenoise_variants")
    y = _y(fx)
    coeffs, _ = wv.wavedec(y, "db4", 6, ORIGIN)
    out_coeffs, _ = wv.wavedec(_pairs(fx)[1], "db4", 6, ORIGIN)
    zeroed = [np.abs(d)[np.abs(o) < 1e-12] for d, o in zip(coeffs[1:], out_coeffs[1:], strict=True)]
    kept = [np.abs(d)[np.abs(o) >= 1e-12] for d, o in zip(coeffs[1:], out_coeffs[1:], strict=True)]
    lo = max(float(z.max()) for z in zeroed if z.size)
    hi = min(float(k.min()) for k in kept if k.size)
    assert 1.4258 < lo < 1.4259 and 3.52 < hi < 3.522
    mad_t = wv.universal_threshold(wv.noise_sigma(coeffs[-1]), y.size)
    assert mad_t < lo
    for sigma in (1.0, float(np.std(y))):
        assert lo < sigma * np.sqrt(2 * np.log(y.size)) < hi


def test_cwt_scale_normalisation_agrees_with_origin() -> None:
    """Origin's mexhat coefficients equal quantized's (PyWavelets' ``mexh``) to a
    best-fit scale of 1.00 +- 0.5 percent for scales 2..8 samples: the L2
    normalisation (1/sqrt(scale)) is shared. The residual (about 0.1 to 0.6 percent
    of the peak up to scale 8, 1 percent at 12, more at large scales where Origin cuts
    the wavelet at the record edge) is the integral-difference sampling of the
    wavelet, not a normalisation."""
    fx = load_fixture("cwt_wavelets")
    rows = [ln.split(",") for ln in fx.input_bytes.decode("utf-8").splitlines()[1:]]
    y = np.array([float(r[1]) for r in rows])
    scales = np.array([float(r[2]) for r in rows if r[2] != ""])
    cols = sheet_columns(fx, "CWTResults4")
    origin = np.array([numeric(v)[:256] for _, v in cols])
    mag, _, _ = wv.cwt_scalogram(y, 1.0, "mexh", scales)
    coef, _ = pywt.cwt(y, scales, "mexh", method="fft")
    for i, s in enumerate(scales[:5]):
        assert s <= 8
        fit = float(origin[i] @ coef[i].real / (coef[i].real @ coef[i].real))
        assert fit == pytest.approx(1.0, abs=0.005)
        assert np.abs(mag[i]).max() == pytest.approx(np.abs(coef[i]).max())

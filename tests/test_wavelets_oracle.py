"""quantized's wavelet transforms against OriginPro's own answers.

Each test runs ``quantized.calc.wavelets`` / the ``run_signal_op`` wavelet
methods on the SAME seeded input the oracle harness fed Origin
(``../test-data/origin/analysis_oracle/<case>/``) and compares with the answer
Origin froze. Skips without the local corpus (CI, other machines).

Measured on OriginPro 2026b (10.35). The fixtures carry no ``conventions``
field, so the conventions below were worked out from the numbers:

* **DWT, zero-padded:** identical to ``pywt`` mode ``zero`` (error 0.0).
* **DWT, periodic:** Origin's ``periodic`` equals ``pywt`` ``periodization`` of
  the input circularly rolled by ``dec_len / 2 - 1`` samples (db4 3, db2 1,
  bior2.2 2, haar 0; error 1e-15). Same energy, a circular shift of the
  coefficients: quantized's ``periodization`` is the unshifted form. A multilevel
  periodic Origin transform repeats that roll at EVERY level, so only the first
  level (and Haar, which needs no roll) agrees with ``wavedec``.
* **IDWT:** a DWT then IDWT returns the input exactly in both programs.
* **CWT:** Origin returns REAL coefficients of REAL wavelets; its scale axis and
  pseudo-frequency (``centre / (scale * dt)``) are PyWavelets'. ``dgauss`` order
  2 equals ``pywt`` ``gaus2`` exactly; ``mexhat`` equals ``mexh`` to within 3% of the
  peak at scales up to 12 samples, drifting at large scales where Origin truncates the
  wavelet at the record edge. quantized's scalogram is the MAGNITUDE, and its
  Morlet is the complex ``cmorB-C``, so Origin's real Morlet is not compared.
* **wtdenoise / wtsmooth:** the periodic convention, the custom percentage
  threshold and the smooth cutoff ARE reproduced (``origin-periodic`` mode, rule
  ``percent``, smooth ``cutoff``; see ``test_wavelets_oracle_origin.py``).
  ``sqtwolog`` is hard thresholding with one global threshold, but its sigma is
  not identified, so it is not pinned.
"""

from __future__ import annotations

import numpy as np
import pytest

pywt = pytest.importorskip("pywt")

from _origin_oracle_fixture import OracleFixture, load_fixture  # noqa: E402
from quantized.calc import wavelets as wv  # noqa: E402
from quantized.calc.signal_ops import run_signal_op  # noqa: E402
from quantized.datastruct import DataStruct  # noqa: E402

pytestmark = pytest.mark.realdata

Vec = np.ndarray


def _valid(v: Vec) -> Vec:
    return v[np.isfinite(v)]


def _signal(fx: OracleFixture) -> tuple[Vec, Vec, Vec]:
    """``(t, y, scales)`` of the frozen ``input.csv`` (the scale column is shorter
    than the record, so ``input_columns`` cannot parse its blank cells)."""
    rows = [ln.split(",") for ln in fx.input_bytes.decode("utf-8").splitlines()[1:]]
    t = np.array([float(r[0]) for r in rows])
    y = np.array([float(r[1]) for r in rows])
    return t, y, np.array([float(r[2]) for r in rows if r[2] != ""])


def _outputs(fx: OracleFixture) -> list[Vec]:
    """Every column Origin created (``fx.outputs`` cannot parse the text cell the
    multilevel transform leaves at the foot of its Detail1 column): text -> NaN."""

    def num(v: object) -> float:
        return float(v) if isinstance(v, int | float) else float("nan")

    return [
        np.array([num(v) for v in c["values"]])
        for b in fx.oracle["books"]
        for sh in b["sheets"]
        for c in sh["columns"]
    ]


def _roll(wavelet: str) -> int:
    return int(pywt.Wavelet(wavelet).dec_len) // 2 - 1


_DWT_CASES = [
    ("db4", "periodization"),
    ("db4", "zero"),
    ("haar", "periodization"),
    ("db2", "periodization"),
    ("bior2.2", "periodization"),
]


@pytest.mark.parametrize(("wavelet", "mode"), _DWT_CASES)
def test_single_level_dwt_matches_origin_with_its_periodic_roll(wavelet: str, mode: str) -> None:
    fx = load_fixture("dwt_single_level")
    k = _DWT_CASES.index((wavelet, mode))
    y = _signal(fx)[1]
    ca, cd = _valid(fx.outputs()[2 * k]), _valid(fx.outputs()[2 * k + 1])
    roll = _roll(wavelet) if mode == "periodization" else 0
    (got_a, got_d), lev = wv.wavedec(np.roll(y, roll), wavelet, 1, mode)[0][:2], 1
    assert lev == 1 and got_a.size == ca.size
    np.testing.assert_allclose(got_a, ca, rtol=0, atol=1e-9)
    np.testing.assert_allclose(got_d, cd, rtol=0, atol=1e-9)


def test_zero_padded_dwt_through_the_worksheet_op_is_identical_to_origin() -> None:
    fx = load_fixture("dwt_single_level")
    t, y, _ = _signal(fx)
    ds = DataStruct.create(t, y.reshape(-1, 1), labels=["y"], units=[""], metadata={"xUnit": "s"})
    r = run_signal_op(ds, "dwt", [0], {"wavelet": "db4", "level": 1, "mode": "zero"})
    np.testing.assert_allclose(_valid(r.data.values[:, 0]), _valid(fx.outputs()[2]), atol=1e-12)
    np.testing.assert_allclose(_valid(r.data.values[:, 1]), _valid(fx.outputs()[3]), atol=1e-12)


def test_multilevel_haar_periodic_and_db4_zero_match_origin() -> None:
    """Haar needs no roll, so the whole periodic cascade is ``wavedec``; the
    zero-padded db4 cascade extends each level the same way pywt does."""
    fx = load_fixture("mdwt_levels")
    y = _signal(fx)[1]
    out = _outputs(fx)
    # book layout (5 + 5 + 4 + 7 columns): A, D4..D1 | A, D4..D1 | A3, D3..D1 | ...
    haar = [_valid(c) for c in out[10:14]]
    coeffs, _ = wv.wavedec(y, "haar", 3, "periodization")
    for got, want in zip(coeffs, haar, strict=True):
        np.testing.assert_allclose(got, want, rtol=0, atol=1e-9)
    db4z = [_valid(c) for c in out[5:10]]
    coeffs, _ = wv.wavedec(y, "db4", 4, "zero")
    for got, want in zip(coeffs, db4z, strict=True):
        np.testing.assert_allclose(got, want, rtol=0, atol=1e-9)


def test_multilevel_periodic_db4_first_level_matches_and_deeper_levels_are_shifted() -> None:
    fx = load_fixture("mdwt_levels")
    y = _signal(fx)[1]
    d1_origin = _valid(_outputs(fx)[4])
    coeffs, _ = wv.wavedec(np.roll(y, _roll("db4")), "db4", 4, "periodization")
    np.testing.assert_allclose(coeffs[-1], d1_origin, rtol=0, atol=1e-9)
    d2_origin = _valid(_outputs(fx)[3])
    assert np.max(np.abs(coeffs[-2] - d2_origin)) > 1e-3  # the documented convention gap


def test_dwt_then_idwt_returns_the_input_in_both_programs() -> None:
    fx = load_fixture("idwt_roundtrip")
    y = _signal(fx)[1]
    for origin in (fx.outputs()[2], fx.outputs()[5]):
        np.testing.assert_allclose(_valid(origin), y, atol=1e-10)
    every = set(wv.component_names(1))
    for mode in ("periodization", "zero"):
        np.testing.assert_allclose(wv.reconstruct(y, "db4", 1, mode, every), y, atol=1e-10)


def _cwt_cases() -> tuple[Vec, Vec, Vec]:
    return _signal(load_fixture("cwt_wavelets"))


def _origin_rows(sheet: int, n_scales: int) -> Vec:
    """Origin's coefficient sheet ``sheet`` (1..4): rows = scales, cols = X."""
    fx = load_fixture("cwt_wavelets")
    out = fx.outputs()
    start = 4 + 12 * (sheet - 1)
    return np.vstack(out[start : start + n_scales])


def test_cwt_pseudo_frequency_and_dgauss2_match_origin_exactly() -> None:
    t, y, scales = _cwt_cases()
    fx = load_fixture("cwt_wavelets")
    dt = float(t[1] - t[0])
    mag, freqs, fc = wv.cwt_scalogram(y, dt, "gaus2", scales)
    # Origin's pseudo-frequency column for the dgauss step is the 3rd of the 4 (D..G)
    pf_origin = _valid(fx.outputs()[2])
    assert fc == pytest.approx(0.3)  # pywt's gaus2 centre frequency (Origin reports 0.3125)
    np.testing.assert_allclose(freqs, scales_to(0.3, scales, dt), rtol=1e-12)
    assert pf_origin[0] == pytest.approx(40.0)  # 0.3125 / (2 * dt)
    np.testing.assert_allclose(mag, np.abs(_origin_rows(3, scales.size)), rtol=0, atol=1e-9)


def scales_to(fc: float, scales: Vec, dt: float) -> Vec:
    return fc / (scales * dt)


def test_cwt_mexican_hat_matches_origin_at_small_scales() -> None:
    t, y, scales = _cwt_cases()
    mag, _, _ = wv.cwt_scalogram(y, float(t[1] - t[0]), "mexh", scales)
    origin = np.abs(_origin_rows(4, scales.size))
    for i in range(6):  # scales 2..12 samples: truncation at the record edge is negligible
        assert np.max(np.abs(mag[i] - origin[i])) < 0.03 * np.max(origin[i])

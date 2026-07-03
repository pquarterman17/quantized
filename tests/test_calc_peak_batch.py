"""Batch peak integration across a spectra series (calc.peak_batch).

Composed from golden-tested primitives (integrate_peaks + cross_correlation),
so the tests target the batch layer's own logic: alignment sign/recovery,
per-spectrum failure isolation, matrix shapes, and validation.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from quantized.calc.peak_batch import _shift_samples, batch_integrate_peaks

_X = np.linspace(0.0, 100.0, 501)
_DX = _X[1] - _X[0]


def _gauss(center: float, amp: float = 100.0, width: float = 4.0) -> np.ndarray:
    return amp * np.exp(-0.5 * ((_X - center) / width) ** 2) + 2.0


def test_shift_samples_direction_and_edges() -> None:
    y = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
    np.testing.assert_allclose(_shift_samples(y, 2), [1.0, 1.0, 1.0, 2.0, 3.0])  # right, edge-fill
    np.testing.assert_allclose(_shift_samples(y, -2), [3.0, 4.0, 5.0, 5.0, 5.0])  # left
    np.testing.assert_allclose(_shift_samples(y, 0), y)


def test_alignment_recovers_known_shift() -> None:
    ref = _gauss(50.0)
    shifted = _shift_samples(_gauss(50.0), 8)  # delayed 8 samples
    out = batch_integrate_peaks(_X, [ref, shifted], [(40.0, 60.0)], align=True)
    assert [r["shift_samples"] for r in out["results"]] == [0, 8]
    # after alignment both peaks sit at the reference position
    positions = [r["peaks"][0]["position"] for r in out["results"]]
    assert math.isclose(positions[0], 50.0) and math.isclose(positions[1], 50.0)
    # and the aligned shifted copy integrates to the reference area (interior region)
    a0, a1 = out["area_matrix"][0][0], out["area_matrix"][1][0]
    assert math.isclose(a0, a1, rel_tol=1e-9)


def test_no_alignment_leaves_offset() -> None:
    ref = _gauss(50.0)
    shifted = _shift_samples(_gauss(50.0), 8)
    out = batch_integrate_peaks(_X, [ref, shifted], [(40.0, 60.0)], align=False)
    assert all(r["shift_samples"] == 0 for r in out["results"])
    # the un-aligned copy's peak is offset by 8 samples in x
    assert math.isclose(out["results"][1]["peaks"][0]["position"], 50.0 + 8 * _DX, rel_tol=1e-6)


def test_matrices_and_multiple_regions() -> None:
    spectra = [_gauss(30.0) + _gauss(70.0) for _ in range(4)]
    out = batch_integrate_peaks(_X, spectra, [(20.0, 40.0), (60.0, 80.0)])
    assert out["n_spectra"] == 4 and out["n_regions"] == 2
    assert len(out["area_matrix"]) == 4 and all(len(row) == 2 for row in out["area_matrix"])
    assert len(out["centroid_matrix"]) == 4 and len(out["fwhm_matrix"]) == 4
    # identical spectra -> identical rows
    np.testing.assert_allclose(out["area_matrix"][0], out["area_matrix"][3], rtol=1e-12)


def test_failure_isolation_flags_bad_spectrum() -> None:
    good = _gauss(50.0)
    bad = _gauss(50.0).copy()
    bad[(_X >= 40.0) & (_X <= 60.0)] = np.nan  # region becomes all-NaN -> integrate fails
    out = batch_integrate_peaks(_X, [good, bad, good], [(40.0, 60.0)])
    assert out["n_failed"] == 1
    assert out["results"][1]["ok"] is False and "error" in out["results"][1]
    assert out["results"][0]["ok"] and out["results"][2]["ok"]
    assert math.isnan(out["area_matrix"][1][0])  # flagged row is NaN
    assert not math.isnan(out["area_matrix"][0][0])


def test_labels_passthrough() -> None:
    out = batch_integrate_peaks(
        _X, [_gauss(50.0), _gauss(50.0)], [(40.0, 60.0)], labels=["300K", "10K"]
    )
    assert [r["label"] for r in out["results"]] == ["300K", "10K"]


def test_validation_errors() -> None:
    with pytest.raises(ValueError, match="at least one spectrum"):
        batch_integrate_peaks(_X, [], [(40.0, 60.0)])
    with pytest.raises(ValueError, match="at least one region"):
        batch_integrate_peaks(_X, [_gauss(50.0)], [])
    with pytest.raises(ValueError, match="reference index"):
        batch_integrate_peaks(_X, [_gauss(50.0)], [(40.0, 60.0)], reference=5)
    with pytest.raises(ValueError, match="must equal x length"):
        batch_integrate_peaks(_X, [_gauss(50.0)[:-1]], [(40.0, 60.0)])
    with pytest.raises(ValueError, match="labels length"):
        batch_integrate_peaks(_X, [_gauss(50.0)], [(40.0, 60.0)], labels=["a", "b"])

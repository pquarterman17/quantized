"""Align to peak refuses noise maxima: a row is ok only for a real peak.

Acceptance defect (#1040): on six drifting peaks, five rows were marked ok,
some of them only the highest noise point inside the default window.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pytest

from quantized.calc.peak_align import DEFAULT_MIN_SNR, align_spectra, parabolic_peak_position

X = np.linspace(0.0, 70.0, 141)
LO, HI = 45.0, 58.0
# Planted peak centres: the first four sit inside the window, the last two have
# drifted out of it (one down, one up), leaving only baseline noise inside.
CENTRES = [52.0, 53.3, 51.1, 54.4, 38.0, 66.0]


def _spectra(seed: int = 7, noise: float = 0.6) -> list[np.ndarray]:
    rng = np.random.default_rng(seed)
    return [
        5.0 + 100.0 * np.exp(-0.5 * ((X - c) / 1.6) ** 2) + rng.normal(0.0, noise, X.size)
        for c in CENTRES
    ]


def test_drifted_out_peaks_are_flagged_and_the_rest_pinned_to_the_planted_drift() -> None:
    res = align_spectra([X] * 6, _spectra(), LO, HI)
    assert res["ok"] == [True, True, True, True, False, False]
    for i in (4, 5):
        err = str(res["errors"][i])  # type: ignore[index]
        assert "no clear peak" in err or "window edge" in err
        assert np.isnan(res["shifts"][i])  # type: ignore[index]
    # Shifts put every peak on the first one: shift_i = centre_0 - centre_i.
    want = [CENTRES[0] - c for c in CENTRES[:4]]
    assert res["shifts"][:4] == pytest.approx(want, abs=0.15)  # type: ignore[index]


def test_the_old_behaviour_accepted_noise_maxima() -> None:
    """With the check off, the same data reports garbage shifts as ok."""
    off = align_spectra([X] * 6, _spectra(), LO, HI, min_snr=0.0)
    noise_rows = [i for i in (4, 5) if off["ok"][i]]  # type: ignore[index]
    assert noise_rows, "fixture no longer reproduces the defect"
    for i in noise_rows:
        assert abs(off["shifts"][i] - (CENTRES[0] - CENTRES[i])) > 3  # type: ignore[index]


@pytest.mark.parametrize("seed", range(40))
def test_pure_noise_is_never_ok(seed: int) -> None:
    rng = np.random.default_rng(seed)
    y = 5.0 + rng.normal(0.0, 0.6, X.size)
    res = align_spectra([X, X], [_spectra()[0], y], LO, HI)
    assert res["ok"] == [True, False]


def test_false_accept_rate_on_noise_is_negligible() -> None:
    """Pure noise windows of realistic sizes: accepted well under 1%."""
    rng = np.random.default_rng(0)
    for n in (13, 40, 100):
        xs = np.linspace(0.0, 1.0, n)
        hits = 0
        for _ in range(1500):
            try:
                parabolic_peak_position(xs, rng.normal(0, 1, n), 0.0, 1.0, min_snr=DEFAULT_MIN_SNR)
                hits += 1
            except ValueError:
                pass
        assert hits / 1500 < 0.01, (n, hits)


def test_clean_peak_and_threshold_are_exposed() -> None:
    clean = 100.0 * np.exp(-0.5 * ((X - 52.0) / 1.6) ** 2)  # noise free
    assert align_spectra([X], [clean], LO, HI)["ok"] == [True]
    flat = np.full(X.size, 3.0)
    assert align_spectra([X, X], [clean, flat], LO, HI)["ok"] == [True, False]
    noise = np.random.default_rng(1).normal(0, 1.5, X.size)
    weak = 4.0 * np.exp(-0.5 * ((X - 52.0) / 1.6) ** 2) + noise
    assert align_spectra([X, X], [clean, weak], LO, HI)["ok"] == [True, False]
    assert align_spectra([X, X], [clean, weak], LO, HI, min_snr=1.0)["ok"] == [True, True]
    assert DEFAULT_MIN_SNR == 6.0


def test_too_few_points_are_refused_not_guessed() -> None:
    with pytest.raises(ValueError, match="fewer than 5"):  # 3 points: 51.5, 52, 52.5
        align_spectra([X], [_spectra()[0]], 51.4, 52.6)
    res = align_spectra([X], [_spectra()[0]], 51.4, 52.6, min_snr=0.0)  # the check is opt-out
    assert res["ok"] == [True]


def test_route_carries_threshold_and_flags(client: Any) -> None:
    ys = [y.tolist() for y in _spectra()]
    r = client.post("/api/peaks/align", json={"xs": [X.tolist()] * 6, "ys": ys, "lo": LO, "hi": HI})
    assert r.status_code == 200, r.text
    assert r.json()["ok"] == [True, True, True, True, False, False]
    assert r.json()["min_snr"] == 6.0
    off = client.post("/api/peaks/align", json={
        "xs": [X.tolist()] * 6, "ys": ys, "lo": LO, "hi": HI, "min_snr": 0})
    assert off.status_code == 200 and sum(off.json()["ok"]) > 4
    assert client.post("/api/peaks/align", json={
        "xs": [X.tolist()], "ys": [ys[0]], "lo": LO, "hi": HI, "min_snr": -1}).status_code == 422

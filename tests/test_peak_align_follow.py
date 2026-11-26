"""Align to peak, opt-in following window: each spectrum's own peak re-centres it."""

from __future__ import annotations

from typing import Any

import numpy as np
import pytest

from quantized.calc.peak_align import align_spectra

X = np.linspace(0.0, 70.0, 141)
LO, HI = 45.0, 58.0  # width 13
# Drifts of up to one window width either side of the reference at 52.
CENTRES = [52.0, 47.0, 58.5, 55.2, 40.0]


def _spectra(centres: list[float], seed: int = 3) -> list[np.ndarray]:
    rng = np.random.default_rng(seed)
    return [
        5.0 + 100.0 * np.exp(-0.5 * ((X - c) / 1.6) ** 2) + rng.normal(0.0, 0.5, X.size)
        for c in centres
    ]


def test_default_is_unchanged_and_misses_the_drifted_peaks() -> None:
    res = align_spectra([X] * 5, _spectra(CENTRES), LO, HI)
    assert res["follow"] is False
    assert res["windows"][0] == [LO, HI]  # type: ignore[index]
    assert res["ok"][2:5] != [True, True, True]  # type: ignore[index]


def test_follow_measures_each_spectrum_on_its_own_peak() -> None:
    res = align_spectra([X] * 5, _spectra(CENTRES), LO, HI, follow=True)
    assert res["follow"] is True
    assert res["ok"] == [True] * 5
    assert res["positions"] == pytest.approx(CENTRES, abs=0.15)
    assert res["shifts"] == pytest.approx([CENTRES[0] - c for c in CENTRES], abs=0.2)
    for c, w in zip(CENTRES, res["windows"], strict=True):  # type: ignore[arg-type]
        assert w == pytest.approx([c - 6.5, c + 6.5], abs=0.6)


def test_follow_still_refuses_noise_and_far_drift() -> None:
    far = [52.0, 5.0]  # 47 away: outside the widened search range
    noise = _spectra([52.0])[0], 5.0 + np.random.default_rng(1).normal(0, 0.5, X.size)
    res = align_spectra([X, X], [noise[0], _spectra(far)[1]], LO, HI, follow=True)
    assert res["ok"] == [True, False]
    res = align_spectra([X, X], list(noise), LO, HI, follow=True)
    assert res["ok"] == [True, False]
    assert "no clear peak" in str(res["errors"][1])  # type: ignore[index]
    assert res["windows"][1] is None  # type: ignore[index]


def test_follow_reference_must_be_measurable() -> None:
    noise = 5.0 + np.random.default_rng(2).normal(0, 0.5, X.size)
    with pytest.raises(ValueError, match="reference"):
        align_spectra([X], [noise], LO, HI, follow=True)


def test_route_follow_is_opt_in(client: Any) -> None:
    ys = [y.tolist() for y in _spectra(CENTRES)]
    body = {"xs": [X.tolist()] * 5, "ys": ys, "lo": LO, "hi": HI}
    r = client.post("/api/peaks/align", json=body)
    assert r.status_code == 200 and r.json()["follow"] is False
    r = client.post("/api/peaks/align", json={**body, "follow": True})
    assert r.status_code == 200
    assert r.json()["ok"] == [True] * 5
    assert len(r.json()["windows"]) == 5

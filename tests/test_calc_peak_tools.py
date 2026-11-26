"""Peak-tool completions: derivative finder, tangent baseline, peak alignment."""

from __future__ import annotations

import json
from typing import Any

import numpy as np
import pytest

from quantized.calc.peak_align import align_spectra, parabolic_peak_position
from quantized.calc.peak_derivative import find_peaks_derivative
from quantized.calc.peak_integrate import integrate_peaks
from quantized.calc.peak_tangent import tangent_baseline

X = np.linspace(10.0, 60.0, 1001)


def _gauss(c: float, w: float, a: float) -> Any:
    return a * np.exp(-0.5 * ((X - c) / w) ** 2)


def _lorentz(c: float, w: float, a: float) -> Any:
    return a / (1.0 + ((X - c) / w) ** 2)


def _pattern(seed: int = 1) -> Any:
    rng = np.random.default_rng(seed)
    return (_gauss(20, 0.4, 100) + _lorentz(35, 0.5, 60) + _gauss(48, 0.4, 80)
            + 5 + 0.05 * X + rng.normal(0, 1, X.size))


@pytest.mark.parametrize("order", [1, 2])
def test_derivative_finder_recovers_planted_peaks(order: int) -> None:
    peaks, bg = find_peaks_derivative(X, _pattern(), order=order)
    assert bg.shape == X.shape
    centres = [p["center"] for p in peaks]
    assert len(centres) == 3
    for got, want in zip(centres, (20.0, 35.0, 48.0), strict=True):
        assert abs(got - want) < 0.1
    assert {"center", "fwhm", "height", "bg", "prominence", "localSNR"} <= set(peaks[0])


def test_derivative_finder_rejects_pure_noise() -> None:
    rng = np.random.default_rng(3)
    peaks, _ = find_peaks_derivative(X, 50 + rng.normal(0, 1, X.size), order=1)
    assert peaks == []


def test_second_derivative_resolves_a_shoulder() -> None:
    y = _gauss(30, 0.5, 100) + _gauss(31.2, 0.5, 40)
    first, _ = find_peaks_derivative(X, y, order=1, smooth_window=15, min_separation=0.2)
    second, _ = find_peaks_derivative(X, y, order=2, smooth_window=15, min_separation=0.2)
    assert len(first) == 1
    assert len(second) == 2


def test_derivative_finder_validates_window_and_input() -> None:
    with pytest.raises(ValueError, match="odd"):
        find_peaks_derivative(X, _pattern(), smooth_window=8)
    with pytest.raises(ValueError, match="finite"):
        find_peaks_derivative(X, np.where(X > 30, np.nan, 1.0))
    with pytest.raises(ValueError, match="order"):
        find_peaks_derivative(X, _pattern(), order=3)


def test_tangent_baseline_recovers_planted_area() -> None:
    area, centre, w = 40.0, 30.0, 0.5
    amp = area / (w * np.sqrt(2 * np.pi))
    y = 3.0 + 0.7 * X + _gauss(centre, w, amp)
    lo, hi = centre - 6 * w, centre + 6 * w
    tangent = integrate_peaks(X, y, [(lo, hi)], baseline="tangent")
    assert tangent["peaks"][0]["area"] == pytest.approx(area, rel=2e-3)
    assert tangent["baseline"] == "tangent"


def test_tangent_beats_linear_on_a_curved_background() -> None:
    xs = np.linspace(0, 10, 401)
    area = 4.0 * 0.4 * np.sqrt(2 * np.pi)
    y = 0.05 * (xs - 5) ** 2 + 4 * np.exp(-0.5 * ((xs - 5) / 0.4) ** 2)
    base, (left, right) = tangent_baseline(xs, y)
    apex = int(np.argmax(y))
    assert left < apex < right
    assert np.all(y - base >= -1e-12)
    assert y[left] == pytest.approx(base[left])
    assert y[right] == pytest.approx(base[right])
    t = integrate_peaks(xs, y, [(2.0, 8.0)], baseline="tangent")["peaks"][0]["area"]
    assert t > 0 and np.isfinite(t) and abs(t - area) < area


def test_tangent_refuses_peakless_or_edge_windows() -> None:
    xs = np.linspace(0, 1, 20)
    with pytest.raises(ValueError, match="edge"):
        tangent_baseline(xs, xs)
    with pytest.raises(ValueError, match="region 0"):
        integrate_peaks(xs, xs, [(0.0, 1.0)], baseline="tangent")
    with pytest.raises(ValueError, match="tangent"):
        integrate_peaks(xs, xs, [(0.0, 1.0)], baseline="bogus")


def test_default_integration_unchanged() -> None:
    y = 2.0 + _gauss(30, 0.5, 10)
    assert integrate_peaks(X, y, [(27, 33)]) == integrate_peaks(X, y, [(27, 33)], baseline="linear")


def test_parabolic_peak_position_is_subsample_accurate() -> None:
    got = parabolic_peak_position(X, _gauss(30.0037, 0.4, 1.0), 28, 32)
    assert got == pytest.approx(30.0037, abs=2e-3)
    with pytest.raises(ValueError, match="edge"):
        parabolic_peak_position(X, X, 20, 30)
    with pytest.raises(ValueError, match="fewer than 3"):
        parabolic_peak_position(X, X, 20, 20.01)


def test_align_recovers_planted_shifts() -> None:
    planted = [0.0, 0.31, -0.42, 0.77]
    xs = [X + s for s in planted]  # the same peak on axes offset by s
    ys = [_gauss(30.0, 0.5, 10.0) for _ in planted]
    res = align_spectra(xs, ys, 25.0, 35.0)
    assert res["shifts"] == pytest.approx([-s for s in planted], abs=3e-3)
    assert res["target"] == pytest.approx(res["positions"][0])  # type: ignore[index]
    typed = align_spectra(xs, ys, 25.0, 35.0, target=30.0)
    for x, y, s in zip(xs, ys, typed["shifts"], strict=True):  # type: ignore[arg-type]
        assert parabolic_peak_position(x + s, y, 25, 35) == pytest.approx(30.0, abs=1e-6)


def test_align_flags_unmeasurable_spectra_and_refuses_bad_reference() -> None:
    good, bad = _gauss(30, 0.5, 10), np.linspace(0, 1, X.size)
    res = align_spectra([X, X], [good, bad], 25, 35)
    assert res["ok"] == [True, False]
    assert np.isnan(res["shifts"][1])  # type: ignore[index]
    with pytest.raises(ValueError, match="reference"):
        align_spectra([X, X], [bad, good], 25, 35)
    assert align_spectra([X, X], [bad, good], 25, 35, target=30.0)["ok"] == [False, True]


def test_routes(client: Any) -> None:
    y = _pattern().tolist()
    assert client.post("/api/peaks/find", json={"x": X.tolist(), "y": y}).status_code == 200
    for finder in ("derivative1", "derivative2"):
        r = client.post("/api/peaks/find", json={"x": X.tolist(), "y": y, "finder": finder})
        assert r.status_code == 200, r.text
        assert len(r.json()["peaks"]) == 3
    bad = client.post("/api/peaks/find",
                      json={"x": X.tolist(), "y": y, "finder": "derivative1", "smooth_window": 8})
    assert bad.status_code == 422
    integ = client.post("/api/peaks/integrate", json={
        "x": X.tolist(), "y": (_gauss(30, 0.5, 5) + 1).tolist(),
        "regions": [[26, 34]], "baseline": "tangent"})
    assert integ.status_code == 200 and integ.json()["baseline"] == "tangent"
    al = client.post("/api/peaks/align", json={
        "xs": [X.tolist(), (X + 0.5).tolist()], "ys": [_gauss(30, 0.5, 1).tolist()] * 2,
        "lo": 27, "hi": 33})
    assert al.status_code == 200
    assert al.json()["shifts"][1] == pytest.approx(-0.5, abs=3e-3)
    miss = client.post("/api/peaks/align", json={
        "xs": [X.tolist()], "ys": [X.tolist()], "lo": 20, "hi": 30})
    assert miss.status_code == 422


@pytest.mark.realdata
# The 2nd-derivative finder needs a window comparable to the broadest peak (FWHM 0.8 = 40 points).
@pytest.mark.parametrize(("order", "window"), [(1, 15), (2, 31)])
def test_derivative_finder_matches_origin_pkfind_oracle(
    corpus_dir: Any, order: int, window: int
) -> None:
    """Origin's pkFind on three planted Gaussians (oracle.json, the "Xs of Peak
    Centers" column) vs this finder; skips when the corpus fixture is absent."""
    case = corpus_dir / "origin" / "analysis_oracle" / "pkfind"
    if not (case / "oracle.json").is_file() or not (case / "input.csv").is_file():
        pytest.skip("Origin pkFind oracle fixture not present")
    oracle = json.loads((case / "oracle.json").read_text(encoding="utf-8"))
    if oracle.get("status") != "ok":
        pytest.skip("pkFind oracle run did not finish ok")
    cols = {c["long"]: [v for v in c["values"] if v is not None]
            for b in oracle["books"] for sh in b["sheets"] for c in sh["columns"]}
    want = cols["Xs of Peak Centers"]
    data = np.genfromtxt(case / "input.csv", delimiter=",", skip_header=1)
    peaks, _ = find_peaks_derivative(data[:, 0], data[:, 1], order=order, smooth_window=window,
                                     min_separation=0.3)
    got = [p["center"] for p in peaks]
    assert len(got) == len(want)
    np.testing.assert_allclose(got, want, atol=0.05)

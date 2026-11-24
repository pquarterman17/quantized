"""calc/xrd_search.py: built-in phase search/match (peak list -> ranked phases).

No MATLAB golden (``matchPhases`` was not available to freeze). Positions are
the built-in phases' own reflections (``phase_reflections``), so the cases
below feed a phase its own reflection positions and check it ranks first; the
coverage arithmetic is hand-computed.
"""

from __future__ import annotations

import pytest

from quantized.calc.xrd_index import phase_reflections
from quantized.calc.xrd_search import search_phases, window_coverage


def _positions(name: str, lo: float = 20.0, hi: float = 80.0) -> list[float]:
    rows = phase_reflections(name, two_theta_min=lo, two_theta_max=hi)["reflections"]
    return [float(r["two_theta"]) for r in rows]


def test_window_coverage_union_and_clip() -> None:
    # [9.9, 10.2] overlapping windows -> 0.3; [-0.1, 0.1] clipped to [0, 0.1] -> 0.1
    assert window_coverage([10.0, 10.1, 0.0], 0.1, 0.0, 20.0) == pytest.approx(0.4 / 20)
    assert window_coverage([], 0.1, 0.0, 20.0) == 0.0
    assert window_coverage([5.0], 0.0, 0.0, 20.0) == 0.0
    with pytest.raises(ValueError):
        window_coverage([1.0], 0.1, 5.0, 5.0)


def test_silicon_peaks_rank_silicon_first() -> None:
    r = search_phases([28.44, 47.30, 56.12, 69.13, 76.38], two_theta_min=20, two_theta_max=80)
    top = r["candidates"][0]
    assert top["name"] == "Silicon"
    assert top["n_matched"] == 5
    assert top["reflections_observed"] == top["n_reflections"] == 5
    assert top["labels"] == ["(111)", "(220)", "(311)", "(400)", "(331)"]
    # 5 windows of 0.4 deg in a 60 deg span, none overlapping: coverage 2/60.
    assert top["coverage"] == pytest.approx(2.0 / 60.0)
    assert top["expected_by_chance"] == pytest.approx(5 * 2.0 / 60.0)
    assert top["excess"] == pytest.approx(5 - 5 * 2.0 / 60.0)
    assert r["n_peaks"] == 5 and r["n_peaks_outside"] == 0


def test_two_phase_mixture_lists_both_on_top() -> None:
    peaks = _positions("MgO") + [28.44, 47.30, 56.12]
    names = [
        c["name"] for c in search_phases(peaks, two_theta_min=20, two_theta_max=80)["candidates"]
    ]
    assert names[:2] == ["MgO", "Silicon"]


def test_many_reflection_phase_is_penalised_for_chance() -> None:
    r = search_phases([28.44, 47.30, 56.12], two_theta_min=20, two_theta_max=80)
    for c in r["candidates"]:
        assert c["excess"] == pytest.approx(c["n_matched"] - c["expected_by_chance"])
        assert c["expected_by_chance"] == pytest.approx(3 * c["coverage"])
    excess = [c["excess"] for c in r["candidates"]]
    assert excess == sorted(excess, reverse=True)


def test_wavelength_moves_the_match() -> None:
    # Si peaks measured with Cu K-alpha1 index Si at 1.5406 A, not at Mo K-alpha.
    peaks = [28.44, 47.30, 56.12]
    cu = {
        c["name"]: c for c in search_phases(peaks, two_theta_min=10, two_theta_max=80)["candidates"]
    }
    assert cu["Silicon"]["n_matched"] == 3
    mo = search_phases(peaks, wavelength=0.7093, two_theta_min=10, two_theta_max=80)
    assert "Silicon" not in [c["name"] for c in mo["candidates"]]


def test_reflection_just_outside_the_scan_explains_an_edge_peak() -> None:
    # Si (111) sits at 2theta = 28.44 deg (Cu K-alpha1). A scan starting at
    # 28.5 holds a peak at 28.55 (0.11 deg from the reflection, within 0.2).
    si_111 = _positions("Silicon", 20, 30)[0]
    lo = si_111 + 0.06
    r = search_phases([lo + 0.05], two_theta_min=lo, two_theta_max=80)
    si = next(c for c in r["candidates"] if c["name"] == "Silicon")
    assert si["n_matched"] == 1 and si["labels"] == ["(111)"]
    # Counted because it explains a peak; coverage stays clipped to the scan:
    # the (111) window contributes only [lo, si_111 + 0.2].
    assert si["reflections_observed"] == 1
    assert si["n_reflections"] == 1 + len(_positions("Silicon", lo, 80))
    in_range = _positions("Silicon", lo, 80)
    expected = (si_111 + 0.2 - lo + 0.4 * len(in_range)) / (80 - lo)
    assert si["coverage"] == pytest.approx(expected)


def test_near_duplicate_peaks_each_count() -> None:
    # Provisional rule: a split peak on one reflection counts twice.
    r = search_phases([28.40, 28.48], two_theta_min=20, two_theta_max=80)
    si = next(c for c in r["candidates"] if c["name"] == "Silicon")
    assert si["n_matched"] == 2 and si["reflections_observed"] == 1


def test_peaks_outside_range_are_counted_not_scored() -> None:
    r = search_phases([28.44, 47.30, 120.0], two_theta_min=20, two_theta_max=80)
    assert r["n_peaks"] == 2 and r["n_peaks_outside"] == 1


@pytest.mark.parametrize(
    ("peaks", "kwargs", "msg"),
    [
        ([], {}, "at least one"),
        ([5.0], {"two_theta_min": 20.0, "two_theta_max": 80.0}, "inside"),
        ([30.0], {"tolerance": -1.0}, "tolerance"),
        ([float("nan")], {}, "finite"),
        ([30.0], {"wavelength": 0.0}, "wavelength"),
        ([30.0], {"two_theta_min": 50.0, "two_theta_max": 40.0}, "range"),
        ([30.0] * 201, {}, "at most"),
    ],
)
def test_bad_inputs_fail_closed(peaks: list[float], kwargs: dict[str, float], msg: str) -> None:
    with pytest.raises(ValueError, match=msg):
        search_phases(peaks, **kwargs)

"""Level crossings read in sweep order (calc/curve_measure_ordered.py): an M-H loop."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.calc.curve_measure import level_crossings
from quantized.calc.curve_measure_ordered import level_crossings_in_order

HC = 150.0  # the known coercivity of the synthetic loop, Oe
WIDTH = 400.0
HMAX = 5000.0


def _loop(n_loops: int, noise: float, seed: int = 3) -> tuple[np.ndarray, np.ndarray]:
    """+Hmax -> -Hmax -> +Hmax, ``n_loops`` times.

    M = tanh((H -/+ Hc) / w) + noise: the down branch is shifted by +Hc, the up branch by -Hc.
    """
    rng = np.random.default_rng(seed)
    down = np.linspace(HMAX, -HMAX, 400)
    up = np.linspace(-HMAX, HMAX, 400)
    h = np.concatenate([down, up] * n_loops)
    on_down = np.concatenate([np.ones(down.size, bool), np.zeros(up.size, bool)] * n_loops)
    m = np.tanh((h + np.where(on_down, HC, -HC)) / WIDTH) + rng.normal(0.0, noise, h.size)
    return h, m


def test_dead_band_gives_two_crossings_per_loop_at_plus_and_minus_hc() -> None:
    h, m = _loop(n_loops=2, noise=0.05)
    bare = level_crossings_in_order(h, m, 0.0)
    # noise near M = 0 gives a burst: this is the problem the band solves
    assert len(bare.crossings) > 4
    r = level_crossings_in_order(h, m, 0.0, hysteresis=0.25)
    assert [c.direction for c in r.crossings] == ["falling", "rising"] * 2
    # M = 0 on the down branch at H = -Hc, on the up branch at +Hc; noise moves a crossing by ~
    # sigma * w
    xs = [c.x for c in r.crossings]
    assert xs == pytest.approx([-HC, HC] * 2, abs=3 * 0.05 * WIDTH)
    assert r.merged_duplicates == 0 and r.hysteresis == 0.25 and r.n_points == h.size


def test_noise_free_crossings_match_an_independent_interpolation() -> None:
    h, m = _loop(n_loops=1, noise=0.0)
    r = level_crossings_in_order(h, m, 0.0)
    # numpy: a sign change between k and k + 1
    k = np.flatnonzero(np.sign(m[:-1]) * np.sign(m[1:]) < 0)
    expected = h[k] + (0.0 - m[k]) / (m[k + 1] - m[k]) * (h[k + 1] - h[k])
    assert len(r.crossings) == 2
    assert [c.x for c in r.crossings] == pytest.approx(expected.tolist(), abs=1e-9)
    # the loop's own Hc, to the grid
    assert [c.x for c in r.crossings] == pytest.approx([-HC, HC], abs=1.0)


def test_default_reading_sorts_by_x_and_mixes_the_branches() -> None:
    h, m = _loop(n_loops=1, noise=0.0)
    sorted_reading = level_crossings(h, m, 0.0)
    # Sorted by H the two branches interleave inside |H| < Hc and trade places: 25 crossings, none
    # of them
    # the Hc pair (the default reading is left as it was; the sweep-order variant is the opt-in).
    assert len(sorted_reading.crossings) == 25
    assert sorted_reading.merged_duplicates == 92
    assert not any(abs(abs(c.x) - HC) < 5.0 for c in sorted_reading.crossings)


def test_order_variant_validation() -> None:
    with pytest.raises(ValueError, match="negative"):
        level_crossings_in_order([0, 1], [0, 1], 0.5, hysteresis=-1)
    with pytest.raises(ValueError, match="finite"):
        level_crossings_in_order([0, 1], [0, 1], float("nan"))
    with pytest.raises(ValueError, match="at least 2"):
        level_crossings_in_order([0.0], [0.0], 0.0)
    with pytest.raises(ValueError, match="not finite"):
        level_crossings_in_order([0, 1, 2], [0, float("nan"), 1], 0.5)
    dropped = level_crossings_in_order(
        [0, 1, 2, 3], [-1, float("nan"), 1, -1], 0.0, nonfinite="drop"
    )
    assert dropped.dropped == 1 and dropped.n_points == 3
    with pytest.raises(ValueError, match="direction"):
        level_crossings_in_order([0, 1], [0, 1], 0.5, direction="up")  # type: ignore[arg-type]


def test_direction_filter_follows_y_along_the_sweep() -> None:
    h, m = _loop(n_loops=1, noise=0.0)
    r = level_crossings_in_order(h, m, 0.0, direction="rising")
    assert [c.direction for c in r.crossings] == ["rising"]
    assert r.crossings[0].x == pytest.approx(HC, abs=1.0)


def test_route_in_order_flag_is_opt_in(client: TestClient) -> None:
    h, m = _loop(n_loops=1, noise=0.0)
    body = {"x": h.tolist(), "y": m.tolist(), "level": 0.0}
    plain = client.post("/api/curve-measure/level-crossings", json=body).json()
    ordered = client.post(
        "/api/curve-measure/level-crossings", json={**body, "in_order": True}
    ).json()
    assert [c["x"] for c in ordered["crossings"]] == pytest.approx([-HC, HC], abs=1.0)
    explicit_off = client.post(
        "/api/curve-measure/level-crossings", json={**body, "in_order": False}
    )
    assert plain == explicit_off.json()
    assert plain != ordered


@pytest.mark.realdata
def test_real_vsm_loop_has_one_crossing_per_branch_in_sweep_order(corpus_dir: Path) -> None:
    from quantized.io import import_auto

    path = corpus_dir / "quantum-design/magnetometry/vsm_mh_ip_b.dat"
    if not path.exists():
        pytest.skip("real Quantum Design loop is not installed")
    d = import_auto(path)
    h, m = d.time, d.values[:, 0]
    # the X-sorted reading: the reported burst
    assert len(level_crossings(h, m, 0.0).crossings) == 37
    r = level_crossings_in_order(h, m, 0.0, hysteresis=2e-5)
    k = np.flatnonzero(np.sign(m[:-1]) * np.sign(m[1:]) < 0)
    expected = h[k] + (0.0 - m[k]) / (m[k + 1] - m[k]) * (h[k + 1] - h[k])
    assert len(k) == 2 and len(r.crossings) == 2
    assert [c.x for c in r.crossings] == pytest.approx(expected.tolist(), abs=1e-6)

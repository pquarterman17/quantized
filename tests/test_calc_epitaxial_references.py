"""Reference tests for published epitaxial relationships (plan G1, OPEN_ITEMS 25).

Only cells already in the repo are used: the substrate table
(``calc.substrates``: SrTiO3 3.905, LSAT 3.868, LaAlO3 3.789 Å, all pseudocubic
(100)) and the phase table (Si F, a = 5.4309 Å). Cube-on-cube is a geometric
identity: two cubic cells with parallel axes on a (001) plane have square nets
of sides ``a_f`` and ``a_s``, so the 1:1 match has mismatch
``(a_f - a_s)/a_s`` on both axes, no rotation and ``[100] ∥ [100]``. The
tests derive that from the repo's own constants rather than quoting a
literature mismatch.

Invariants checked: swapping film and substrate maps ``f`` to ``-f/(1+f)``;
planes related by a cubic symmetry operation give the same net and the same
coincidence search; supercell areas are integer multiples of the net areas.
"""

from __future__ import annotations

import itertools
import math

import pytest

from quantized.calc.coincidence import coincidence_search
from quantized.calc.phase_database import get_phase
from quantized.calc.substrates import get_substrate
from quantized.calc.surface_net import net_mismatch, surface_net

PEROVSKITES = ["SrTiO3(100)", "LSAT(100)", "LaAlO3(100)"]


def _plane(name: str) -> dict[str, object]:
    return {"a": get_substrate(name)["a"], "centering": "P", "hkl": [0, 0, 1]}


@pytest.mark.parametrize(("film", "sub"), list(itertools.permutations(PEROVSKITES, 2)))
def test_perovskite_cube_on_cube_is_the_1x1_match(film: str, sub: str) -> None:
    a_f, a_s = get_substrate(film)["a"], get_substrate(sub)["a"]
    expected = (a_f - a_s) / a_s
    best = coincidence_search(_plane(film), _plane(sub), max_strain=0.1)["matches"][0]
    assert (best["film_index"], best["substrate_index"]) == (1, 1)
    assert best["f_u"] == pytest.approx(expected, rel=1e-12)
    assert best["f_v"] == pytest.approx(expected, rel=1e-12)
    assert best["rotation"] == pytest.approx(0.0, abs=1e-9)
    assert best["delta_gamma"] == pytest.approx(0.0, abs=1e-9)
    # [100] ∥ [100]: the same axis (up to sign) on both sides.
    assert [abs(x) for x in best["film_direction"]] == [abs(x) for x in best["substrate_direction"]]
    assert sorted(abs(x) for x in best["film_direction"]) == [0, 0, 1]


def test_perovskite_mismatch_ordering_follows_the_lattice_constants() -> None:
    # On SrTiO3 both LSAT (3.868) and LaAlO3 (3.789) are smaller: compressive, LaAlO3 more.
    sto = surface_net(**_net("SrTiO3(100)"))

    def f(film: str) -> float:
        return float(net_mismatch(surface_net(**_net(film)), sto)["f_u"])

    assert f("LaAlO3(100)") < f("LSAT(100)") < 0
    assert net_mismatch(sto, sto)["f_u"] == 0.0


def _net(name: str) -> dict[str, object]:
    return {"a": get_substrate(name)["a"], "hkl": (0, 0, 1)}


@pytest.mark.parametrize(("film", "sub"), list(itertools.permutations(PEROVSKITES, 2)))
def test_swapping_film_and_substrate_inverts_the_mismatch(film: str, sub: str) -> None:
    fwd = net_mismatch(surface_net(**_net(film)), surface_net(**_net(sub)))
    rev = net_mismatch(surface_net(**_net(sub)), surface_net(**_net(film)))
    # f' = (a_s - a_f)/a_f = -f/(1+f)
    assert rev["f_u"] == pytest.approx(-fwd["f_u"] / (1 + fwd["f_u"]), rel=1e-12)
    assert rev["f_area"] == pytest.approx(-fwd["f_area"] / (1 + fwd["f_area"]), rel=1e-12)
    assert rev["delta_gamma"] == pytest.approx(-fwd["delta_gamma"], abs=1e-9)


@pytest.mark.parametrize("hkl", [(1, 0, 0), (0, 1, 0), (0, 0, 1), (0, 0, -1), (-1, 0, 0)])
def test_cubic_symmetry_related_planes_give_the_same_net_and_search(
    hkl: tuple[int, int, int],
) -> None:
    ref = surface_net(5.4309, (0, 0, 1), centering="F")
    net = surface_net(5.4309, hkl, centering="F")
    for key in ("u", "v", "gamma", "area"):
        assert net[key] == pytest.approx(ref[key], rel=1e-12)
    sto = {"a": 3.905, "centering": "P", "hkl": [0, 0, 1]}
    film = {"a": 5.4309, "centering": "F", "hkl": list(hkl)}
    a = coincidence_search(film, sto, max_area=120)["matches"]
    b = coincidence_search({**film, "hkl": [0, 0, 1]}, sto, max_area=120)["matches"]
    key = [
        (m["film_index"], m["substrate_index"], round(m["f_u"], 12), round(m["area"], 9)) for m in a
    ]
    assert key == [
        (m["film_index"], m["substrate_index"], round(m["f_u"], 12), round(m["area"], 9)) for m in b
    ]


def test_si111_is_a_hexagonal_net_of_side_a_over_root2() -> None:
    a = get_phase("Silicon")["a"]
    net = surface_net(a, (1, 1, 1), centering=get_phase("Silicon")["centering"])
    assert net["u"] == pytest.approx(a / math.sqrt(2), rel=1e-12)
    assert net["v"] == pytest.approx(a / math.sqrt(2), rel=1e-12)
    assert net["gamma"] == pytest.approx(120.0, abs=1e-9)
    # Area of a hexagonal net of side s: s^2 sin(120 deg) = (sqrt(3)/2) s^2.
    assert net["area"] == pytest.approx(math.sqrt(3) / 2 * (a / math.sqrt(2)) ** 2, rel=1e-12)
    # Equivalent {111} planes share the net.
    for hkl in [(-1, 1, 1), (1, -1, 1), (1, 1, -1)]:
        other = surface_net(a, hkl, centering="F")
        assert other["area"] == pytest.approx(net["area"], rel=1e-12)
        assert other["gamma"] == pytest.approx(120.0, abs=1e-9)


def test_si111_on_itself_is_the_1x1_zero_strain_match() -> None:
    plane = {"a": 5.4309, "centering": "F", "hkl": [1, 1, 1]}
    best = coincidence_search(plane, plane)["matches"][0]
    assert (best["film_index"], best["substrate_index"]) == (1, 1)
    assert best["f_u"] == pytest.approx(0.0, abs=1e-12)
    assert best["rotation"] == pytest.approx(0.0, abs=1e-9)


@pytest.mark.parametrize(
    ("film", "sub"),
    [
        (
            {"a": 3.189, "c": 5.1864, "gamma": 120.0, "hkl": [0, 0, 0, 1]},  # GaN (phase table)
            {"a": 4.7589, "c": 12.991, "gamma": 120.0, "centering": "R", "hkl": [0, 0, 0, 1]},
        ),
        (
            {"a": 2.8665, "centering": "I", "hkl": [0, 0, 1]},  # Fe(bcc) on MgO
            {"a": 4.2112, "centering": "F", "hkl": [0, 0, 1]},
        ),
    ],
)
def test_supercell_areas_are_integer_multiples_of_the_net_areas(
    film: dict[str, object], sub: dict[str, object]
) -> None:
    r = coincidence_search(film, sub, max_strain=0.17, max_area=300)
    a_s, a_f = r["substrate_net"]["area"], r["film_net"]["area"]
    assert r["matches"]
    for m in r["matches"]:
        # ``area`` is the substrate supercell: exactly ``substrate_index`` net areas.
        assert m["area"] / a_s == pytest.approx(m["substrate_index"], rel=1e-9)
        assert isinstance(m["film_index"], int)
        # The film supercell (film_index nets) matches it within the reported area strain.
        assert m["film_index"] * a_f / m["area"] == pytest.approx(
            1 + m["f_area_pct"] / 100, rel=1e-9
        )

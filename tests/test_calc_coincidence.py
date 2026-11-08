"""Reference tests for ``calc.coincidence`` (THIN_FILM_STACK_PLANNING_PLAN G1).

A Python extension with no MATLAB counterpart, checked against epitaxial
relationships from the literature and against invariants of the search:
Fe(001)/MgO(001) cube-on-cube rotated 45° (Fe[100] ∥ MgO[110], −3.7 %),
GaN(0001)/c-sapphire √3×√3 R30° (+16 % within a loose tolerance), and TiN/Si(001)
4:3 domain matching (16 TiN cells on 9 Si cells, cube-on-cube, +4.1 %).
"""

from __future__ import annotations

import math

import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.coincidence import coincidence_search

client = TestClient(app)
FE = {"a": 2.8665, "centering": "I", "hkl": [0, 0, 1]}
MGO = {"a": 4.2112, "centering": "F", "hkl": [0, 0, 1]}
GAN = {"a": 3.189, "c": 5.1864, "gamma": 120.0, "hkl": [0, 0, 0, 1]}
SAPPHIRE = {"a": 4.7589, "c": 12.991, "gamma": 120.0, "centering": "R", "hkl": [0, 0, 0, 1]}
TIN = {"a": 4.24, "centering": "F", "hkl": [0, 0, 1]}
SI = {"a": 5.431, "centering": "F", "hkl": [0, 0, 1]}


def test_fe_on_mgo_is_the_1x1_match_with_the_45_degree_relationship() -> None:
    best = coincidence_search(FE, MGO)["matches"][0]
    expected = (2.8665 - 4.2112 / math.sqrt(2)) / (4.2112 / math.sqrt(2))
    assert (best["film_index"], best["substrate_index"]) == (1, 1)
    assert best["f_u"] == pytest.approx(expected) and best["f_v"] == pytest.approx(expected)
    assert best["rotation"] == pytest.approx(0.0)
    # Fe <100> ∥ MgO <110>: the film direction is a cube axis, the substrate's a face diagonal.
    assert sorted(abs(x) for x in best["film_direction"]) == [0, 0, 1]
    assert sorted(abs(x) for x in best["substrate_direction"]) == [0, 1, 1]


def test_gan_on_sapphire_finds_sqrt3_r30_and_gives_4_index_directions() -> None:
    r = coincidence_search(GAN, SAPPHIRE, max_strain=0.17)
    best = r["matches"][0]
    assert (best["film_index"], best["substrate_index"]) == (3, 1)  # √3×√3 on 1×1
    assert best["rotation"] == pytest.approx(30.0)
    assert best["f_u_pct"] == pytest.approx((3.189 * math.sqrt(3) / 4.7589 - 1) * 100)
    assert r["rotation_period"] == 60
    assert len(best["film_direction_4"]) == 4 and len(best["substrate_direction_4"]) == 4
    f4 = best["film_direction_4"]
    assert f4[2] == -(f4[0] + f4[1])  # t = -(u + v)


def test_tin_on_si_includes_the_4_to_3_cube_on_cube_domain_match() -> None:
    matches = coincidence_search(TIN, SI, max_area=160)["matches"]
    domain = [m for m in matches if (m["film_index"], m["substrate_index"]) == (16, 9)]
    assert domain, "4:3 domain match missing"
    assert domain[0]["rotation"] == pytest.approx(0.0)
    assert domain[0]["f_u_pct"] == pytest.approx(
        (4 * 4.24 / math.sqrt(2) / (3 * 5.431 / math.sqrt(2)) - 1) * 100
    )


def test_bcc110_on_fcc111_gives_kurdjumov_sachs() -> None:
    # Fe(110) on Cu(111): the best matches put Fe <111> parallel to Cu <110>.
    fe110 = {"a": 2.8665, "centering": "I", "hkl": [1, 1, 0]}
    cu111 = {"a": 3.6149, "centering": "F", "hkl": [1, 1, 1]}
    best = coincidence_search(fe110, cu111, max_strain=0.12, max_area=60)["matches"][0]
    assert sorted(abs(x) for x in best["film_direction"]) == [1, 1, 1]
    assert sorted(abs(x) for x in best["substrate_direction"]) == [0, 1, 1]


def test_rhombic_net_keeps_the_sign_of_the_rotation() -> None:
    # BCC (110) is rhombic: its mirrors are not along the reference axis, so
    # +θ and −θ are distinct and must not be folded into |θ|.
    fe110 = {"a": 2.8665, "centering": "I", "hkl": [1, 1, 0]}
    cu111 = {"a": 3.6149, "centering": "F", "hkl": [1, 1, 1]}
    rots = [
        m["rotation"]
        for m in coincidence_search(fe110, cu111, max_strain=0.12, max_area=60, max_results=100)[
            "matches"
        ]
    ]
    assert any(r < 0 for r in rots)


def test_results_are_ranked_by_area_then_strain_and_respect_the_limits() -> None:
    r = coincidence_search(TIN, SI, max_strain=0.05, max_area=160)
    areas = [m["area"] for m in r["matches"]]
    assert areas == sorted(areas)
    for m in r["matches"]:
        assert abs(m["f_u"]) <= 0.05 and abs(m["f_v"]) <= 0.05
        assert abs(m["delta_gamma"]) <= 1.0
        assert m["area"] <= 160 + 1e-9


def test_no_multiples_and_no_mirror_duplicates() -> None:
    keys = [
        (
            round(m["f_u"], 5),
            round(m["f_v"], 5),
            round(m["delta_gamma"], 3),
            round(m["rotation"], 2),
        )
        for m in coincidence_search(FE, MGO, max_results=100)["matches"]
    ]
    assert len(keys) == len(set(keys))  # 2×2, 3×3 … of the 1×1 are not listed again
    assert all(rot >= 0 for *_, rot in keys)  # +θ and −θ fold together (both nets have mirrors)


def test_identical_lattices_match_1x1_with_zero_strain() -> None:
    best = coincidence_search(MGO, MGO)["matches"][0]
    assert (best["film_index"], best["substrate_index"], best["f_u"], best["f_v"]) == (
        1,
        1,
        0.0,
        0.0,
    )


@pytest.mark.parametrize(
    ("kwargs", "message"),
    [
        ({"max_strain": 0.0}, "max_strain"),
        ({"max_angle": 20.0}, "max_angle"),
        ({"max_area": 1.0}, "smaller than a primitive cell"),
        ({"max_area": 1000.0}, "more than 60 primitive cells"),
        ({"max_results": 0}, "max_results"),
    ],
)
def test_bad_limits_are_refused(kwargs: dict[str, float], message: str) -> None:
    with pytest.raises(ValueError, match=message):
        coincidence_search(FE, MGO, **kwargs)  # type: ignore[arg-type]


def test_route() -> None:
    r = client.post(
        "/api/epitaxy/coincidence",
        json={"film": GAN, "substrate": SAPPHIRE, "max_strain": 0.17, "max_results": 3},
    )
    assert r.status_code == 200
    body = r.json()
    assert len(body["matches"]) == 3
    assert body["matches"][0]["rotation"] == pytest.approx(30.0)
    bad = client.post(
        "/api/epitaxy/coincidence", json={"film": FE, "substrate": MGO, "max_area": 1}
    )
    assert bad.status_code == 422

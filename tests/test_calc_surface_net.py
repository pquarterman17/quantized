"""Reference tests for ``calc.surface_net`` (THIN_FILM_STACK_PLANNING_PLAN G1).

A Python extension with no MATLAB counterpart: checked against textbook surface
nets (the reduced 2D lattice of a plane, including Bravais centering), published
epitaxial mismatches, and invariants (equivalent planes, gcd reduction,
identical lattices).
"""

from __future__ import annotations

import math

import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.surface_net import net_mismatch, surface_net

client = TestClient(app)
A_SI = 5.431


@pytest.mark.parametrize(
    ("hkl", "u", "v", "gamma"),
    [
        ((1, 0, 0), A_SI / math.sqrt(2), A_SI / math.sqrt(2), 90.0),  # FCC (100): square a/√2
        ((1, 1, 1), A_SI / math.sqrt(2), A_SI / math.sqrt(2), 120.0),  # FCC (111): hexagonal a/√2
        ((1, 1, 0), A_SI / math.sqrt(2), A_SI, 90.0),  # FCC (110): a/√2 × a rectangle
    ],
)
def test_fcc_nets(hkl: tuple[int, int, int], u: float, v: float, gamma: float) -> None:
    r = surface_net(A_SI, hkl, centering="F")
    assert (r["u"], r["v"], r["gamma"]) == (
        pytest.approx(u),
        pytest.approx(v),
        pytest.approx(gamma),
    )


def test_si_100_and_111_now_differ_from_the_conventional_cell() -> None:
    # The scalar substrate mismatch used a = 5.431 for both; the nets differ in shape.
    r100 = surface_net(A_SI, (1, 0, 0), centering="F")
    r111 = surface_net(A_SI, (1, 1, 1), centering="F")
    assert r100["gamma"] == pytest.approx(90.0) and r111["gamma"] == pytest.approx(120.0)
    assert r100["area"] == pytest.approx(A_SI**2 / 2)
    assert r111["area"] == pytest.approx(math.sqrt(3) / 4 * A_SI**2)


def test_bcc_nets() -> None:
    a = 2.8665
    sq = surface_net(a, (0, 0, 1), centering="I")
    assert (sq["u"], sq["v"], sq["gamma"]) == (
        pytest.approx(a),
        pytest.approx(a),
        pytest.approx(90.0),
    )
    rh = surface_net(a, (1, 1, 0), centering="I")
    assert rh["u"] == pytest.approx(a * math.sqrt(3) / 2)
    assert rh["gamma"] == pytest.approx(math.degrees(math.acos(-1 / 3)))  # 109.47°
    assert rh["area"] == pytest.approx(a * a * math.sqrt(2) / 2)


def test_hexagonal_basal_nets_including_r_centering() -> None:
    for cen, a, c in (("P", 3.189, 5.1864), ("R", 4.7589, 12.991)):
        r = surface_net(a, (0, 0, 0, 1), c=c, gamma=120.0, centering=cen)
        assert (r["u"], r["v"], r["gamma"]) == (
            pytest.approx(a),
            pytest.approx(a),
            pytest.approx(120.0),
        )
    # 3- and 4-index forms of the same plane agree.
    a3 = surface_net(4.7589, (1, 1, 0), c=12.991, gamma=120.0, centering="R")
    a4 = surface_net(4.7589, (1, 1, -2, 0), c=12.991, gamma=120.0, centering="R")
    assert (a3["u"], a3["v"], a3["gamma"]) == pytest.approx((a4["u"], a4["v"], a4["gamma"]))


def test_net_area_equals_cell_volume_over_planes_per_period() -> None:
    # Primitive-lattice identity: area = V_prim * |G|, G = h a* + k b* + l c*.
    a, b, c = 3.0, 4.0, 5.0
    for hkl in ((1, 0, 0), (1, 1, 0), (2, 1, 3)):
        r = surface_net(a, hkl, b=b, c=c)
        g = math.sqrt((hkl[0] / a) ** 2 + (hkl[1] / b) ** 2 + (hkl[2] / c) ** 2)
        assert r["area"] == pytest.approx(a * b * c * g)


def test_equivalent_and_scaled_planes_give_the_same_net() -> None:
    base = surface_net(3.905, (1, 0, 0))
    for hkl in ((0, 1, 0), (0, 0, 1), (-1, 0, 0), (2, 0, 0)):
        r = surface_net(3.905, hkl)
        assert (r["u"], r["v"], r["gamma"], r["area"]) == pytest.approx(
            (base["u"], base["v"], base["gamma"], base["area"])
        )
    assert surface_net(3.905, (2, 0, 0))["hkl"] == [1, 0, 0]


def test_four_index_plane_needs_hexagonal_axes() -> None:
    with pytest.raises(ValueError, match="hexagonal-axes cell"):
        surface_net(3.905, (1, 1, -2, 0))
    with pytest.raises(ValueError, match="hexagonal-axes cell"):
        surface_net(3.0, (0, 0, 0, 1), b=3.1, c=5.0, gamma=120.0)


@pytest.mark.parametrize(
    ("hkl", "kwargs", "message"),
    [
        ((0, 0, 0), {}, "not all be zero"),
        ((1, 1, 1, 1), {"gamma": 120.0}, "i = -\\(h\\+k\\)"),
        ((7, 0, 0), {}, "above 6"),
        ((1, 0), {}, "\\(h k l\\)"),
        ((1, 0, 0), {"centering": "Q"}, "unknown centering"),
        ((1, 0, 0), {"alpha": 10.0, "beta": 10.0, "gamma": 170.0}, "non-physical"),
    ],
)
def test_bad_inputs_are_refused(
    hkl: tuple[int, ...], kwargs: dict[str, object], message: str
) -> None:
    with pytest.raises(ValueError, match=message):
        surface_net(4.0, hkl, **kwargs)  # type: ignore[arg-type]


def test_fe_on_mgo_uses_the_rotated_net_and_matches_the_published_value() -> None:
    # Fe(001)[100] ∥ MgO(001)[110]: Fe a = 2.8665 vs MgO a/√2 = 2.978 → about -3.7 %.
    fe = surface_net(2.8665, (0, 0, 1), centering="I")
    mgo = surface_net(4.2112, (0, 0, 1), centering="F")
    r = net_mismatch(fe, mgo)
    expected = (2.8665 - 4.2112 / math.sqrt(2)) / (4.2112 / math.sqrt(2))
    assert r["f_u"] == pytest.approx(expected) and r["f_v"] == pytest.approx(expected)
    assert r["delta_gamma"] == pytest.approx(0.0)


def test_cube_on_cube_perovskite_and_identical_lattices() -> None:
    lsmo = surface_net(3.876, (0, 0, 1))
    sto = surface_net(3.905, (0, 0, 1))
    assert net_mismatch(lsmo, sto)["f_u_pct"] == pytest.approx((3.876 - 3.905) / 3.905 * 100)
    same = net_mismatch(sto, sto)
    assert (same["f_u"], same["f_v"], same["f_area"]) == (0.0, 0.0, 0.0)


def test_rectangular_nets_align_on_the_better_axis_pairing() -> None:
    film = {"u": 3.0, "v": 5.0, "gamma": 90.0, "area": 15.0}
    sub = {"u": 3.05, "v": 5.1, "gamma": 90.0, "area": 3.05 * 5.1}
    assert net_mismatch(film, sub)["swapped"] is False
    wide = {"u": 4.9, "v": 5.1, "gamma": 90.0, "area": 4.9 * 5.1}
    rect = {"u": 2.0, "v": 5.0, "gamma": 90.0, "area": 10.0}
    assert net_mismatch(wide, rect)["swapped"] is False  # straight is already the better fit
    assert net_mismatch(film, {"u": 5.1, "v": 3.05, "gamma": 90, "area": 15.555})["swapped"] is True


def test_routes() -> None:
    r = client.post(
        "/api/epitaxy/surface-net", json={"a": A_SI, "centering": "F", "hkl": [1, 1, 1]}
    )
    assert r.status_code == 200
    assert r.json()["gamma"] == pytest.approx(120.0)
    m = client.post(
        "/api/epitaxy/net-mismatch",
        json={
            "film": {"a": 2.8665, "centering": "I", "hkl": [0, 0, 1]},
            "substrate": {"a": 4.2112, "centering": "F", "hkl": [0, 0, 1]},
        },
    )
    assert m.status_code == 200
    assert m.json()["f_u_pct"] == pytest.approx(-3.737, abs=1e-3)
    bad = client.post("/api/epitaxy/surface-net", json={"a": 4.0, "hkl": [0, 0, 0]})
    assert bad.status_code == 422

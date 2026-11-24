"""Design of experiments (GAP_AUDIT_9 J16): published-table and numeric checks.

Oracles: the NIST/SEMATECH e-Handbook per-design files (committed under
``tests/fixtures/nist_doe/``: generators, resolution, confounding structure
for all 27 designs of Table 3.17), NIST Tables 3.23-3.28 (CCD alpha, the
three-factor CCC/CCI/CCF/Box-Behnken settings and run counts), the
Plackett-Burman / orthogonality properties, and Montgomery's 2^4 filtration
rate example for the effects.
"""

from __future__ import annotations

import re
from itertools import combinations
from pathlib import Path

import numpy as np
import pytest

from quantized.calc import doe
from quantized.calc import doe_alias as al
from quantized.calc.doe_effects import effects
from quantized.calc.doe_sheet import FactorSetting, build_worksheet
from quantized.calc.doe_tables import FRACTIONAL, LETTERS

NIST = Path(__file__).parent / "fixtures" / "nist_doe"
TOKEN = re.compile(r"\(\d+\)|\d")


def _nums(text: str) -> tuple[int, ...]:
    return tuple(int(t.strip("()")) for t in TOKEN.findall(text))


def _nist(k: int, p: int) -> dict[str, object]:
    """Parse one NIST per-design file: resolution, runs, each factor's definition
    and its published confounding (digit-string tokens; ``HIGHER`` text dropped)."""
    lines = (NIST / f"2to{k}m{p}.txt").read_text().splitlines()
    res = int(next(x for x in lines if x.startswith("RESOLUTION")).split("=")[1].split()[0])
    runs = int(
        next(x for x in lines if x.startswith("NUMBER OF OBSERVATIONS")).split("=")[1].split()[0]
    )
    start = next(i for i, x in enumerate(lines) if "FACTOR" in x and "DEFINITION" in x) + 1
    defs: dict[int, tuple[int, ...]] = {}
    conf: dict[int, set[tuple[int, ...]]] = {}
    for x in lines[start:]:
        if x.startswith(". . ."):
            break
        m = re.match(r"^\s*\(?(\d+)\)?\s+(\d+)\s+(.*)$", x)
        assert m, x
        f = int(m.group(1))
        defs[f] = tuple(int(c) for c in m.group(2))
        conf[f] = {
            tuple(int(c) for c in t.strip()) for t in m.group(3).split("+") if t.strip().isdigit()
        } - {(f,)}
    return {"res": res, "runs": runs, "defs": defs, "conf": conf}


@pytest.mark.parametrize(("k", "p"), sorted(FRACTIONAL))
def test_generators_resolution_runs_match_nist(k: int, p: int) -> None:
    nist = _nist(k, p)
    stated, gens = FRACTIONAL[(k, p)]
    base = k - p
    for j, g in enumerate(gens):
        assert nist["defs"][base + j + 1] == g, (k, p, j)  # type: ignore[index]
    # base factors are defined as themselves
    assert [nist["defs"][i] for i in range(1, base + 1)] == [  # type: ignore[index]
        (i,) for i in range(1, base + 1)
    ]
    assert nist["res"] == stated and nist["runs"] == 2**base
    d = doe.fractional_factorial(k, p)
    assert d.n_runs == 2**base
    assert d.resolution == stated  # computed from the defining relation


@pytest.mark.parametrize(("k", "p"), [kp for kp in sorted(FRACTIONAL) if kp[0] <= 9])
def test_main_effect_aliases_match_nist(k: int, p: int) -> None:
    """Alias sets of every main effect up to 2-factor interactions equal NIST's
    published confounding structure."""
    nist = _nist(k, p)
    stated, gens = FRACTIONAL[(k, p)]
    if stated == 3 and not any(nist["conf"].values()):  # type: ignore[attr-defined]
        pytest.skip("the NIST file prints only 'Higher' for this resolution III design")
    relation = al.defining_relation(al.generator_words(k - p, gens))
    mine: dict[int, set[tuple[int, ...]]] = {}
    for cls in al.alias_classes(relation, k, 2):
        masks = [sum(1 << LETTERS.index(c) for c in lab) for lab in cls]
        for m in masks:
            if bin(m).count("1") == 1:
                mine[m.bit_length()] = {
                    tuple(j + 1 for j in range(k) if mm >> j & 1) for mm in masks
                }
    for f in range(1, k + 1):
        published = {(f,)} | {q for q in nist["conf"][f] if len(q) <= 2}  # type: ignore[index]
        assert mine[f] == published, (k, p, f)


def test_seven_factor_eight_run_matches_nist_text() -> None:
    d = doe.fractional_factorial(7, 4)
    assert d.generators == ("D = AB", "E = AC", "F = BC", "G = ABC")
    assert d.resolution == 3
    # NIST 2to7m4.txt: "1 + 24 + 35 + 67" -> A + BD + CE + FG
    assert ("A", "BD", "CE", "FG") in d.aliases


def _gram(x: np.ndarray) -> np.ndarray:
    return x.T @ x


@pytest.mark.parametrize(
    ("k", "p"), [(3, 1), (4, 1), (5, 1), (5, 2), (6, 2), (7, 4), (8, 4), (9, 5)]
)
def test_fractions_are_orthogonal_and_balanced(k: int, p: int) -> None:
    x = doe.fractional_factorial(k, p).coded
    n = x.shape[0]
    assert set(np.unique(x)) == {-1.0, 1.0}
    assert np.allclose(x.sum(axis=0), 0)  # balance
    assert np.allclose(_gram(x), n * np.eye(k))  # main effects mutually orthogonal
    assert len({tuple(r) for r in x}) == n  # no repeated run


def test_resolution_iv_mains_clear_of_two_factor_interactions() -> None:
    d = doe.fractional_factorial(8, 4)  # resolution IV
    x = d.coded
    for i in range(8):
        for a, b in combinations([j for j in range(8) if j != i], 2):
            assert abs(float(np.dot(x[:, i], x[:, a] * x[:, b]))) < 1e-9


def test_full_factorial_standard_order_replicates_and_center() -> None:
    d = doe.full_factorial(3, replicates=2, center_points=3)
    assert d.n_runs == 8 * 2 + 3 and d.point_type[-3:] == ("center",) * 3
    assert d.coded[:4].tolist() == [[-1, -1, -1], [1, -1, -1], [-1, 1, -1], [1, 1, -1]]
    assert np.allclose(d.coded[:8], d.coded[8:16])
    assert len(d.terms) == 3 + 3  # mains + 2FI
    with pytest.raises(ValueError):
        doe.full_factorial(1)
    with pytest.raises(ValueError):
        doe.full_factorial(3, replicates=0)


def test_fraction_unavailable_and_estimable_model() -> None:
    with pytest.raises(ValueError, match="no published"):
        doe.fractional_factorial(4, 2)
    d = doe.fractional_factorial(7, 4)
    assert d.terms == tuple((i,) for i in range(7))  # every 2FI is aliased with a main effect
    d5 = doe.fractional_factorial(5, 1)  # resolution V: all 15 terms
    assert len(d5.terms) == 5 + 10
    x = d5.coded
    cols = [np.ones(len(x))] + [np.prod(x[:, list(t)], axis=1) for t in d5.terms]
    assert np.linalg.matrix_rank(np.column_stack(cols)) == 16


@pytest.mark.parametrize("runs", [12, 20, 24])
def test_plackett_burman_orthogonal(runs: int) -> None:
    d = doe.plackett_burman(runs, runs - 1)
    x = d.coded
    assert x.shape == (runs, runs - 1) and set(np.unique(x)) == {-1.0, 1.0}
    assert np.allclose(_gram(x), runs * np.eye(runs - 1))
    assert np.allclose(x.sum(axis=0), 0)
    assert np.linalg.matrix_rank(np.column_stack([np.ones(runs), x])) == runs
    assert doe.plackett_burman(runs, 5).coded.shape == (runs, 5)


def test_plackett_burman_refusals() -> None:
    with pytest.raises(ValueError):
        doe.plackett_burman(16, 5)
    with pytest.raises(ValueError):
        doe.plackett_burman(12, 12)


@pytest.mark.parametrize(("k", "alpha"), [(2, 1.414), (3, 1.682), (4, 2.0), (5, 2.378), (6, 2.828)])
def test_rotatable_alpha_matches_nist_table_3_23(k: int, alpha: float) -> None:
    d = doe.central_composite(k, "rotatable", fractional=False)
    assert d.alpha == pytest.approx(alpha, abs=5e-4)
    assert doe.central_composite(5, fractional=True).alpha == pytest.approx(2.0)
    assert doe.central_composite(6, fractional=True).alpha == pytest.approx(2.378, abs=5e-4)


@pytest.mark.parametrize(
    ("k", "fractional", "runs"),
    [
        (2, False, 13),
        (3, False, 20),
        (4, False, 30),
        (5, True, 33),
        (5, False, 52),
        (6, True, 54),
        (6, False, 91),
    ],
)
def test_ccd_run_counts_match_nist_table_3_28(k: int, fractional: bool, runs: int) -> None:
    assert doe.central_composite(k, fractional=fractional).n_runs == runs


@pytest.mark.parametrize(("k", "runs"), [(3, 15), (4, 27), (5, 46)])
def test_box_behnken_run_counts_match_nist_table_3_28(k: int, runs: int) -> None:
    assert doe.box_behnken(k).n_runs == runs


def test_box_behnken_three_factor_equals_nist_table_3_24() -> None:
    expected = [
        [-1, -1, 0], [1, -1, 0], [-1, 1, 0], [1, 1, 0],
        [-1, 0, -1], [1, 0, -1], [-1, 0, 1], [1, 0, 1],
        [0, -1, -1], [0, 1, -1], [0, -1, 1], [0, 1, 1],
    ]  # fmt: skip
    d = doe.box_behnken(3)
    assert d.coded[:12].tolist() == expected
    assert np.all(d.coded[12:] == 0) and d.center_points == 3


def test_ccd_three_factor_equals_nist_table_3_24() -> None:
    d = doe.central_composite(3)
    a = d.alpha
    assert d.coded[:8].tolist() == doe.full_factorial(3).coded.tolist()
    assert d.coded[8:14].tolist() == [
        [-a, 0, 0], [a, 0, 0], [0, -a, 0], [0, a, 0], [0, 0, -a], [0, 0, a],
    ]  # fmt: skip
    assert d.point_type[8:14] == ("axial",) * 6 and d.center_points == 6


def test_ccd_actual_units_match_nist_tables_3_25_and_3_26() -> None:
    f = [FactorSetting(n, 10.0, 20.0) for n in ("X1", "X2", "X3")]
    ccc = build_worksheet(doe.central_composite(3), f)
    actual = ccc.values[:, 5:8]
    assert actual[0].tolist() == [10, 10, 10] and actual[7].tolist() == [20, 20, 20]
    assert actual[8].tolist() == pytest.approx([6.6, 15, 15], abs=0.05)  # table: 6.6
    assert actual[9].tolist() == pytest.approx([23.4, 15, 15], abs=0.05)
    cci = build_worksheet(doe.central_composite(3, inscribed=True), f)
    a = cci.values[:, 5:8]
    assert a[0].tolist() == pytest.approx([12, 12, 12], abs=0.05)  # table: 12 / 18
    assert a[7].tolist() == pytest.approx([18, 18, 18], abs=0.05)
    assert a[8].tolist() == pytest.approx([10, 15, 15]) and a[9].tolist() == pytest.approx(
        [20, 15, 15]
    )
    ccf = build_worksheet(doe.central_composite(3, "face_centered"), f)
    assert ccf.values[8, 5:8].tolist() == [10, 15, 15]
    bb = build_worksheet(doe.box_behnken(3), f)
    assert bb.values[0, 5:8].tolist() == [10, 10, 15] and bb.values[1, 5:8].tolist() == [20, 10, 15]


def _moments(x: np.ndarray) -> tuple[float, float]:
    """(sum x_i^4, 3 * sum x_i^2 x_j^2) per factor pair: equal for a rotatable design."""
    k = x.shape[1]
    s4 = float(np.sum(x[:, 0] ** 4))
    s22 = float(np.sum(x[:, 0] ** 2 * x[:, 1] ** 2)) if k > 1 else 0.0
    return s4, 3 * s22


@pytest.mark.parametrize("k", [2, 3, 4])
def test_rotatable_ccd_satisfies_moment_conditions(k: int) -> None:
    x = doe.central_composite(k, "rotatable").coded
    s4, s22 = _moments(x)
    assert s4 == pytest.approx(s22)  # fourth moments: E x^4 = 3 E x_i^2 x_j^2
    assert np.allclose(x.sum(axis=0), 0)
    assert abs(float(np.sum(x[:, 0] * x[:, 1]))) < 1e-9  # no cross second moment
    face = doe.central_composite(k, "face_centered").coded
    assert face.max() == 1.0
    assert _moments(face)[0] != pytest.approx(_moments(face)[1])  # CCF is not rotatable (NIST)


@pytest.mark.parametrize("k", [2, 3, 4])
def test_orthogonal_ccd_has_uncorrelated_quadratic_columns(k: int) -> None:
    x = doe.central_composite(k, "orthogonal", center_points=4).coded
    sq = x**2 - (x**2).mean(axis=0)
    gram = sq.T @ sq
    assert np.allclose(gram - np.diag(np.diag(gram)), 0, atol=1e-9)
    assert abs(float(np.sum(x[:, 0] * x[:, 1]))) < 1e-9


def test_ccd_options_and_refusals() -> None:
    assert doe.central_composite(3, 1.5).alpha == 1.5
    for bad in (0.0, -1.0, 11.0, "bogus", True):
        with pytest.raises(ValueError):
            doe.central_composite(3, bad)  # type: ignore[arg-type]
    with pytest.raises(ValueError):
        doe.central_composite(4, fractional=True)
    with pytest.raises(ValueError):
        doe.central_composite(3, center_points=0)
    with pytest.raises(ValueError, match="Box-Behnken"):
        doe.box_behnken(6)
    assert doe.central_composite(3).terms[-3:] == ((0, 0), (1, 1), (2, 2))
    assert len(doe.box_behnken(3).terms) == 9


def test_worksheet_random_order_seed_and_layout() -> None:
    d = doe.full_factorial(3)
    f = [
        FactorSetting("T", 100, 200, "C"),
        FactorSetting("P", 1, 3, "atm"),
        FactorSetting("t", 5, 15, "min"),
    ]
    std = build_worksheet(d, f, "Yield")
    assert std.labels[:2] == ("StdOrder", "PointType") and std.labels[-1] == "Yield"
    assert std.time.tolist() == list(range(1, 9)) and std.values[:, 0].tolist() == list(range(1, 9))
    assert np.isnan(std.values[:, -1]).all()
    assert std.units[5:8] == ("C", "atm", "min")
    a = build_worksheet(d, f, "Yield", randomize=True, seed=7)
    b = build_worksheet(d, f, "Yield", randomize=True, seed=7)
    assert np.array_equal(a.values[:, :-1], b.values[:, :-1])
    assert sorted(a.values[:, 0]) == list(range(1, 9)) and a.values[:, 0].tolist() != list(
        range(1, 9)
    )
    # coded and actual columns agree row by row: actual = 150 + 50 * coded
    assert np.allclose(a.values[:, 5], 150 + 50 * a.values[:, 2])
    meta = a.metadata["doe"]
    assert meta["seed"] == 7 and meta["randomized"] is True
    assert meta["factors"][0]["coded_label"] == "T (coded)" and meta["terms"][0] == ["T"]
    assert build_worksheet(d, f, randomize=True).metadata["doe"]["seed"] is not None
    assert std.metadata["doe"]["seed"] is None and std.metadata["x_column_name"] == "Run"
    # the same standard-order run keeps its settings whatever the run order
    order = a.values[:, 0].astype(int) - 1
    assert np.allclose(a.values[:, 2:5], d.coded[order])


def test_worksheet_refusals() -> None:
    d = doe.full_factorial(2)
    with pytest.raises(ValueError):
        build_worksheet(d, [FactorSetting("A")], "Y")
    with pytest.raises(ValueError, match="unique"):
        build_worksheet(d, [FactorSetting("A"), FactorSetting("A")], "Y")
    with pytest.raises(ValueError, match="different"):
        build_worksheet(d, [FactorSetting("A", 1, 1), FactorSetting("B")], "Y")
    with pytest.raises(ValueError, match="seed"):
        build_worksheet(d, [FactorSetting("A"), FactorSetting("B")], "Y", randomize=True, seed=-1)


# Montgomery, Design and Analysis of Experiments, ex. 6.2 (2^4 filtration rate), standard order.
FILTRATION = [45, 71, 48, 65, 68, 60, 80, 65, 43, 100, 45, 104, 75, 86, 70, 96]
PUBLISHED = {"A": 21.625, "B": 3.125, "C": 9.875, "D": 14.625, "A*C": -18.125, "A*D": 16.625,
             "A*B": 0.125, "B*C": 2.375, "B*D": -0.375, "C*D": -1.125}  # fmt: skip


def test_effects_match_montgomery_filtration_example() -> None:
    x = doe.full_factorial(4).coded
    cols = {n: x[:, i].tolist() for i, n in enumerate("ABCD")}
    terms = [[n] for n in "ABCD"] + [list(c) for c in combinations("ABCD", 2)]
    terms += [list(c) for c in combinations("ABCD", 3)] + [list("ABCD")]
    out = effects(cols, [float(v) for v in FILTRATION], terms)
    got = {r["term"]: r["effect"] for r in out["effects"]}  # type: ignore[attr-defined]
    for name, val in PUBLISHED.items():
        assert got[name] == pytest.approx(val)
    assert out["pse"] == pytest.approx(2.625)  # Lenth: hand computed from the 15 published effects
    sig = {r["term"] for r in out["effects"] if r["significant"]}  # type: ignore[attr-defined]
    assert {"A", "A*C", "A*D"} <= sig and "B" not in sig
    # effect = 2 x regression coefficient on coded columns (OLS oracle)
    xm = np.column_stack(
        [np.ones(16), x[:, 0], x[:, 2], x[:, 3], x[:, 0] * x[:, 2], x[:, 0] * x[:, 3]]
    )
    coef = np.linalg.lstsq(xm, np.array(FILTRATION, float), rcond=None)[0]
    assert 2 * coef[1] == pytest.approx(got["A"]) and 2 * coef[5] == pytest.approx(got["A*D"])
    q = [r["half_normal_q"] for r in sorted(out["effects"], key=lambda r: r["abs_effect"])]  # type: ignore[attr-defined,index]
    assert q == sorted(q) and q[0] > 0


def test_effects_refusals() -> None:
    x = doe.full_factorial(2).coded
    cols = {"A": x[:, 0].tolist(), "B": x[:, 1].tolist()}
    x3 = doe.full_factorial(3).coded
    c3 = {"A": x3[:, 0].tolist(), "B": x3[:, 1].tolist()}
    with pytest.raises(ValueError, match="unbalanced"):
        effects(c3, [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, None], [["A"]])
    with pytest.raises(ValueError, match="at least 4"):
        effects(cols, [1.0, None, None, None], [["A"]])
    with pytest.raises(ValueError, match="unknown factor"):
        effects(cols, [1.0, 2.0, 3.0, 4.0], [["Z"]])
    with pytest.raises(ValueError, match="no effects"):
        effects(cols, [1.0, 2.0, 3.0, 4.0], [])
    out = effects(cols, [1.0, 2.0, 3.0, 4.0], [["A"], ["B"]])
    assert out["pse"] is None  # fewer than 3 effects: no Lenth estimate


def _fit_design(d: doe.Design, y: np.ndarray) -> dict[str, object]:
    from quantized.calc.stats_linear_model import fit_linear_model

    names = [f"X{i + 1}" for i in range(d.k)]
    factors = [
        {"name": n, "kind": "continuous", "values": d.coded[:, i].tolist()}
        for i, n in enumerate(names)
    ]
    terms = [[names[i] for i in t] for t in d.terms]
    return fit_linear_model(y.tolist(), factors, terms, center_polynomials=False)


def test_two_level_design_recovers_synthetic_model_through_fit_model() -> None:
    """Generate -> fill responses -> Fit Model (the 'Analyze design' path): the
    estimates are the true coefficients (raw products, coded columns)."""
    d = doe.full_factorial(3, replicates=2)
    x = d.coded
    y = 10 + 3 * x[:, 0] - 2 * x[:, 1] + 1.5 * x[:, 0] * x[:, 2] + np.tile([0.01, -0.01], 8)
    fit = _fit_design(d, y)
    est = {r["term"]: r["estimate"] for r in fit["parameter_estimates"]}  # type: ignore[attr-defined]
    assert est["Intercept"] == pytest.approx(10, abs=0.02)
    assert est["X1"] == pytest.approx(3, abs=0.02) and est["X2"] == pytest.approx(-2, abs=0.02)
    assert est["X1*X3"] == pytest.approx(1.5, abs=0.02)


def test_ccd_and_box_behnken_recover_synthetic_quadratic_through_fit_model() -> None:
    for d in (
        doe.central_composite(3),
        doe.box_behnken(3),
        doe.central_composite(3, "face_centered"),
    ):
        x = d.coded
        y = (
            5
            + 2 * x[:, 0]
            - x[:, 1]
            + 0.5 * x[:, 0] * x[:, 1]
            - 1.5 * x[:, 2] ** 2
            + 0.7 * x[:, 0] ** 2
        )
        y = y + np.resize([0.02, -0.02, 0.01], len(y))  # noise so the error df is not exactly 0 SS
        fit = _fit_design(d, y)
        est = {r["term"]: r["estimate"] for r in fit["parameter_estimates"]}  # type: ignore[attr-defined]
        assert est["X1"] == pytest.approx(2, abs=0.05) and est["X2"] == pytest.approx(-1, abs=0.05)
        assert est["X3*X3"] == pytest.approx(-1.5, abs=0.05)
        assert est["X1*X1"] == pytest.approx(0.7, abs=0.05)


def test_fractional_estimable_model_fits_and_saturated_one_has_no_error_df() -> None:
    d = doe.fractional_factorial(5, 1, replicates=2)  # res V, all 15 terms, replicated
    x = d.coded
    y = 1 + 4 * x[:, 3] + 2 * x[:, 0] * x[:, 4] + np.tile([0.1, -0.1], 16)
    est = {r["term"]: r["estimate"] for r in _fit_design(d, y)["parameter_estimates"]}  # type: ignore[attr-defined]
    assert est["X4"] == pytest.approx(4, abs=0.05) and est["X1*X5"] == pytest.approx(2, abs=0.05)
    sat = doe.fractional_factorial(7, 4)
    assert sat.n_runs - 1 - len(sat.terms) == 0  # saturated: use the effects plot instead

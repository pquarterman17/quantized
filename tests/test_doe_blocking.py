"""Blocking of 2-level factorials (calc/doe_block.py). Oracles are ALGEBRAIC: the
block label of a run is the sign pattern of the generator words' column
products, so (a) every confounded effect's contrast is constant inside each
block, (b) every unconfounded effect's contrast sums to zero inside each block
(blocks are orthogonal to it), and (c) the chosen standard generators maximise
the lowest confounded order over ALL independent generator sets, found here by
brute force. No generator table is used."""

from __future__ import annotations

from itertools import combinations

import numpy as np
import pytest

from quantized.calc import doe
from quantized.calc import doe_alias as al
from quantized.calc.doe_block import apply_blocking, parse_word, relation_masks
from quantized.calc.doe_sheet import FactorSetting, build_worksheet
from quantized.calc.stats_linear_model import fit_linear_model


def _col(d: doe.Design, mask: int) -> np.ndarray:
    cols = [j for j in range(d.k) if mask >> j & 1]
    return np.prod(d.coded[:, cols], axis=1)


def _check_algebra(d: doe.Design) -> None:
    k = d.k
    rel = [0, *relation_masks(d)]
    words = [parse_word(w, k) for w in d.block_generators]
    group = {0}
    for w in words:
        group |= {g ^ w for g in group}
    group.discard(0)
    conf = {m ^ g for m in group for g in rel}
    block = np.asarray(d.block)
    n_blocks = 2 ** len(words)
    assert sorted(set(block.tolist())) == list(range(1, n_blocks + 1))
    sizes = [int((block == b).sum()) for b in range(1, n_blocks + 1)]
    assert len(set(sizes)) == 1  # no centre points here: equal blocks
    for mask in range(1, 2**k):
        if mask in rel:  # a word of the defining relation is the constant column
            continue
        c = _col(d, mask)
        for b in range(1, n_blocks + 1):
            inside = c[block == b]
            if mask in conf:
                assert np.all(inside == inside[0]), f"confounded {mask:b} not constant in block {b}"
            else:
                assert inside.sum() == 0, f"effect {mask:b} not orthogonal to block {b}"
    # block dummies are orthogonal to every estimable (unconfounded) model column
    for t in d.terms:
        c = np.prod(d.coded[:, list(t)], axis=1)
        for b in range(1, n_blocks + 1):
            assert c[block == b].sum() == 0


@pytest.mark.parametrize(
    ("k", "bits"), [(3, 1), (3, 2), (4, 1), (4, 2), (4, 3), (5, 1), (5, 2), (5, 3), (6, 2), (6, 3)]
)
def test_full_factorial_blocks_are_orthogonal_to_unconfounded_effects(k: int, bits: int) -> None:
    d = apply_blocking(doe.full_factorial(k), bits)
    _check_algebra(d)
    assert len(d.confounded) == 2**bits - 1


@pytest.mark.parametrize(
    ("k", "p", "bits"), [(5, 1, 1), (6, 2, 1), (7, 3, 1), (6, 1, 2), (8, 4, 1)]
)
def test_fraction_blocks_are_orthogonal(k: int, p: int, bits: int) -> None:
    d = apply_blocking(doe.fractional_factorial(k, p), bits)
    _check_algebra(d)
    assert len(d.terms) <= len(doe.fractional_factorial(k, p).terms)


def _min_orders(words: tuple[int, ...], rel: list[int]) -> list[int]:
    group = {0}
    for w in words:
        group |= {g ^ w for g in group}
    group.discard(0)
    return sorted(min((m ^ g).bit_count() for g in rel) for m in group)


def _brute_best(k: int, bits: int, rel: list[int]) -> int:
    """Largest achievable lowest confounded order over every independent word set."""
    best = 0
    masks = range(1, 2**k)
    for words in combinations(masks, bits):
        group = {0}
        for w in words:
            group |= {g ^ w for g in group}
        if len(group) != 2**bits:
            continue
        if any(any((m ^ g) == 0 for g in rel) for m in group if m):
            continue
        best = max(best, _min_orders(words, rel)[0])
    return best


@pytest.mark.parametrize(("k", "bits"), [(3, 1), (4, 2), (5, 2), (5, 3), (6, 2)])
def test_standard_generators_maximise_lowest_confounded_order(k: int, bits: int) -> None:
    d = apply_blocking(doe.full_factorial(k), bits)
    words = tuple(parse_word(w, k) for w in d.block_generators)
    assert _min_orders(words, [0])[0] == _brute_best(k, bits, [0])


@pytest.mark.parametrize(("k", "p"), [(5, 1), (6, 2), (7, 3)])
def test_standard_generators_for_a_fraction_are_optimal(k: int, p: int) -> None:
    base = doe.fractional_factorial(k, p)
    d = apply_blocking(base, 1)
    rel = [0, *relation_masks(base)]
    words = tuple(parse_word(w, k) for w in d.block_generators)
    assert _min_orders(words, rel)[0] == _brute_best(k, 1, rel)


def test_three_factors_two_blocks_is_the_abc_split() -> None:
    d = apply_blocking(doe.full_factorial(3), 1)
    assert d.block_generators == ("ABC",) and d.confounded == ("ABC",)
    x = d.coded
    block = np.asarray(d.block)
    # ABC = +1 for a, b, c, abc (one or three plus signs); -1 for (1), ab, ac, bc
    plus = (x > 0).sum(axis=1) % 2 == 1
    assert np.all(block[plus] == 2) and np.all(block[~plus] == 1)
    assert len(d.terms) == 6  # 3 mains + 3 two-factor interactions remain


def test_user_generators_and_reported_confounding() -> None:
    d = apply_blocking(doe.full_factorial(4), 2, ["ABC", "BCD"])
    assert d.block_generators == ("ABC", "BCD")
    assert set(d.confounded) == {"ABC", "BCD", "AD"}  # the generalised interaction
    _check_algebra(d)
    d2 = apply_blocking(doe.fractional_factorial(5, 1), 1, ["ABC"])
    assert d2.confounded == ("DE = ABC",)  # I = ABCDE aliases ABC with DE


@pytest.mark.parametrize(
    ("design", "bits", "gens", "msg"),
    [
        (doe.full_factorial(4), 1, ["A"], "main effect"),
        (doe.full_factorial(4), 2, ["AB", "AB"], "independent"),
        (doe.full_factorial(4), 2, ["ABC"], "need 2 generators"),
        (doe.full_factorial(4), 1, ["ABE"], "not a factor"),
        (doe.full_factorial(4), 1, ["AAB"], "repeats"),
        (doe.full_factorial(4), 1, [""], "at least one"),
        (doe.full_factorial(3), 3, None, "fewer than 2 runs"),
        (doe.full_factorial(4), 5, None, "number of blocks"),
        (doe.fractional_factorial(4, 1), 1, ["ABCD"], "defining relation"),
        (doe.fractional_factorial(7, 4), 1, ["AB"], "main effect"),  # AB = D in 2^(7-4)
        (doe.plackett_burman(12, 5), 1, None, "factorial"),
        (doe.central_composite(3), 1, None, "factorial"),
    ],
)
def test_blocking_refuses_bad_choices(
    design: doe.Design, bits: int, gens: list[str] | None, msg: str
) -> None:
    with pytest.raises(ValueError, match=msg):
        apply_blocking(design, bits, gens)


def test_replicates_and_centre_points() -> None:
    base = doe.full_factorial(3, replicates=2, center_points=3)
    d = apply_blocking(base, 1)
    block = np.asarray(d.block)
    centre = np.array([t == doe.CENTER for t in d.point_type])
    assert sorted(block[centre].tolist()) == [1, 1, 2]  # spread over the blocks
    fac = ~centre
    assert (block[fac] == 1).sum() == (block[fac] == 2).sum() == 8
    # centre rows are 0 in every effect column, so orthogonality to blocks still holds
    for t in d.terms:
        c = np.prod(d.coded[:, list(t)], axis=1)
        assert c[block == 1].sum() == 0 and c[block == 2].sum() == 0


def _sheet(d: doe.Design, **kw: object):  # type: ignore[no-untyped-def]
    return build_worksheet(d, [FactorSetting(c, -1, 1) for c in "ABCD"[: d.k]], "Y", **kw)  # type: ignore[arg-type]


def test_worksheet_has_block_column_and_metadata() -> None:
    d = apply_blocking(doe.full_factorial(3), 1)
    ds = _sheet(d)
    assert list(ds.labels[:3]) == ["StdOrder", "PointType", "Block"]
    assert ds.cat_levels[2] == ("1", "2")
    assert list(ds.values[:, 2]) == [b - 1 for b in d.block]  # 0-based level codes
    meta = ds.metadata["doe"]
    assert meta["block_label"] == "Block" and meta["blocks"] == 2
    assert meta["confounded"] == ["ABC"] and meta["block_generators"] == ["ABC"]
    assert meta["error_df"] == 8 - 1 - 6 - 1  # intercept, 6 terms, 1 block df
    # coded columns follow the Block column; terms point at them
    assert meta["terms_coded"][0] == ["A (coded)"] and ds.labels[3] == "A (coded)"


def test_unblocked_worksheet_is_unchanged() -> None:
    ds = _sheet(doe.full_factorial(3))
    assert "Block" not in ds.labels and ds.metadata["doe"]["block_label"] is None
    assert ds.metadata["doe"]["blocks"] == 0 and ds.labels[2] == "A (coded)"


def test_randomised_blocked_sheet_keeps_blocks_together_and_reproduces() -> None:
    d = apply_blocking(doe.full_factorial(4), 2)
    a = _sheet(d, randomize=True, seed=7)
    b = _sheet(d, randomize=True, seed=7)
    np.testing.assert_array_equal(a.values, b.values)
    blk = a.values[:, 2]
    assert list(blk) == sorted(blk)  # blocks in sequence
    assert sorted(a.values[:, 0]) == list(range(1, 17))  # StdOrder is a permutation
    assert not np.array_equal(a.values[:, 0], np.arange(1, 17))  # and it was shuffled


def test_block_as_fixed_effect_recovers_effects_and_block_shift() -> None:
    """Analysis with Block as a nominal fixed effect: the true model (with a block
    shift) is recovered exactly; without Block the shift lands in the error."""
    d = apply_blocking(doe.full_factorial(4, replicates=2), 2)
    x, blk = d.coded, np.asarray(d.block)
    shift = np.array([0.0, 5.0, -3.0, 2.0])[blk - 1]
    y = 10 + 3 * x[:, 0] - 2 * x[:, 1] + 1.5 * x[:, 0] * x[:, 2] + shift
    names = ["A", "B", "C", "D"]
    factors = [
        {"name": n, "kind": "continuous", "values": x[:, i].tolist()} for i, n in enumerate(names)
    ]
    terms = [[names[i] for i in t] for t in d.terms]
    with_block = fit_linear_model(
        y.tolist(),
        [*factors, {"name": "Block", "kind": "nominal", "values": [str(b) for b in blk]}],
        [*terms, ["Block"]],
        center_polynomials=False,
    )
    est = {r["term"]: r["estimate"] for r in with_block["parameter_estimates"]}
    assert est["A"] == pytest.approx(3, abs=1e-9) and est["B"] == pytest.approx(-2, abs=1e-9)
    assert est["A*C"] == pytest.approx(1.5, abs=1e-9)
    err = {r["source"]: r for r in with_block["anova"]}["Error"]
    assert err["df"] == 32 - 1 - len(terms) - 3
    without = fit_linear_model(y.tolist(), factors, terms, center_polynomials=False)
    sse = {r["source"]: r["ss"] for r in with_block["anova"]}["Error"]
    sse0 = {r["source"]: r["ss"] for r in without["anova"]}["Error"]
    assert sse == pytest.approx(0, abs=1e-8) and sse0 > 1.0


def test_alias_class_helper_agrees_with_confounded_report() -> None:
    base = doe.fractional_factorial(6, 2)
    d = apply_blocking(base, 1, ["ABD"])
    k, rel = 6, relation_masks(base)
    expect = " = ".join(
        al.effect_label(m, k)
        for m in sorted(
            {parse_word("ABD", k) ^ g for g in [0, *rel]}, key=lambda m: (m.bit_count(), m)
        )
    )
    assert d.confounded == (expect,)

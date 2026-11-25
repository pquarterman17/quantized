"""Design of experiments: design generation (GAP_AUDIT_9 J16, JMP DOE / Minitab
Create Factorial Design / Origin DOE).

Pure numpy. Every function returns a :class:`Design` in STANDARD order with
CODED factor levels (-1 / 0 / +1, star points at +-alpha). Turning a design
into a worksheet (actual units, run order, randomisation) is
:mod:`quantized.calc.doe_sheet`; the published tables are in
:mod:`quantized.calc.doe_tables`, the alias algebra in
:mod:`quantized.calc.doe_alias`.

Sources (also cited where used): NIST/SEMATECH e-Handbook of Statistical
Methods section 5.3.3 "How do you select an experimental design?"
(https://www.itl.nist.gov/div898/handbook/pri/section3/pri33.htm); Montgomery,
*Design and Analysis of Experiments*, Wiley; Box, Hunter and Hunter,
*Statistics for Experimenters*, Wiley; Plackett and Burman, Biometrika 33
(1946); Box and Behnken, Technometrics 2 (1960) 455-475.

Standard (Yates) order: the first factor alternates fastest (-,+,-,+...).
Fractional fractions are the PRINCIPAL fraction (every generator sign +).

Choices with no published default are provisional, owner to confirm: the
default number of centre points (NIST Table 3.28 values for response-surface
designs, 0 for screening designs) and the default CCD alpha (rotatable).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from itertools import combinations

import numpy as np
from numpy.typing import NDArray

from quantized.calc import doe_alias as al
from quantized.calc.doe_tables import (
    BB_CENTER_POINTS,
    CCD_CENTER_POINTS,
    CCD_FRACTION_P,
    DEFAULT_CENTER_FALLBACK,
    FRACTIONAL,
    LETTERS,
    PLACKETT_BURMAN_ROWS,
)

MAX_FACTORS = 11  # the NIST table's largest 2^(k-p) with k-p <= 7 (<= 128 runs)
MAX_RUNS = 4096  # refuse anything that would build a larger worksheet

FACTORIAL = "factorial"
AXIAL = "axial"
CENTER = "center"


@dataclass(frozen=True)
class Design:
    """A design in standard order with coded levels."""

    kind: str  # full_factorial | fractional_factorial | plackett_burman | ccd | box_behnken
    k: int
    coded: NDArray[np.float64]  # (n, k)
    point_type: tuple[str, ...]  # FACTORIAL | AXIAL | CENTER per row
    model: str  # "interaction" | "main" | "quadratic": the analysis model
    #: model terms as factor-index tuples, ``(i,)`` main, ``(i, j)`` cross, ``(i, i)`` square.
    terms: tuple[tuple[int, ...], ...]
    resolution: int | None = None
    generators: tuple[str, ...] = ()  # "D = ABC"
    relation: str = ""  # "I = ABCD ..."
    aliases: tuple[tuple[str, ...], ...] = ()
    alpha: float | None = None
    center_points: int = 0
    replicates: int = 1
    notes: tuple[str, ...] = field(default=())
    #: blocking (calc/doe_block.py): block number (1-based) per run, the generator
    #: words and the effect classes confounded with blocks; empty when unblocked.
    block: tuple[int, ...] = ()
    block_generators: tuple[str, ...] = ()
    confounded: tuple[str, ...] = ()
    #: D-optimal designs (calc/doe_optimal.py): D-efficiency in percent and the
    #: number of model parameters (columns of the model matrix, intercept included).
    d_efficiency: float | None = None
    n_params: int | None = None

    @property
    def n_runs(self) -> int:
        return int(self.coded.shape[0])


def _check_k(k: int, lo: int, hi: int, what: str) -> None:
    if not isinstance(k, int) or isinstance(k, bool) or not lo <= k <= hi:
        raise ValueError(f"{what} needs {lo} to {hi} factors (got {k!r})")


def _check_count(v: int, name: str, lo: int) -> None:
    if not isinstance(v, int) or isinstance(v, bool) or v < lo or v > 1000:
        raise ValueError(f"{name} must be a whole number from {lo} to 1000 (got {v!r})")


def _base_matrix(b: int) -> NDArray[np.float64]:
    """Full 2^b factorial in standard order, factor 1 fastest."""
    rows = np.arange(2**b)
    return np.where(rows[:, None] >> np.arange(b)[None, :] & 1, 1.0, -1.0)


def _stack(
    factorial: NDArray[np.float64], k: int, replicates: int, center_points: int
) -> tuple[NDArray[np.float64], tuple[str, ...]]:
    """Replicate the factorial block, then append the centre points."""
    _check_count(replicates, "replicates", 1)
    _check_count(center_points, "center points", 0)
    n = factorial.shape[0] * replicates + center_points
    if n > MAX_RUNS:
        raise ValueError(f"{n} runs exceeds the {MAX_RUNS}-run limit")
    coded = np.vstack([np.tile(factorial, (replicates, 1)), np.zeros((center_points, k))])
    types = (FACTORIAL,) * (factorial.shape[0] * replicates) + (CENTER,) * center_points
    return coded, types


def _main_terms(k: int) -> tuple[tuple[int, ...], ...]:
    return tuple((i,) for i in range(k))


def _mask_terms(masks: list[int], k: int) -> tuple[tuple[int, ...], ...]:
    return tuple(tuple(j for j in range(k) if m >> j & 1) for m in masks)


def full_factorial(k: int, replicates: int = 1, center_points: int = 0) -> Design:
    """2^k full factorial (NIST 5.3.3.3), analysed with main effects and all
    two-factor interactions."""
    _check_k(k, 2, 8, "a 2-level full factorial")
    coded, types = _stack(_base_matrix(k), k, replicates, center_points)
    masks = al.estimable_terms([], k)
    return Design(
        "full_factorial",
        k,
        coded,
        types,
        "interaction",
        _mask_terms(masks, k),
        relation="I",
        aliases=tuple(tuple(c) for c in al.alias_classes([], k)),
        center_points=center_points,
        replicates=replicates,
    )


def available_fractions(k: int) -> list[dict[str, object]]:
    """The published fractions of k factors, largest (fewest aliases) first."""
    out = []
    for (kk, p), (res, gens) in sorted(FRACTIONAL.items(), key=lambda kv: kv[0][1]):
        if kk == k:
            out.append(
                {
                    "p": p,
                    "runs": 2 ** (k - p),
                    "resolution": res,
                    "generators": _gen_text(k, p, gens),
                }
            )
    return out


def _gen_text(k: int, p: int, gens: tuple[tuple[int, ...], ...]) -> list[str]:
    base = k - p
    return [
        f"{LETTERS[base + j]} = {''.join(LETTERS[f - 1] for f in g)}" for j, g in enumerate(gens)
    ]


def _fraction_matrix(
    k: int, p: int
) -> tuple[NDArray[np.float64], int, list[int], tuple[tuple[int, ...], ...]]:
    if (k, p) not in FRACTIONAL:
        have = ", ".join(f"2^({k}-{q})" for q in sorted(q for kk, q in FRACTIONAL if kk == k))
        raise ValueError(
            f"no published 2^({k}-{p}) fraction (NIST e-Handbook Table 3.17); "
            f"{k} factors: {have or 'none (use 3 to 11 factors)'}"
        )
    res, gens = FRACTIONAL[(k, p)]
    base = k - p
    cols = _base_matrix(base)
    extra = [np.prod(cols[:, [f - 1 for f in g]], axis=1) for g in gens]
    return np.column_stack([cols, *extra]), res, al.generator_words(base, gens), gens


def fractional_factorial(k: int, p: int, replicates: int = 1, center_points: int = 0) -> Design:
    """2^(k-p) fraction from the NIST/Montgomery generator table.

    The alias structure (effects up to order 2 shown) and the resolution come
    from the defining relation, not from the table's stated resolution; the
    tests check both against the published values.
    """
    _check_k(k, 3, MAX_FACTORS, "a 2^(k-p) fractional factorial")
    factorial, _stated, words, gens = _fraction_matrix(k, p)
    relation = al.defining_relation(words)
    coded, types = _stack(factorial, k, replicates, center_points)
    res = al.resolution(relation)
    masks = al.estimable_terms(relation, k)
    notes = []
    if res is not None and res <= 3:
        notes.append("Resolution III: main effects are aliased with two-factor interactions.")
    return Design(
        "fractional_factorial",
        k,
        coded,
        types,
        "interaction",
        _mask_terms(masks, k),
        resolution=res,
        generators=tuple(_gen_text(k, p, gens)),
        relation=al.relation_text(relation, k),
        aliases=tuple(tuple(c) for c in al.alias_classes(relation, k)),
        center_points=center_points,
        replicates=replicates,
        notes=tuple(notes),
    )


def plackett_burman(runs: int, k: int, replicates: int = 1, center_points: int = 0) -> Design:
    """Plackett-Burman screening design (12, 20 or 24 runs, up to runs-1 factors).

    Rows are the cyclic shifts of the published generating row, plus a final
    row of minus signs; the first ``k`` columns are used. Main effects only:
    every main effect is partially aliased with two-factor interactions.
    """
    if runs not in PLACKETT_BURMAN_ROWS:
        raise ValueError(
            f"Plackett-Burman designs are offered for {sorted(PLACKETT_BURMAN_ROWS)} "
            f"runs (got {runs!r})"
        )
    _check_k(k, 2, runs - 1, f"a {runs}-run Plackett-Burman design")
    gen = np.array([1.0 if c == "+" else -1.0 for c in PLACKETT_BURMAN_ROWS[runs]])
    rows = [np.roll(gen, i) for i in range(runs - 1)] + [-np.ones(runs - 1)]
    coded, types = _stack(np.array(rows)[:, :k], k, replicates, center_points)
    return Design(
        "plackett_burman",
        k,
        coded,
        types,
        "main",
        _main_terms(k),
        resolution=3,
        center_points=center_points,
        replicates=replicates,
        notes=(
            "Screening design: main effects are partially aliased with two-factor interactions.",
        ),
    )


def default_ccd_center_points(k: int, fractional: bool) -> int:
    """NIST Table 3.28 where tabulated, else 5 (provisional, owner to confirm)."""
    return CCD_CENTER_POINTS.get((k, fractional), DEFAULT_CENTER_FALLBACK)


def default_bb_center_points(k: int) -> int:
    """NIST Table 3.28 (provisional, owner to confirm)."""
    return BB_CENTER_POINTS.get(k, DEFAULT_CENTER_FALLBACK)


def ccd_alpha(choice: str | float, factorial_runs: int, k: int, center_points: int) -> float:
    """Star-point distance for a central composite design.

    * ``rotatable``: ``alpha = F**(1/4)``, F the number of factorial runs (NIST
      5.3.3.6.1; Box and Hunter 1957).
    * ``face_centered``: ``alpha = 1`` (CCF).
    * ``orthogonal``: the quadratic columns are uncorrelated:
      ``alpha = sqrt((sqrt(F*N) - F) / 2)``, N the total run count (Myers,
      Montgomery and Anderson-Cook, *Response Surface Methodology*).
    * a number: used as given (``0 < alpha <= 10``).
    """
    f = float(factorial_runs)
    if isinstance(choice, bool):
        raise ValueError("alpha must be a choice name or a number")
    if isinstance(choice, int | float):
        a = float(choice)
        if not 0.0 < a <= 10.0 or not np.isfinite(a):
            raise ValueError("custom alpha must be a number in (0, 10]")
        return a
    if choice == "rotatable":
        return float(f**0.25)
    if choice == "face_centered":
        return 1.0
    if choice == "orthogonal":
        n = f + 2 * k + center_points
        return float(np.sqrt((np.sqrt(f * n) - f) / 2.0))
    raise ValueError(
        f"unknown alpha choice {choice!r} (rotatable, face_centered, orthogonal or a number)"
    )


def central_composite(
    k: int,
    alpha: str | float = "rotatable",
    center_points: int | None = None,
    fractional: bool = False,
    inscribed: bool = False,
) -> Design:
    """Central composite design (NIST 5.3.3.6.1): factorial portion + 2k star
    points + centre points. ``inscribed`` scales every coordinate by 1/alpha so
    the star points sit at +-1 (CCI). ``fractional`` uses the resolution V (or
    better) fraction of the factorial portion (k = 5..8)."""
    _check_k(k, 2, 8, "a central composite design")
    gen_text: tuple[str, ...] = ()
    relation = ""
    res: int | None = None
    if fractional:
        if k not in CCD_FRACTION_P:
            raise ValueError(
                "a fractional factorial portion needs 5 to 8 factors "
                "(k = 5..8 have a resolution V fraction)"
            )
        factorial, res, words, gens = _fraction_matrix(k, CCD_FRACTION_P[k])
        gen_text = tuple(_gen_text(k, CCD_FRACTION_P[k], gens))
        relation = al.relation_text(al.defining_relation(words), k)
    else:
        factorial = _base_matrix(k)
    n0 = default_ccd_center_points(k, fractional) if center_points is None else center_points
    _check_count(n0, "center points", 0)
    if n0 < 1:
        raise ValueError("a central composite design needs at least 1 centre point")
    f = factorial.shape[0]
    a = ccd_alpha(alpha, f, k, n0)
    axial = np.zeros((2 * k, k))
    for j in range(k):
        axial[2 * j, j], axial[2 * j + 1, j] = -a, a
    coded = np.vstack([factorial, axial, np.zeros((n0, k))])
    if coded.shape[0] > MAX_RUNS:
        raise ValueError(f"{coded.shape[0]} runs exceeds the {MAX_RUNS}-run limit")
    if inscribed:
        coded = coded / a
    types = (FACTORIAL,) * f + (AXIAL,) * (2 * k) + (CENTER,) * n0
    squares = [(i, i) for i in range(k)]
    terms = (*_main_terms(k), *combinations(range(k), 2), *squares)
    notes = [
        f"alpha = {a:.6g}" + (" (inscribed: all levels divided by alpha)" if inscribed else "")
    ]
    return Design(
        "ccd",
        k,
        coded,
        types,
        "quadratic",
        tuple(terms),
        resolution=res,
        generators=gen_text,
        relation=relation,
        alpha=a,
        center_points=n0,
        notes=tuple(notes),
    )


def box_behnken(k: int, center_points: int | None = None) -> Design:
    """Box-Behnken design (Box and Behnken 1960; NIST 5.3.3.6.2) for 3 to 5
    factors: every pair of factors takes the 2^2 factorial with the others at
    their centre, plus centre points. Six and seven factors need the published
    incomplete-block layouts and are not offered (use a CCD)."""
    _check_k(
        k,
        3,
        5,
        "a Box-Behnken design (6 and 7 factors are not offered; use a central composite design)",
    )
    n0 = default_bb_center_points(k) if center_points is None else center_points
    _check_count(n0, "center points", 0)
    if n0 < 1:
        raise ValueError("a Box-Behnken design needs at least 1 centre point")
    rows: list[list[float]] = []
    for i, j in combinations(range(k), 2):
        for b in (1, 2, 3, 4):
            r = [0.0] * k
            r[i] = 1.0 if (b - 1) & 1 else -1.0
            r[j] = 1.0 if (b - 1) & 2 else -1.0
            rows.append(r)
    n_edge = len(rows)
    coded = np.vstack([np.array(rows), np.zeros((n0, k))])
    types = (FACTORIAL,) * n_edge + (CENTER,) * n0
    terms = (*_main_terms(k), *combinations(range(k), 2), *[(i, i) for i in range(k)])
    return Design("box_behnken", k, coded, types, "quadratic", tuple(terms), center_points=n0)

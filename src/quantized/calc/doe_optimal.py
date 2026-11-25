"""D-optimal designs by exchange algorithms (GAP_AUDIT_9 J16 leftover).

Pure numpy. Choose ``N`` runs that maximise ``det(X'X)`` for a chosen model:

* ``coordinate``: coordinate exchange (Meyer and Nachtsheim, "The coordinate-
  exchange algorithm for constructing exact optimal experimental designs",
  Technometrics 37(1) (1995) 60-69): cycle over every run and factor, setting
  that one coordinate to the level of the factor's grid that maximises the
  determinant, until no coordinate improves; random starts.
* ``fedorov``: single-point exchange on an explicit candidate set (Fedorov,
  *Theory of Optimal Experiments*, Academic Press, 1972): swap a design row
  for the candidate that most increases the determinant; random starts.

The determinant after swapping row ``x`` for ``z`` is evaluated exactly for
every trial (batched ``slogdet`` of ``X'X - x x' + z z'``), so singular
intermediate designs are handled without a ridge. A fixed seed makes a run
reproducible (default seed 0, recorded).

Coding: a continuous factor is coded to [-1, 1] over its (low, high); a
categorical factor with ``L`` levels uses ``L-1`` effect-coded columns (last
level = -1 in all of them). Model: ``main`` (intercept + main effects),
``interaction`` (+ all two-factor products) or ``quadratic`` (+ squares of the
continuous factors).

D-efficiency = ``100 * det(X'X)**(1/p) / N`` (p = columns of the model matrix),
the usual normalisation: it is 100 for an orthogonal design of +-1 columns
(Hadamard's inequality bounds ``det(X'X) <= N**p`` for entries in [-1, 1]).
For quadratic or categorical models the 100 % ceiling is not attainable, so
compare efficiencies of designs of the same model, not across models.

Provisional, owner to confirm: grid of 2 levels per continuous factor (3 for
the quadratic model), 10 random starts, N <= 500, candidate set <= 20000 rows.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from itertools import combinations, product

import numpy as np
from numpy.typing import NDArray

from quantized.calc.doe import FACTORIAL, Design

MAX_RUNS_OPT = 500
MAX_CANDIDATES = 20000
MODELS = ("main", "interaction", "quadratic")
METHODS = ("coordinate", "fedorov")
_TOL = 1e-10


@dataclass(frozen=True)
class OptFactor:
    name: str
    low: float = -1.0
    high: float = 1.0
    levels: tuple[str, ...] = ()  # non-empty = categorical

    @property
    def categorical(self) -> bool:
        return bool(self.levels)


@dataclass(frozen=True)
class DOptimalResult:
    design: Design
    d_efficiency: float  # percent
    log_det: float
    n_params: int
    method: str
    seed: int
    starts: int


def model_terms(k: int, factors: Sequence[OptFactor], model: str) -> tuple[tuple[int, ...], ...]:
    if model not in MODELS:
        raise ValueError(f"unknown model {model!r} ({', '.join(MODELS)})")
    terms: list[tuple[int, ...]] = [(i,) for i in range(k)]
    if model in ("interaction", "quadratic"):
        terms += list(combinations(range(k), 2))
    if model == "quadratic":
        terms += [(i, i) for i in range(k) if not factors[i].categorical]
    return tuple(terms)


def _factor_columns(f: OptFactor, v: NDArray[np.float64]) -> NDArray[np.float64]:
    if not f.categorical:
        return v[:, None]
    idx = v.astype(int)
    n_lv = len(f.levels)
    out = np.zeros((len(v), n_lv - 1))
    for lv in range(n_lv - 1):
        out[idx == lv, lv] = 1.0
    out[idx == n_lv - 1, :] = -1.0
    return out


def model_matrix(
    coded: NDArray[np.float64], factors: Sequence[OptFactor], terms: Sequence[tuple[int, ...]]
) -> NDArray[np.float64]:
    """Intercept + one block of columns per term (products of the factors' columns)."""
    cols = [_factor_columns(f, coded[:, j]) for j, f in enumerate(factors)]
    blocks = [np.ones((coded.shape[0], 1))]
    for t in terms:
        if len(t) == 2 and t[0] == t[1]:
            blocks.append(cols[t[0]] ** 2)
            continue
        acc = cols[t[0]]
        for j in t[1:]:
            acc = (acc[:, :, None] * cols[j][:, None, :]).reshape(acc.shape[0], -1)
        blocks.append(acc)
    return np.hstack(blocks)


def _grid(f: OptFactor, n_levels: int) -> NDArray[np.float64]:
    if f.categorical:
        return np.arange(len(f.levels), dtype=float)
    return np.linspace(-1.0, 1.0, n_levels)


def _logdet(m: NDArray[np.float64]) -> float:
    sign, ld = np.linalg.slogdet(m)
    return float(ld) if sign > 0 and np.isfinite(ld) else -np.inf


def _trial_logdets(m0: NDArray[np.float64], z: NDArray[np.float64]) -> NDArray[np.float64]:
    """log det(M0 + z z') for every row z (batched); non-positive-definite -> -inf."""
    sign, ld = np.linalg.slogdet(m0[None] + z[:, :, None] * z[:, None, :])
    return np.where((sign > 0) & np.isfinite(ld), ld, -np.inf)


def _validate(
    factors: Sequence[OptFactor], model: str, n_runs: int, method: str, grid_levels: int | None
) -> tuple[tuple[tuple[int, ...], ...], int, int]:
    k = len(factors)
    if not 1 <= k <= 12:
        raise ValueError("D-optimal designs take 1 to 12 factors")
    if method not in METHODS:
        raise ValueError(f"unknown method {method!r} ({', '.join(METHODS)})")
    terms = model_terms(k, factors, model)
    p = model_matrix(np.zeros((1, k)), factors, terms).shape[1]
    if isinstance(n_runs, bool) or not isinstance(n_runs, int) or not p <= n_runs <= MAX_RUNS_OPT:
        raise ValueError(
            f"this model has {p} parameters: runs must be a whole number from {p} to {MAX_RUNS_OPT}"
        )
    for f in factors:
        if f.categorical:
            if len(set(f.levels)) != len(f.levels) or len(f.levels) < 2:
                raise ValueError(f"factor {f.name!r}: needs two or more different levels")
        elif not (np.isfinite(f.low) and np.isfinite(f.high)) or f.low == f.high:
            raise ValueError(f"factor {f.name!r}: low and high must be different finite numbers")
    n_lv = grid_levels if grid_levels is not None else (3 if model == "quadratic" else 2)
    if isinstance(n_lv, bool) or not isinstance(n_lv, int) or not 2 <= n_lv <= 9:
        raise ValueError("levels per continuous factor must be a whole number from 2 to 9")
    if model == "quadratic" and n_lv < 3 and any(not f.categorical for f in factors):
        raise ValueError("the quadratic model needs at least 3 levels per continuous factor")
    return terms, p, n_lv


def candidate_grid(factors: Sequence[OptFactor], n_levels: int) -> NDArray[np.float64]:
    grids = [_grid(f, n_levels) for f in factors]
    size = int(np.prod([len(g) for g in grids]))
    if size > MAX_CANDIDATES:
        raise ValueError(
            f"the candidate grid has {size} points (limit {MAX_CANDIDATES}); use fewer levels, "
            "or coordinate exchange"
        )
    return np.array(list(product(*grids)), dtype=float)


def candidates_from_rows(
    factors: Sequence[OptFactor], rows: Sequence[Sequence[float | str]]
) -> NDArray[np.float64]:
    """A user candidate set in ACTUAL units (continuous numbers, categorical level
    names) -> coded rows. Values outside a factor's (low, high) are refused."""
    if not rows:
        raise ValueError("the candidate set is empty")
    if len(rows) > MAX_CANDIDATES:
        raise ValueError(f"the candidate set has {len(rows)} rows (limit {MAX_CANDIDATES})")
    out = np.zeros((len(rows), len(factors)))
    for r, row in enumerate(rows):
        if len(row) != len(factors):
            raise ValueError(
                f"candidate row {r + 1} has {len(row)} values for {len(factors)} factors"
            )
        for j, f in enumerate(factors):
            v = row[j]
            if f.categorical:
                if v not in f.levels:
                    raise ValueError(f"candidate row {r + 1}: {v!r} is not a level of {f.name!r}")
                out[r, j] = f.levels.index(str(v))
                continue
            if isinstance(v, str | bool) or not np.isfinite(float(v)):
                raise ValueError(f"candidate row {r + 1}: {f.name!r} needs a finite number")
            lo, hi = min(f.low, f.high), max(f.low, f.high)
            if not lo <= float(v) <= hi:
                raise ValueError(f"candidate row {r + 1}: {f.name}={v} is outside [{lo}, {hi}]")
            out[r, j] = (2.0 * float(v) - (f.low + f.high)) / (f.high - f.low)
    return np.unique(out, axis=0)


def _random_start(
    draw: Callable[[int], NDArray[np.float64]],
    factors: Sequence[OptFactor],
    terms: Sequence[tuple[int, ...]],
    n: int,
) -> NDArray[np.float64] | None:
    for _ in range(500):
        d = draw(n)
        x = model_matrix(d, factors, terms)
        if np.isfinite(_logdet(x.T @ x)):
            return d
    return None


def _coordinate(
    d: NDArray[np.float64],
    factors: Sequence[OptFactor],
    terms: Sequence[tuple[int, ...]],
    levels: list[NDArray[np.float64]],
) -> NDArray[np.float64]:
    x = model_matrix(d, factors, terms)
    m = x.T @ x
    cur = _logdet(m)
    for _ in range(200):
        improved = False
        for i in range(d.shape[0]):
            for j in range(d.shape[1]):
                lv = levels[j]
                trial = np.tile(d[i], (len(lv), 1))
                trial[:, j] = lv
                z = model_matrix(trial, factors, terms)
                xi = x[i]
                ld = _trial_logdets(m - np.outer(xi, xi), z)
                b = int(np.argmax(ld))
                if ld[b] > cur + _TOL * max(1.0, abs(cur)):
                    d[i, j] = lv[b]
                    x[i] = z[b]
                    m = x.T @ x
                    cur = _logdet(m)
                    improved = True
        if not improved:
            break
    return d


def _fedorov(
    idx: NDArray[np.intp], cand: NDArray[np.float64], xc: NDArray[np.float64]
) -> NDArray[np.intp]:
    x = xc[idx]
    m = x.T @ x
    cur = _logdet(m)
    for _ in range(200):
        improved = False
        for i in range(len(idx)):
            ld = _trial_logdets(m - np.outer(x[i], x[i]), xc)
            b = int(np.argmax(ld))
            if ld[b] > cur + _TOL * max(1.0, abs(cur)):
                idx[i] = b
                x[i] = xc[b]
                m = x.T @ x
                cur = _logdet(m)
                improved = True
        if not improved:
            break
    return idx


def d_optimal(
    factors: Sequence[OptFactor],
    model: str,
    n_runs: int,
    method: str = "coordinate",
    candidates: NDArray[np.float64] | None = None,
    grid_levels: int | None = None,
    starts: int = 10,
    seed: int = 0,
) -> DOptimalResult:
    """The best of ``starts`` random-start exchange runs (see the module doc)."""
    terms, p, n_lv = _validate(factors, model, n_runs, method, grid_levels)
    if isinstance(starts, bool) or not isinstance(starts, int) or not 1 <= starts <= 200:
        raise ValueError("starts must be a whole number from 1 to 200")
    if isinstance(seed, bool) or not isinstance(seed, int) or not 0 <= seed < 2**32:
        raise ValueError("seed must be a whole number from 0 to 4294967295")
    if candidates is not None and method == "coordinate":
        raise ValueError(
            "coordinate exchange does not use a candidate set; choose fedorov for a given one"
        )
    k = len(factors)
    rng = np.random.default_rng(seed)
    best: tuple[float, NDArray[np.float64]] | None = None
    if method == "fedorov":
        cand = candidates if candidates is not None else candidate_grid(factors, n_lv)
        xc = model_matrix(cand, factors, terms)
        if np.linalg.matrix_rank(xc) < p:
            raise ValueError("the candidate set cannot estimate this model (rank-deficient)")
    levels = [_grid(f, n_lv) for f in factors]
    for _ in range(starts):
        if method == "fedorov":
            idx = rng.integers(0, len(cand), size=n_runs)
            for _try in range(500):
                x0 = xc[idx]
                if np.isfinite(_logdet(x0.T @ x0)):
                    break
                idx = rng.integers(0, len(cand), size=n_runs)
            else:
                raise ValueError("could not find a starting design that estimates the model")
            d = cand[_fedorov(idx, cand, xc)]
        else:

            def draw(n: int) -> NDArray[np.float64]:
                return np.column_stack([rng.choice(levels[j], size=n) for j in range(k)])

            d0 = _random_start(draw, factors, terms, n_runs)
            if d0 is None:
                raise ValueError("could not find a starting design that estimates the model")
            d = _coordinate(d0, factors, terms, levels)
        x = model_matrix(d, factors, terms)
        ld = _logdet(x.T @ x)
        if best is None or ld > best[0] + 1e-12:
            best = (ld, d)
    assert best is not None
    ld, d = best
    d = d[np.lexsort(d.T[::-1])]
    eff = float(100.0 * np.exp(ld / p) / n_runs)
    design = Design(
        "d_optimal",
        k,
        d,
        (FACTORIAL,) * n_runs,
        model,
        terms,
        d_efficiency=eff,
        n_params=p,
        notes=(
            f"D-optimal ({method} exchange, seed {seed}, {starts} starts): "
            f"log det(X'X) = {ld:.4f}, p = {p} model parameters; "
            "D-efficiency = 100*det(X'X)^(1/p)/N.",
        ),
    )
    return DOptimalResult(design, eff, ld, p, method, seed, starts)

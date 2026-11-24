"""Model specification and design-matrix coding for Fit Model (GAP_AUDIT_9 G1).

Pure numpy. The fitting and inference live in :mod:`quantized.calc.stats_linear_model`;
this module owns the *coding*: how a model built from columns (continuous and
nominal factors, crossed terms, polynomial terms) becomes a numeric design
matrix, and how the same coding is re-applied to new factor settings so a
fitted model can be evaluated later (``predict``, the G7 profiler).

Coding, chosen to match JMP's Standard Least Squares personality:

* **Nominal factors: effect (sum-to-zero) coding.** A factor with ``k`` levels
  gets ``k - 1`` columns; the column for level ``j`` is 1 at level ``j``,
  -1 at the LAST level and 0 elsewhere. JMP: "the indicator variable for a
  given level assigns the values 1 to that level, -1 to the last level, and 0
  to the remaining levels" (JMP 18.2 Fitting Linear Models, *Statistical
  Details for Nominal Effects Coding*,
  https://www.jmp.com/support/help/en/18.2/jmp/statistical-details-for-nominal-effects-coding.shtml).
  This is statsmodels' ``C(x, Sum)``. Level order is the caller's (the
  worksheet's level order); levels absent from the fitted rows are dropped.
* **Crossed terms** (``A*B``, ``A*X``, ``X*Z``) are the row-wise products of
  their parts' columns (nominal x nominal is the Kronecker product of the two
  codings, ``A[a1]*B[b1]`` ...).
* **Polynomial terms** repeat a continuous factor (``X*X`` is X squared). A
  nominal factor cannot repeat inside a term (refused).
* **Center Polynomials** (JMP's Fit Model option, on by default): a continuous
  factor that takes part in a crossed or polynomial term is centred by its
  mean *inside that term*; its own main-effect column stays raw. JMP:
  "Continuous factors are centered by their mean when they are crossed with
  other factors (interactions and polynomial terms)"
  (https://www.jmp.com/support/help/en/19.0/jmp/continuous-factors.shtml).
  It changes the parameterisation (and the main-effect tests of factors that
  also sit in a crossed term), never the fitted values. ``center=False``
  gives the raw-product parameterisation (statsmodels' ``X*Z`` formula).
* An intercept is always present (JMP's default; a no-intercept model is not
  offered, provisional, owner to confirm).

A "profile" for :func:`design_matrix` maps each factor to per-row values:
continuous -> floats; nominal -> level indices, where ``-1`` means "average
over the levels" (the LS-means neutral value for an uninvolved nominal factor:
the effect-coded row is all zeros, the average of its levels' codes).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

CONTINUOUS = "continuous"
NOMINAL = "nominal"
AVERAGE_LEVEL = -1


@dataclass(frozen=True)
class FactorSpec:
    """One model factor as fitted: its kind, and what the coding needs."""

    name: str
    kind: str  # CONTINUOUS | NOMINAL
    levels: tuple[str, ...] = ()  # nominal: fitted level order (last coded -1)
    mean: float = 0.0  # continuous: centring value over the fitted rows

    def to_dict(self) -> dict[str, object]:
        if self.kind == NOMINAL:
            return {"name": self.name, "kind": self.kind, "levels": list(self.levels)}
        return {"name": self.name, "kind": self.kind, "mean": self.mean}


@dataclass(frozen=True)
class ModelSpec:
    """Factors + terms + coding options: everything needed to rebuild X."""

    factors: tuple[FactorSpec, ...]
    terms: tuple[tuple[str, ...], ...]  # each a factor-name multiset, no intercept
    center: bool = True

    def factor(self, name: str) -> FactorSpec:
        for f in self.factors:
            if f.name == name:
                return f
        raise ValueError(f"unknown factor {name!r}")

    def to_dict(self) -> dict[str, object]:
        return {
            "factors": [f.to_dict() for f in self.factors],
            "terms": [list(t) for t in self.terms],
            "center_polynomials": self.center,
        }


def spec_from_dict(raw: Mapping[str, object]) -> ModelSpec:
    """Inverse of :meth:`ModelSpec.to_dict` (validated: fail closed)."""
    factors_raw = raw.get("factors")
    terms_raw = raw.get("terms")
    if not isinstance(factors_raw, list) or not isinstance(terms_raw, list):
        raise ValueError("model spec needs 'factors' and 'terms' lists")
    factors: list[FactorSpec] = []
    for f in factors_raw:
        if not isinstance(f, Mapping):
            raise ValueError("each factor must be an object")
        kind = f.get("kind")
        name = str(f.get("name"))
        if kind == NOMINAL:
            levels = f.get("levels")
            if not isinstance(levels, list) or len(levels) < 2:
                raise ValueError(f"nominal factor {name!r} needs at least 2 levels")
            factors.append(FactorSpec(name, NOMINAL, tuple(str(v) for v in levels)))
        elif kind == CONTINUOUS:
            mean = f.get("mean", 0.0)
            if not isinstance(mean, int | float):
                raise ValueError(f"continuous factor {name!r} needs a numeric mean")
            factors.append(FactorSpec(name, CONTINUOUS, mean=float(mean)))
        else:
            raise ValueError(f"factor {name!r} has unknown kind {kind!r}")
    terms = tuple(tuple(str(n) for n in t) for t in terms_raw if isinstance(t, list))
    spec = ModelSpec(tuple(factors), terms, bool(raw.get("center_polynomials", True)))
    validate_terms(spec)
    return spec


def term_key(term: Sequence[str]) -> tuple[str, ...]:
    """Order-free identity of a term (``A*B`` == ``B*A``)."""
    return tuple(sorted(term))


def term_label(term: Sequence[str]) -> str:
    return "*".join(term)


def validate_terms(spec: ModelSpec) -> None:
    """Refuse malformed models: empty/duplicate terms, unknown factors, a
    nominal factor repeated inside one term, duplicate factor names."""
    names = [f.name for f in spec.factors]
    if len(set(names)) != len(names):
        raise ValueError("factor names must be unique")
    if not spec.terms:
        raise ValueError("the model has no effects; add at least one term")
    seen: set[tuple[str, ...]] = set()
    for term in spec.terms:
        if not term:
            raise ValueError("a model term is empty")
        key = term_key(term)
        if key in seen:
            raise ValueError(f"term {term_label(term)!r} appears twice")
        seen.add(key)
        for name in set(term):
            f = spec.factor(name)
            if f.kind == NOMINAL and term.count(name) > 1:
                raise ValueError(
                    f"term {term_label(term)!r} repeats the nominal factor {name!r}; "
                    "polynomial terms need a continuous factor"
                )


def _centred(spec: ModelSpec, term: Sequence[str]) -> bool:
    return spec.center and len(term) > 1


def _part_columns(
    spec: ModelSpec, name: str, centred: bool, values: NDArray[np.float64]
) -> NDArray[np.float64]:
    """Columns of one factor part for a term: (n, 1) continuous or (n, k-1) nominal."""
    f = spec.factor(name)
    if f.kind == CONTINUOUS:
        x = values - f.mean if centred else values
        return np.asarray(x, dtype=float).reshape(-1, 1)
    k = len(f.levels)
    codes = values.astype(int)
    if np.any((codes < AVERAGE_LEVEL) | (codes >= k)):
        raise ValueError(f"level index out of range for factor {name!r}")
    out = np.zeros((codes.size, k - 1), dtype=float)
    for j in range(k - 1):
        out[codes == j, j] = 1.0
    out[codes == k - 1, :] = -1.0
    return out  # AVERAGE_LEVEL rows stay 0: the mean of the level codes


def _part_names(spec: ModelSpec, name: str, centred: bool) -> list[str]:
    f = spec.factor(name)
    if f.kind == CONTINUOUS:
        return [f"({name}-{f.mean:.6g})" if centred else name]
    return [f"{name}[{lv}]" for lv in f.levels[:-1]]


def term_columns(
    spec: ModelSpec, term: Sequence[str], profile: Mapping[str, NDArray[np.float64]]
) -> NDArray[np.float64]:
    """Row-wise product of the term's parts (nominal parts expand Kronecker-style)."""
    centred = _centred(spec, term)
    block: NDArray[np.float64] | None = None
    for name in term:
        part = _part_columns(spec, name, centred, np.asarray(profile[name], dtype=float))
        if block is None:
            block = part
        else:
            n = block.shape[0]
            block = np.asarray(
                (block[:, :, None] * part[:, None, :]).reshape(n, -1), dtype=float
            )
    assert block is not None
    return block


def term_parameter_names(spec: ModelSpec, term: Sequence[str]) -> list[str]:
    """Parameter labels in the column order of :func:`term_columns`."""
    centred = _centred(spec, term)
    names = [""]
    for name in term:
        parts = _part_names(spec, name, centred)
        names = [f"{a}*{b}" if a else b for a in names for b in parts]
    return names


def term_slices(spec: ModelSpec) -> list[slice]:
    """Column slice of each term in the full design (column 0 = intercept)."""
    out: list[slice] = []
    start = 1
    for term in spec.terms:
        width = 1
        for name in term:
            f = spec.factor(name)
            width *= 1 if f.kind == CONTINUOUS else len(f.levels) - 1
        out.append(slice(start, start + width))
        start += width
    return out


def design_matrix(
    spec: ModelSpec, profile: Mapping[str, NDArray[np.float64]], n: int
) -> NDArray[np.float64]:
    """The full design ``[1 | term columns ...]`` for ``n`` profile rows."""
    blocks = [np.ones((n, 1), dtype=float)]
    blocks.extend(term_columns(spec, t, profile) for t in spec.terms)
    return np.asarray(np.hstack(blocks), dtype=float)


def parameter_names(spec: ModelSpec) -> list[str]:
    names = ["Intercept"]
    for term in spec.terms:
        names.extend(term_parameter_names(spec, term))
    return names


def encode_profile(
    spec: ModelSpec, rows: Mapping[str, Sequence[object]]
) -> tuple[dict[str, NDArray[np.float64]], int]:
    """Turn user-facing factor settings (floats; level strings, or ``None`` for
    "average over levels" on a nominal factor) into a coded profile. Fails
    closed on an unknown level, a missing factor or ragged lengths."""
    used = {name for term in spec.terms for name in term}
    lengths = {len(rows[name]) for name in used if name in rows}
    missing = sorted(used - set(rows))
    if missing:
        raise ValueError(f"settings missing for factor(s): {', '.join(missing)}")
    if len(lengths) != 1:
        raise ValueError("every factor needs the same number of settings")
    n = lengths.pop()
    profile: dict[str, NDArray[np.float64]] = {}
    for name in used:
        f = spec.factor(name)
        if f.kind == CONTINUOUS:
            try:
                nums = [float(v) for v in rows[name]]  # type: ignore[arg-type]
            except (TypeError, ValueError):
                raise ValueError(f"settings for {name!r} must be finite numbers") from None
            vals = np.asarray(nums, dtype=np.float64)
            if not np.all(np.isfinite(vals)):
                raise ValueError(f"settings for {name!r} must be finite numbers")
            profile[name] = vals
        else:
            index = {lv: i for i, lv in enumerate(f.levels)}
            codes = []
            for v in rows[name]:
                if v is None:
                    codes.append(AVERAGE_LEVEL)
                elif str(v) in index:
                    codes.append(index[str(v)])
                else:
                    raise ValueError(f"{v!r} is not a fitted level of {name!r}")
            profile[name] = np.asarray(codes, dtype=float)
    return profile, n

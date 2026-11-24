"""Turn a :class:`~quantized.calc.doe.Design` into a worksheet (GAP_AUDIT_9 J16).

Layout (one row per run, in RUN order): X column ``Run`` (1..n); channels
``StdOrder``, ``PointType`` (categorical), one ``<name> (coded)`` and one
``<name>`` (actual units) column per factor, then an empty response column
(NaN). Actual = centre + coded * half-range, with centre = (low + high) / 2 and
half-range = (low - high) / 2 abs; star points of a CCD therefore fall outside
[low, high] (NIST 5.3.3.6.3 Table 3.25: 10..20 gives 6.6 / 23.4 at alpha 1.682).

``metadata["doe"]`` is the design record Fit Model's "Analyze design" reads
(factors, their coded/actual column labels, the response label, the model
terms) and what the result book can cite (generators, alias structure, seed).
"""

from __future__ import annotations

import secrets
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np

from quantized.calc.doe import AXIAL, CENTER, FACTORIAL, Design
from quantized.calc.doe_tables import LETTERS
from quantized.datastruct import DataStruct

POINT_TYPES = (FACTORIAL, AXIAL, CENTER)
RUN_COLUMN = "Run"


@dataclass(frozen=True)
class FactorSetting:
    name: str
    low: float = -1.0
    high: float = 1.0
    unit: str = ""


def _validate(design: Design, factors: Sequence[FactorSetting], response: str) -> None:
    if len(factors) != design.k:
        raise ValueError(f"the design has {design.k} factors but {len(factors)} were described")
    labels = [RUN_COLUMN, "StdOrder", "PointType", response]
    for f in factors:
        if not f.name.strip():
            raise ValueError("every factor needs a name")
        if not (np.isfinite(f.low) and np.isfinite(f.high)) or f.low == f.high:
            raise ValueError(f"factor {f.name!r}: low and high must be different finite numbers")
        labels += [f.name, f"{f.name} (coded)"]
    if not response.strip():
        raise ValueError("the response needs a name")
    dup = sorted({n for n in labels if labels.count(n) > 1})
    if dup:
        raise ValueError(f"column names must be unique (repeated: {', '.join(dup)})")


def build_worksheet(
    design: Design,
    factors: Sequence[FactorSetting],
    response: str = "Response",
    randomize: bool = False,
    seed: int | None = None,
) -> DataStruct:
    """The design as a worksheet. ``randomize`` shuffles the run order with a
    ``numpy`` generator seeded by ``seed`` (a fresh seed is drawn when none is
    given and recorded in the metadata so the order can be reproduced)."""
    _validate(design, factors, response)
    n, k = design.coded.shape
    used_seed: int | None = None
    if randomize:
        if seed is not None and (
            not isinstance(seed, int) or isinstance(seed, bool) or not 0 <= seed < 2**32
        ):
            raise ValueError("seed must be a whole number from 0 to 4294967295")
        used_seed = seed if seed is not None else secrets.randbelow(2**31)
        order = np.random.default_rng(used_seed).permutation(n)
    else:
        order = np.arange(n)
    coded = design.coded[order]
    centre = np.array([(f.low + f.high) / 2.0 for f in factors])
    half = np.array(
        [abs(f.high - f.low) / 2.0 * (1.0 if f.high > f.low else -1.0) for f in factors]
    )
    actual = centre + coded * half
    ptype = np.array([POINT_TYPES.index(design.point_type[i]) for i in order], dtype=float)
    values = np.column_stack(
        [
            (order + 1).astype(float),
            ptype,
            coded,
            actual,
            np.full(n, np.nan),
        ]
    )
    # channel order: StdOrder, PointType, coded[0..k), actual[0..k), response
    labels = [
        "StdOrder",
        "PointType",
        *[f"{f.name} (coded)" for f in factors],
        *[f.name for f in factors],
        response,
    ]
    units = ["", "", *[""] * k, *[f.unit for f in factors], ""]
    coded_labels = labels[2 : 2 + k]
    terms = [[factors[i].name for i in t] for t in design.terms]
    terms_coded = [[coded_labels[i] for i in t] for t in design.terms]
    error_df = n - 1 - len(design.terms)
    doe: dict[str, Any] = {
        "version": 1,
        "kind": design.kind,
        "model": design.model,
        "factors": [
            {
                "name": f.name,
                "letter": LETTERS[i],
                "low": f.low,
                "high": f.high,
                "unit": f.unit,
                "coded_label": coded_labels[i],
                "actual_label": f.name,
            }
            for i, f in enumerate(factors)
        ],
        "response_label": response,
        "terms": terms,
        "terms_coded": terms_coded,
        "runs": n,
        "randomized": randomize,
        "seed": used_seed,
        "replicates": design.replicates,
        "center_points": design.center_points,
        "resolution": design.resolution,
        "generators": list(design.generators),
        "defining_relation": design.relation,
        "aliases": [list(a) for a in design.aliases],
        "alpha": design.alpha,
        "error_df": error_df,
        "notes": list(design.notes),
    }
    return DataStruct.create(
        np.arange(1, n + 1, dtype=float),
        values,
        labels=labels,
        units=units,
        metadata={"x_column_name": RUN_COLUMN, "doe": doe},
        cat_levels={1: POINT_TYPES},
    )

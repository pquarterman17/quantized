"""Freeze pandas ``groupby().transform()`` reference values for the grouped
formula aggregates (``frontend/src/lib/formulaGroupAgg.ts``, gap audit 9 G4).

Usage: ``uv run python tools/freeze_group_agg_fixture.py``. pandas (BSD) is the
ORACLE only; the app computes the values itself and
``formulaGroupAgg.test.ts`` compares them. pandas semantics line up with the
documented ones: NaN x skipped, NaN by-key rows -> NaN (``dropna=True``),
``std`` is ddof=1, rank method first/average/min/dense.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

OUT = Path(__file__).resolve().parents[1] / "frontend/src/lib/__fixtures__/formulaGroupAgg.json"
NAN = float("nan")

# x (A), by-keys B and C. Group B=1 has ties and a missing x; B=2 is constant
# (sd 0); B=3 has one value; B=4 is all-missing; two rows have a missing key.
X = [
    3.5,
    1.0,
    1.0,
    NAN,
    7.25,
    2.0,
    2.0,
    2.0,
    9.0,
    NAN,
    NAN,
    4.0,
    -1.5,
    4.0,
    0.5,
    8.0,
    1.0,
    6.0,
    2.5,
    2.5,
]
B = [1, 1, 1, 1, 1, 2, 2, 2, 3, 4, 4, 1, 1, NAN, 5, 5, 5, 5, NAN, 1]
C = [0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 1, 1, 0, 0, 1]


def build() -> dict[str, object]:
    df = pd.DataFrame({"x": X, "b": B, "c": C})
    out: dict[str, dict[str, list[float | None]]] = {"b": {}, "bc": {}, "none": {}}
    for tag, keys in (("b", ["b"]), ("bc", ["b", "c"])):
        g = df.groupby(keys, dropna=True)["x"]
        res: dict[str, pd.Series] = {
            "col_mean": g.transform("mean"),
            "col_sd": g.transform("std"),
            "col_min": g.transform("min"),
            "col_max": g.transform("max"),
            "col_median": g.transform("median"),
            "col_sum": g.transform(lambda s: s.sum(min_count=1)),
            "col_count": g.transform("count"),
            "col_rank": g.rank(method="first"),
            "col_rank_avg": g.rank(method="average"),
            "col_rank_min": g.rank(method="min"),
            "col_rank_dense": g.rank(method="dense"),
        }
        z = (df["x"] - g.transform("mean")) / g.transform("std")
        res["col_score"] = z.replace([np.inf, -np.inf], np.nan)  # sd 0 -> missing, not inf
        out[tag] = {k: [None if pd.isna(v) else float(v) for v in s] for k, s in res.items()}
    s = df["x"]
    out["none"] = {
        "col_mean": [float(s.mean())] * len(s),
        "col_sd": [float(s.std())] * len(s),
        "col_count": [float(s.count())] * len(s),
        "col_rank_avg": [None if pd.isna(v) else float(v) for v in s.rank(method="average")],
    }
    return {
        "x": [None if v != v else v for v in X],
        "b": [None if v != v else v for v in B],
        "c": C,
        "pandas": pd.__version__,
        "expected": out,
    }


if __name__ == "__main__":
    OUT.write_text(json.dumps(build(), indent=1) + "\n")
    print("wrote", OUT)

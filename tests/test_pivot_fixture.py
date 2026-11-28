"""The time-series pivot's rules (frontend/src/lib/pivot.ts), pinned against pandas.

``tests/fixtures/wire/pivot.json`` holds each case's input and the table pandas produces for it
(``pivot`` for unique pairs, ``pivot_table`` for an aggregate rule, ``melt`` for wide to long).
This test recomputes every case with the installed pandas and asserts it equals the fixture, so the
fixture is pandas's answer and not ours; ``frontend/src/lib/pivot.test.ts`` asserts the TypeScript
implementation reproduces the same fixture. Set ``QZ_REGEN_FIXTURES=1`` to rewrite the file.
"""

from __future__ import annotations

import json
import math
import os
from pathlib import Path
from typing import Any

import pandas as pd
import pytest

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "pivot.json"
NAN = float("nan")

_LONG = {
    "t": [3.0, 1.0, 2.0, 1.0, 3.0, 2.0, 4.0],
    "k": ["10", "10", "10", "20", "20", "30", "20"],
    "v": [1.5, 2.5, NAN, 4.0, 5.0, 6.0, 7.0],
}
_DUP = {
    "t": [1.0, 1.0, 1.0, 2.0, 2.0, 3.0, 3.0, 3.0],
    "k": ["a", "a", "b", "a", "a", "b", "b", "b"],
    "v": [1.0, 3.0, 5.0, 2.0, NAN, 7.0, 9.0, 11.0],
}
_WIDE = {"t": [1.0, 2.0, 3.0], "a": [1.0, NAN, 3.0], "b": [4.0, 5.0, 6.0]}
RULES = ["mean", "sum", "min", "max", "first", "last", "count"]


def _clean(x: float) -> Any:
    return None if isinstance(x, float) and math.isnan(x) else x


def _grid(frame: pd.DataFrame) -> dict[str, Any]:
    return {
        "time": [float(t) for t in frame.index],
        "keys": [str(c) for c in frame.columns],
        "values": [[_clean(float(v)) for v in row] for row in frame.to_numpy()],
    }


def _cases() -> dict[str, Any]:
    cases: dict[str, Any] = {}
    unique = pd.DataFrame(_LONG).pivot(index="t", columns="k", values="v")
    cases["pivot_unique"] = {"long": _LONG, "rule": "refuse", "expect": _grid(unique)}
    dup = pd.DataFrame(_DUP)
    with pytest.raises(ValueError):
        dup.pivot(index="t", columns="k", values="v")
    cases["pivot_duplicates_refused"] = {"long": _DUP, "rule": "refuse", "expect": {"error": True}}
    for rule in RULES:
        table = dup.pivot_table(index="t", columns="k", values="v", aggfunc=rule, dropna=False)
        cases[f"pivot_{rule}"] = {"long": _DUP, "rule": rule, "expect": _grid(table)}
    wide = pd.DataFrame(_WIDE)
    for skip in (False, True):
        m = wide.melt(id_vars="t", var_name="k", value_name="v")
        if skip:
            m = m.dropna(subset=["v"])
        cases[f"melt_skip_{str(skip).lower()}"] = {
            "wide": _WIDE,
            "skipEmpty": skip,
            "expect": {
                "time": [float(x) for x in m["t"]],
                "key": [str(x) for x in m["k"]],
                "value": [_clean(float(x)) for x in m["v"]],
            },
        }
    return json.loads(json.dumps(cases, default=_clean).replace("NaN", "null"))


def test_fixture_is_what_pandas_produces() -> None:
    cases = _cases()
    if os.environ.get("QZ_REGEN_FIXTURES") == "1":
        FIXTURE.write_text(json.dumps(cases, indent=1) + "\n", encoding="utf-8")
    assert json.loads(FIXTURE.read_text(encoding="utf-8")) == cases

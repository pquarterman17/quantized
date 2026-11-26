"""The data model of the analysis-oracle harness: cases are data, not code.

A :class:`Case` names a seeded input generator, the LabTalk steps (one
``Execute`` each) and the values to read back. The runner (``run.py``) is the
only module that talks to Origin; everything here is pure and tested in CI.
"""

from __future__ import annotations

import json
import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from numpy.typing import NDArray

BOOK_TOKEN = "{book}"  # replaced by the short name of the case's input book

# Column designations accepted here; mapped to Origin's by the runner.
DESIGNATIONS = ("X", "Y", "Y-error", "X-error")


@dataclass(frozen=True)
class Column:
    name: str  # long name, also the input.csv header
    designation: str
    values: NDArray[np.float64]


@dataclass(frozen=True)
class InputSpec:
    """What a generator returns: the input columns and the planted truth."""

    columns: tuple[Column, ...]
    truth: dict[str, Any]


Generator = Callable[[np.random.Generator], InputSpec]


@dataclass(frozen=True)
class Read:
    """One value to read after the steps ran.

    ``kind`` is ``"var"`` (numeric LabTalk variable via ``LTVar``) or ``"str"``
    (string variable via ``LTStr``; the name carries no trailing ``$``).
    Every worksheet the steps created is captured automatically (the runner
    always records ``books``), so there is no sheet kind.
    """

    name: str
    kind: str = "var"


@dataclass(frozen=True)
class Case:
    id: str
    description: str
    seed: int
    generate: Generator
    steps: tuple[str, ...]
    reads: tuple[Read, ...] = ()
    # Origin C files (in tools/origin_oracle/) compiled before the steps, for
    # engines that LabTalk cannot reach (see qz_york.c).
    load_oc: tuple[str, ...] = ()
    # Set when the function could not be driven: what was tried and why it
    # failed. The runner records status "not_exercised" and sends nothing.
    not_exercised: tuple[str, ...] = field(default_factory=tuple)

    def labtalk(self, book: str) -> list[str]:
        """The exact LabTalk sent, with the book name substituted."""
        return [s.replace(BOOK_TOKEN, book) for s in self.steps]


def validate_case(case: Case) -> list[str]:
    """Problems with a case definition (empty list when sound)."""
    bad: list[str] = []
    if not case.id or any(c in case.id for c in '\\/:*?"<>| '):
        bad.append(f"{case.id!r}: id must be a plain filename-safe token")
    if not case.not_exercised and not case.steps:
        bad.append(f"{case.id}: no steps")
    for st in case.steps:
        if "\n" in st:
            bad.append(f"{case.id}: one Execute per step, found a newline in {st!r}")
    for f in case.load_oc:
        if "/" in f or "\\" in f or not f.endswith(".c"):
            bad.append(f"{case.id}: load_oc entries are bare .c file names, got {f!r}")
    for r in case.reads:
        if r.kind not in ("var", "str"):
            bad.append(f"{case.id}: read {r.name!r} has unknown kind {r.kind!r}")
    return bad


def fmt(v: float) -> str:
    """Round-trippable text for a float (``repr``): the same value always
    gives the same bytes, and parses back exactly."""
    return repr(float(v))


def input_csv(spec: InputSpec) -> str:
    """The ``input.csv`` text: header = column names, LF line endings."""
    cols = spec.columns
    n = max(len(c.values) for c in cols)
    lines = [",".join(c.name for c in cols)]
    for i in range(n):
        lines.append(",".join(fmt(c.values[i]) if i < len(c.values) else "" for c in cols))
    return "\n".join(lines) + "\n"


def _clean(v: Any) -> Any:
    """JSON-safe: numpy scalars to python, non-finite floats to None."""
    if isinstance(v, np.generic):
        v = v.item()
    if isinstance(v, float) and not math.isfinite(v):
        return None
    if isinstance(v, dict):
        return {str(k): _clean(x) for k, x in v.items()}
    if isinstance(v, np.ndarray):
        return [_clean(x) for x in v.tolist()]
    if isinstance(v, (list, tuple)):
        return [_clean(x) for x in v]
    return v


def to_json(obj: Any) -> str:
    """Stable, sorted-key, LF-terminated JSON (byte-deterministic)."""
    return json.dumps(_clean(obj), indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def truth_doc(case: Case, spec: InputSpec) -> dict[str, Any]:
    return {
        "case": case.id,
        "seed": case.seed,
        "description": case.description,
        "columns": [{"name": c.name, "designation": c.designation} for c in spec.columns],
        "planted": spec.truth,
    }


def make_input(case: Case) -> InputSpec:
    return case.generate(np.random.default_rng(case.seed))


def find_case(cases: Sequence[Case], case_id: str) -> Case:
    for c in cases:
        if c.id == case_id:
            return c
    raise KeyError(f"unknown case {case_id!r}; known: {[c.id for c in cases]}")


__all__ = [
    "BOOK_TOKEN", "Case", "Column", "DESIGNATIONS", "Generator", "InputSpec", "NDArray",
    "Read", "find_case", "fmt", "input_csv", "make_input", "to_json", "truth_doc",
    "validate_case",
]

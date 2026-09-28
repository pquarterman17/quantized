"""Cross-language parity for UNIT evidence in error-column pairing.

``quantized.io.error_unit_evidence`` (plus ``error_binding_confidence``'s
dataset entry point) and ``frontend/src/lib/errorUnitEvidence.ts`` (plus
``errorRoles.ts``'s ``inferErrorBindings``) are two independently
maintained implementations of the SAME unit gate. Both read
``tests/fixtures/error_labels/unit_evidence_corpus.json``; the TypeScript
half is ``frontend/src/lib/errorUnitEvidence.test.ts``.

The fixture is HAND-CURATED (its ``_about`` says how). A failure here or in
the vitest means the two languages DISAGREE -- make them agree; never edit
an expected value to hide a disagreement.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from quantized.datastruct import DataStruct
from quantized.io.error_binding_confidence import score_dataset_error_bindings
from quantized.io.error_unit_evidence import _UNITLESS, compare_units, normalize_unit

FIXTURE_PATH = (
    Path(__file__).resolve().parent / "fixtures" / "error_labels" / "unit_evidence_corpus.json"
)


def _fixture() -> dict[str, Any]:
    with open(FIXTURE_PATH, encoding="utf-8") as f:
        data = json.load(f)
    assert isinstance(data, dict)
    return data


_DATA = _fixture()
_CASES: list[dict[str, Any]] = _DATA["cases"]
_PAIRINGS: list[dict[str, Any]] = _DATA["pairings"]


def test_fixture_covers_all_three_verdicts() -> None:
    assert {c["verdict"] for c in _CASES} == {"match", "mismatch", "unknown"}


@pytest.mark.parametrize("case", _CASES, ids=[str(c["note"]) for c in _CASES])
def test_compare_units_matches_the_shared_fixture(case: dict[str, Any]) -> None:
    error, value = case["error"], case["value"]
    assert [normalize_unit(error), normalize_unit(value)] == case["normalized"]
    assert compare_units(error, value) == case["verdict"], (
        f"compare_units({error!r}, {value!r}) should be {case['verdict']!r} per the shared "
        "fixture -- check errorUnitEvidence.ts and error_unit_evidence.py stayed in sync"
    )


def test_unitless_list_is_exactly_the_python_set() -> None:
    """The TypeScript matches ``_UNITLESS`` with one compact regex; the
    fixture lists every spelling so the vitest can prove the regex accepts
    each one, and this pins that the list is complete."""
    assert sorted(_DATA["unitless"]) == sorted(_UNITLESS)
    for spelling in _DATA["unitless"]:
        assert normalize_unit(spelling) is None


@pytest.mark.parametrize("case", _PAIRINGS, ids=[str(c["note"]) for c in _PAIRINGS])
def test_dataset_pairing_with_the_unit_gate_matches_the_shared_fixture(
    case: dict[str, Any],
) -> None:
    labels = case["labels"]
    ds = DataStruct.create(
        [0.0], [[0.0] * len(labels)],
        labels=labels, units=case["units"], metadata=case["metadata"],
    )
    actual = [s.binding().to_dict() for s in score_dataset_error_bindings(ds) if not s.blocked]
    assert actual == case["bindings"]

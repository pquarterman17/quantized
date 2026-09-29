"""Cross-language parity for the error-binding CONFIDENCE GRADE.

``quantized.io.error_binding_confidence`` and
``frontend/src/lib/errorBindingConfidence.ts`` are two independently
maintained implementations of the SAME grade (header evidence x unit
evidence -> high / medium / low / blocked). Both read
``tests/fixtures/error_labels/confidence_corpus.json``; the TypeScript half
is ``frontend/src/lib/errorBindingConfidence.test.ts``.

The fixture is HAND-CURATED (its ``_about`` says how). A failure here or in
the vitest means the two languages DISAGREE -- make them agree; never edit
an expected value to hide a disagreement.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from quantized.io.error_binding_confidence import binding_confidence, score_error_bindings

FIXTURE_PATH = (
    Path(__file__).resolve().parent / "fixtures" / "error_labels" / "confidence_corpus.json"
)


def _fixture() -> dict[str, Any]:
    with open(FIXTURE_PATH, encoding="utf-8") as f:
        data = json.load(f)
    assert isinstance(data, dict)
    return data


_DATA = _fixture()
_CASES: list[dict[str, Any]] = _DATA["cases"]
_LABEL_ONLY: list[dict[str, Any]] = _DATA["label_only"]


def test_fixture_exercises_every_grade() -> None:
    grades = {s["confidence"] for c in _CASES for s in c["scored"]}
    assert grades == {"high", "medium", "low", "blocked"}


@pytest.mark.parametrize("row", _DATA["grades"], ids=lambda r: f"{r['header']}-{r['unit']}")
def test_grade_table_matches_the_shared_fixture(row: dict[str, Any]) -> None:
    assert binding_confidence(row["header"], row["unit"]) == row["confidence"]


@pytest.mark.parametrize("case", _CASES, ids=[str(c["note"]) for c in _CASES])
def test_scored_pairings_match_the_shared_fixture(case: dict[str, Any]) -> None:
    actual = [
        s.to_dict()
        for s in score_error_bindings(case["labels"], case["units"], x_unit=case["x_unit"])
    ]
    assert actual == case["scored"], (
        "score_error_bindings disagrees with the shared fixture -- check "
        "errorBindingConfidence.ts and error_binding_confidence.py stayed in sync"
    )


def test_label_only_section_is_the_whole_label_parity_corpus() -> None:
    """``label_only`` re-grades every ``parity_corpus.json`` case, so a case
    added there without being graded here is a gap in the grade's parity."""
    corpus_path = FIXTURE_PATH.with_name("parity_corpus.json")
    corpus = json.loads(corpus_path.read_text(encoding="utf-8"))["cases"]
    assert [c["labels"] for c in _LABEL_ONLY] == [c["labels"] for c in corpus]


@pytest.mark.parametrize("case", _LABEL_ONLY, ids=[str(c["note"]) for c in _LABEL_ONLY])
def test_label_only_grades_match_the_shared_fixture(case: dict[str, Any]) -> None:
    labels = case["labels"]
    actual = [s.to_dict() for s in score_error_bindings(labels, [""] * len(labels))]
    assert actual == case["scored"]

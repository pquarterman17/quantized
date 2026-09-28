"""Evidence-weighted confidence for inferred error pairings
(``io/error_binding_confidence.py``) and the fail-closed unit gate on the
Import Wizard's suggestions (``io/error_binding_suggestions.py``).

plans/LIBRARY_WORKBOOK_UX_PLAN.md: "Header, unit, parser metadata, and
adjacency evidence contribute to a confidence result; adjacency alone is
insufficient."
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from quantized.datastruct import DataStruct
from quantized.io.error_binding_confidence import (
    binding_confidence,
    infer_error_bindings_with_units,
    score_dataset_error_bindings,
    score_error_bindings,
)
from quantized.io.error_binding_suggestions import suggest_error_bindings
from quantized.io.error_inference import ErrorBinding, infer_error_bindings_from_labels
from quantized.io.import_error_bindings import ErrorBinding as RawErrorBinding
from quantized.io.import_preview import ImportSettings, preview_import

PARITY_CORPUS = (
    Path(__file__).resolve().parent / "fixtures" / "error_labels" / "parity_corpus.json"
)


def _only(labels: list[str], units: list[str], x_unit: str | None = None) -> tuple[str, str, str]:
    scored = score_error_bindings(labels, units, x_unit=x_unit)
    assert len(scored) == 1, scored
    s = scored[0]
    return s.header, s.unit, s.confidence


# ── the grading table ───────────────────────────────────────────────────


def test_grading_table() -> None:
    assert binding_confidence("name", "match") == "high"
    assert binding_confidence("name", "unknown") == "medium"
    assert binding_confidence("position", "match") == "medium"
    assert binding_confidence("position", "unknown") == "low"
    assert binding_confidence("name", "mismatch") == "blocked"
    assert binding_confidence("position", "mismatch") == "blocked"


# ── matching units RAISE confidence ─────────────────────────────────────


def test_matching_units_raise_a_name_driven_pairing_to_high() -> None:
    assert _only(["R", "dR"], ["", ""]) == ("name", "unknown", "medium")
    assert _only(["R", "dR"], ["Ohm", "Ω"]) == ("name", "match", "high")


def test_matching_units_raise_a_position_only_pairing_off_adjacency_alone() -> None:
    labels = ["H", "M", "error"]  # "error" names no base -> rule 3, pure position
    low = score_error_bindings(labels, ["", "", ""])
    assert [(s.target, s.header, s.confidence, s.sufficient) for s in low] == [
        (1, "position", "low", False)  # adjacency alone is insufficient
    ]
    medium = score_error_bindings(labels, ["Oe", "emu", "(emu)"])
    assert [(s.target, s.header, s.confidence, s.sufficient) for s in medium] == [
        (1, "position", "medium", True)
    ]


def test_an_x_axis_pairing_is_graded_against_the_x_unit() -> None:
    assert _only(["M", "xerr"], ["emu", "Oe"], x_unit="Oe") == ("name", "match", "high")
    assert _only(["M", "xerr"], ["emu", "Oe"]) == ("name", "unknown", "medium")


# ── a unit MISMATCH blocks the pairing (fail closed) ───────────────────


def test_mismatch_blocks_an_adjacent_header_suggestive_error_column() -> None:
    """The headline case: value in Oe, an adjacent column literally NAMED
    "error" in K. The label rules alone bind it; the unit gate refuses."""
    labels, units = ["H", "error"], ["Oe", "K"]
    assert infer_error_bindings_from_labels(labels) == [
        ErrorBinding(channel=1, target=0, axis="y", side="both")
    ]
    scored = score_error_bindings(labels, units)
    assert [(s.header, s.unit, s.confidence, s.blocked, s.sufficient) for s in scored] == [
        ("position", "mismatch", "blocked", True, False)
    ]
    assert infer_error_bindings_with_units(labels, units) == []


def test_mismatch_blocks_even_a_name_driven_pairing() -> None:
    labels = ["M", "M_err"]
    assert _only(labels, ["emu", "K"]) == ("name", "mismatch", "blocked")
    assert _only(labels, ["ohm", "%"]) == ("name", "mismatch", "blocked")  # relative error
    assert infer_error_bindings_with_units(labels, ["emu", "K"]) == []


def test_mismatch_blocks_an_x_axis_pairing() -> None:
    assert _only(["M", "xerr"], ["emu", "Oe"], x_unit="K") == ("name", "mismatch", "blocked")
    assert infer_error_bindings_with_units(["M", "xerr"], ["emu", "Oe"], x_unit="K") == []


def test_a_blocked_pairing_is_never_re_targeted_to_a_unit_compatible_column() -> None:
    """Rule 3 picks R; the units contradict; the gate drops the pairing. It
    must NOT fall through to T just because T's unit happens to agree --
    that would be a fresh guess no label rule made."""
    labels, units = ["T", "R", "error"], ["K", "ohm", "K"]
    scored = score_error_bindings(labels, units)
    assert [(s.target, s.confidence) for s in scored] == [(1, "blocked")]
    assert infer_error_bindings_with_units(labels, units) == []


def test_blocking_one_pairing_leaves_the_others_in_rule_order() -> None:
    labels, units = ["A", "A_err", "B", "B_err"], ["V", "V", "V", "K"]
    scored = score_error_bindings(labels, units)
    assert [(s.channel, s.target, s.confidence) for s in scored] == [
        (1, 0, "high"), (3, 2, "blocked")
    ]
    assert infer_error_bindings_with_units(labels, units) == [
        ErrorBinding(channel=1, target=0, axis="y", side="both")
    ]


# ── unknown units are NEUTRAL; existing fixtures unchanged ──────────────


def _parity_cases() -> list[dict[str, object]]:
    with open(PARITY_CORPUS, encoding="utf-8") as f:
        cases = json.load(f)["cases"]
    assert isinstance(cases, list) and cases
    return cases


@pytest.mark.parametrize("blank", ["", "a.u.", "-"])
def test_unknown_units_reproduce_every_parity_fixture_pairing_exactly(blank: str) -> None:
    """Over the WHOLE shared TS/Python parity corpus: with no unit
    information the unit-aware inference binds exactly what the label-only
    inference binds (the fixture's own expectation), blocks nothing, and
    grades each pairing only on header-vs-position evidence."""
    for case in _parity_cases():
        labels = case["labels"]
        assert isinstance(labels, list)
        units = [blank] * len(labels)
        scored = score_error_bindings(labels, units, x_unit=blank)
        assert [s.binding().to_dict() for s in scored] == case["bindings"], case["note"]
        assert [b.to_dict() for b in infer_error_bindings_with_units(labels, units)] == (
            case["bindings"]
        )
        assert all(s.unit == "unknown" for s in scored)
        assert all(s.confidence == ("medium" if s.header == "name" else "low") for s in scored)


def test_units_one_side_only_are_neutral() -> None:
    assert _only(["R", "dR"], ["ohm", ""]) == ("name", "unknown", "medium")
    assert _only(["R", "dR"], ["", "ohm"]) == ("name", "unknown", "medium")


def test_units_must_align_with_labels() -> None:
    with pytest.raises(ValueError, match="units must align with labels"):
        score_error_bindings(["R", "dR"], ["ohm"])


def test_dataset_entry_point_uses_channel_units_and_the_recorded_x_unit() -> None:
    ds = DataStruct.create(
        [1.0, 2.0], [[1.0, 0.1, 0.2], [2.0, 0.1, 0.2]],
        labels=["M", "M_err", "xerr"], units=["emu", "emu", "Oe"],
        metadata={"xUnit": "K"},
    )
    assert [(s.channel, s.target, s.confidence) for s in score_dataset_error_bindings(ds)] == [
        (1, 0, "high"), (2, -1, "blocked")
    ]


# ── the Import Wizard's suggestions: units can only take one away ───────


def _col(index: int, name: str, role: str, unit: str = "") -> dict[str, object]:
    return {"index": index, "name": name, "unit": unit, "role": role}


def test_suggestion_with_matching_units_is_kept() -> None:
    cols = [_col(0, "H", "x", "Oe"), _col(1, "M", "y", "emu"), _col(2, "M_err", "error", "emu")]
    assert suggest_error_bindings(cols) == [RawErrorBinding(column=2, target=1, axis="y",
                                                            side="both")]


@pytest.mark.parametrize(
    "cols",
    [
        # name-driven (rule 1)
        [_col(0, "H", "x", "Oe"), _col(1, "M", "y", "emu"), _col(2, "M_err", "error", "K")],
        # position-only, single candidate (rule 3)
        [_col(0, "H", "x", "Oe"), _col(1, "M", "y", "emu"), _col(2, "error", "error", "K")],
        # the x-name rule (H_err names the x column H)
        [_col(0, "H", "x", "Oe"), _col(1, "M", "y", "emu"), _col(2, "H_err", "error", "K")],
        # explicit x prefix (rule 2) against the x column's unit
        [_col(0, "H", "x", "Oe"), _col(1, "M", "y", "emu"), _col(2, "xerr", "error", "K")],
    ],
    ids=["rule1-name", "rule3-position", "x-name", "rule2-x-prefix"],
)
def test_suggestion_with_mismatched_units_is_dropped(cols: list[dict[str, object]]) -> None:
    assert suggest_error_bindings(cols) == []
    # Control: the SAME shape with blank error-column units IS suggested, so
    # the drop above is the unit gate and nothing else.
    blank = [dict(c, unit="") if c["role"] == "error" else c for c in cols]
    assert len(suggest_error_bindings(blank)) == 1


def test_matching_units_never_rescue_a_demoted_ambiguous_suggestion() -> None:
    """Units only ever REMOVE a suggestion: a position-only pairing with an
    equally plausible column on each side stays unsuggested even when
    every unit agrees."""
    cols = [_col(0, "T1", "y", "K"), _col(1, "T err", "error", "K"), _col(2, "T2", "y", "K")]
    assert suggest_error_bindings(cols) == []


def test_preview_import_suggestions_honour_header_embedded_units() -> None:
    settings = ImportSettings(header_line=0, data_start_line=1, roles=["x", "y", "error"])
    body = "1,2,0.1\n3,4,0.1\n"
    mismatched = preview_import("H (Oe),M (emu),M_err (K)\n" + body, settings)
    assert [c["unit"] for c in mismatched["columns"]] == ["Oe", "emu", "K"]
    assert mismatched["suggested_error_bindings"] == []
    matched = preview_import("H (Oe),M (emu),M_err (emu)\n" + body, settings)
    assert matched["suggested_error_bindings"] == [
        {"column": 2, "target": 1, "axis": "y", "side": "both"}
    ]

"""P16 — Python port of importwizard.ts's `suggestErrorBindings` TWO-TIER
narrowing test scenarios (frontend/src/lib/importwizard.test.ts), adapted
for `error_binding_suggestions.suggest_error_bindings`'s RAW-COLUMN-indexed
output (the TS function is channel-indexed; see that module's docstring
for why the Python port translates).
"""

from __future__ import annotations

from quantized.io.error_binding_suggestions import suggest_error_bindings
from quantized.io.import_error_bindings import ErrorBinding


def _col(index: int, name: str, role: str, effective_name: str | None = None) -> dict[str, object]:
    col: dict[str, object] = {"index": index, "name": name, "unit": "", "role": role}
    if effective_name is not None:
        col["effective_name"] = effective_name
    return col


def test_suggests_an_unambiguous_base_name_pairing() -> None:
    cols = [
        _col(0, "Temp", "x"),
        _col(1, "R", "y"),
        _col(2, "dR", "error"),
    ]
    assert suggest_error_bindings(cols) == [ErrorBinding(column=2, target=1, axis="y", side="both")]


def test_does_not_drop_a_rule_1_pairing_whose_base_is_only_provisionally_error_like() -> None:
    # "Serr" (base "y", role) is provisional-only error-like (glued "err",
    # no sibling "S") -- `_is_name_driven_match` must use the strict,
    # evidence-gated classifier so this base is still eligible.
    cols = [
        _col(0, "Serr", "y"),
        _col(1, "dSerr", "error"),
        _col(2, "X", "y"),
    ]
    assert suggest_error_bindings(cols) == [ErrorBinding(column=1, target=0, axis="y", side="both")]


def test_control_the_same_shape_with_a_non_provisional_base_was_never_affected() -> None:
    cols = [
        _col(0, "R", "y"),
        _col(1, "dR", "error"),
        _col(2, "X", "y"),
    ]
    assert suggest_error_bindings(cols) == [ErrorBinding(column=1, target=0, axis="y", side="both")]


def test_classifies_against_effective_name_not_raw_header_name() -> None:
    cols = [
        _col(0, "Col1", "x", effective_name="Temp"),
        _col(1, "Col2", "y", effective_name="R"),
        _col(2, "Col3", "error", effective_name="dR"),
    ]
    assert suggest_error_bindings(cols) == [ErrorBinding(column=2, target=1, axis="y", side="both")]


def test_leaves_a_genuinely_ambiguous_error_column_with_no_suggestion() -> None:
    cols = [
        _col(0, "Temp", "x"),
        _col(1, "err", "error"),
        _col(2, "M", "y"),
    ]
    assert suggest_error_bindings(cols) == []


def test_demotes_a_multi_candidate_position_only_pairing_to_unassigned() -> None:
    cols = [
        _col(0, "T1", "y"),
        _col(1, "T err", "error"),
        _col(2, "T2", "y"),
    ]
    assert suggest_error_bindings(cols) == []


def test_keeps_a_single_candidate_position_only_pairing_as_a_real_suggestion() -> None:
    cols = [
        _col(0, "Temp", "x"),
        _col(1, "M", "y"),
        _col(2, "err", "error"),
    ]
    assert suggest_error_bindings(cols) == [ErrorBinding(column=2, target=1, axis="y", side="both")]


def test_a_base_name_match_is_never_demoted_even_with_a_plausible_column_following() -> None:
    cols = [
        _col(0, "R", "y"),
        _col(1, "dR", "error"),
        _col(2, "M", "y"),
    ]
    assert suggest_error_bindings(cols) == [ErrorBinding(column=1, target=0, axis="y", side="both")]


def test_an_explicit_x_prefix_is_never_demoted_either() -> None:
    cols = [
        _col(0, "Signal", "y"),
        _col(1, "xerr", "error"),
        _col(2, "M", "y"),
    ]
    [binding] = suggest_error_bindings(cols)
    assert binding.column == 1
    assert binding.target == -1
    assert binding.axis == "x"


def test_a_following_error_role_column_does_not_itself_trigger_demotion() -> None:
    cols = [
        _col(0, "T1", "y"),
        _col(1, "err1", "error"),
        _col(2, "err2", "error"),
    ]
    bindings = suggest_error_bindings(cols)
    [b1] = [b for b in bindings if b.column == 1]
    assert b1 == ErrorBinding(column=1, target=0, axis="y", side="both")


def test_a_following_categorical_column_does_not_itself_trigger_demotion() -> None:
    cols = [
        _col(0, "T", "y"),
        _col(1, "err", "error"),
        _col(2, "Sample", "categorical"),
    ]
    assert suggest_error_bindings(cols) == [ErrorBinding(column=1, target=0, axis="y", side="both")]

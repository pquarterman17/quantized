"""P16 — Python port of importwizard.ts's `suggestErrorBindings` TWO-TIER
narrowing test scenarios (frontend/src/lib/importwizard.test.ts), adapted
for `error_binding_suggestions.suggest_error_bindings`'s RAW-COLUMN-indexed
output (the TS function is channel-indexed; see that module's docstring
for why the Python port translates).
"""

from __future__ import annotations

import time

import pytest

from quantized.io import error_binding_suggestions
from quantized.io.error_binding_suggestions import (
    suggest_error_bindings,
    suggest_error_bindings_by_channel,
)
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


# ── review finding #1: x is invisible to the channel-label pool, so a base- ──
# name match against the x column's OWN name must be checked separately, or
# the suggestion silently binds to whichever y column happens to precede.

def test_error_column_base_name_matching_the_x_column_binds_to_the_x_axis() -> None:
    # H_err's extracted base "h" matches x column H's own name -- invisible
    # to infer_error_bindings_from_labels (which never sees "H" at all,
    # since x never becomes a channel), so without a dedicated check this
    # fell through to rule 3 and wrongly bound H_err to M (target 1).
    cols = [
        _col(0, "H", "x"),
        _col(1, "M", "y"),
        _col(2, "H_err", "error"),
    ]
    expected = [ErrorBinding(column=2, target=-1, axis="x", side="both")]
    assert suggest_error_bindings(cols) == expected


def test_error_column_base_name_matching_x_still_works_when_x_is_not_first() -> None:
    # Same shape, x NOT at raw column 0 -- an off-by-one fix that assumed x
    # always sits at index 0 (or tried to adjust indices by a fixed offset
    # instead of looking the x column up by role) would only fail here.
    cols = [
        _col(0, "M", "y"),
        _col(1, "H", "x"),
        _col(2, "H_err", "error"),
    ]
    expected = [ErrorBinding(column=2, target=-1, axis="x", side="both")]
    assert suggest_error_bindings(cols) == expected


# ── review finding #2: suggestions are not restricted to already-"error"- ──
# role columns (that would make them always empty on a fresh preview), but
# a column the user deliberately marked something else stays off-limits.

def test_a_y_column_with_an_error_shaped_name_is_still_suggested() -> None:
    # `guess_settings` never assigns the `error` role -- every column here
    # is `y`, exactly the state a fresh preview is in, and a suggestion
    # must still be produced or the wizard could never seed anything.
    cols = [
        _col(0, "R", "y"),
        _col(1, "dR", "y"),
    ]
    assert suggest_error_bindings(cols) == [ErrorBinding(column=1, target=0, axis="y", side="both")]


def test_an_ignore_role_column_with_an_error_shaped_name_is_never_suggested() -> None:
    cols = [
        _col(0, "R", "y"),
        _col(1, "dR", "ignore"),
    ]
    assert suggest_error_bindings(cols) == []


def test_a_label_role_column_with_an_error_shaped_name_is_never_suggested() -> None:
    cols = [
        _col(0, "R", "y"),
        _col(1, "dR", "label"),
    ]
    assert suggest_error_bindings(cols) == []


def test_a_categorical_role_column_with_an_error_shaped_name_is_never_suggested() -> None:
    # Categorical IS a channel (unlike ignore/label), but a deliberately
    # chosen categorical role is never a plausible error SOURCE either.
    cols = [
        _col(0, "R", "y"),
        _col(1, "dR", "categorical"),
    ]
    assert suggest_error_bindings(cols) == []


# ── review finding #3: a suggested target must be able to become a real ──
# `y` channel -- `infer_error_bindings_from_labels` has no notion of role
# and can match a categorical column's name or position just as well.

def test_a_base_name_match_landing_on_a_categorical_column_is_never_suggested() -> None:
    # Cat_err's base "cat" matches the CATEGORICAL column Cat -- a real
    # name match by infer_error_bindings_from_labels's own rule, but
    # valid_error_bindings always refuses a non-y target
    # (TARGET_NOT_Y_ROLE), so surfacing it would be dead on arrival.
    # (Rule 3 -- nearest PRECEDING column -- can never reach a categorical
    # target: `_final_channel_order` always places every categorical
    # channel after every numeric one, P1.4's rule, so only rule 1's
    # whole-list name search can land there.)
    cols = [
        _col(0, "X", "x"),
        _col(1, "M", "y"),
        _col(2, "Cat", "categorical"),
        _col(3, "Cat_err", "error"),
    ]
    assert suggest_error_bindings(cols) == []


# ── review finding #4: performance -- classification calls stay O(columns), ──
# never re-derived per candidate binding (which made this ~cubic: measured
# ~110ms at 41 columns, ~1.6s at 101, ~12.8s at 201, ~98s at 401 before the
# fix below; ~14ms/76ms/310ms/1.3s after -- still the classifier's own
# baseline O(n^2) WORK, but no longer O(n) calls-per-binding on top of it).

def _value_error_pairs(n_pairs: int) -> list[dict[str, object]]:
    """``n_pairs`` name-driven (base-match) ``V{i}``/``V{i}_err`` column
    pairs behind one x column -- every error column gets a real rule-1
    binding, so every one of them exercises `_is_name_driven_match`
    (the call site the O(n^3) blowup lived in)."""
    cols: list[dict[str, object]] = [_col(0, "X", "x")]
    idx = 1
    for i in range(n_pairs):
        cols.append(_col(idx, f"V{i}", "y"))
        idx += 1
        cols.append(_col(idx, f"V{i}_err", "error"))
        idx += 1
    return cols


def test_classification_call_count_stays_linear_not_quadratic_in_column_count(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Per CLAUDE.md's test-determinism rule: assert the LOAD-INVARIANT
    property (how many times the evidence-gated classifier actually ran),
    not wall-clock alone. Before the fix, `_is_name_driven_match`
    re-classified the WHOLE label list on every candidate binding, on top
    of `infer_error_bindings_from_labels` already doing one O(n) pass
    internally -- O(n) bindings * O(n) re-classifications = O(n^2) CALLS
    (each doing O(n) internal work, hence the O(n^3) wall-clock blowup).
    The fix classifies the label list once and reuses it, so total calls
    should stay O(n): a 4x column-count increase should cost roughly a 4x
    call-count increase, nowhere near the ~16x a quadratic CALL COUNT (let
    alone the ~64x a cubic one) would cost. The multiplier below is
    generous headroom, not a tight bound -- see docs/testing.md."""
    calls = 0
    real = error_binding_suggestions.classify_error_label_in_labels

    def counting(*args: object, **kwargs: object) -> object:
        nonlocal calls
        calls += 1
        return real(*args, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(error_binding_suggestions, "classify_error_label_in_labels", counting)

    def call_count(n_pairs: int) -> int:
        nonlocal calls
        calls = 0
        suggest_error_bindings_by_channel(_value_error_pairs(n_pairs))
        return calls

    small = call_count(20)  # 41 columns
    large = call_count(80)  # 161 columns -- 4x the column count

    assert small > 0, "the classifier should run at all for a shaped preview"
    # Linear -> ~4x; quadratic -> ~16x; cubic -> ~64x. 8x leaves headroom
    # above linear noise while still catching a quadratic-or-worse regression.
    assert large <= small * 8, (
        f"classification calls grew {large / small:.1f}x for a 4x column-count "
        f"increase ({small} -> {large}) -- suggest_error_bindings_by_channel "
        "looks like it is re-classifying per binding again"
    )


def test_suggest_error_bindings_stays_fast_at_a_few_hundred_columns() -> None:
    """Loose wall-clock backstop alongside the call-count invariant above
    (CLAUDE.md: never lower an existing bound). The pre-fix function took
    ~98s at 401 columns; this generous ceiling would not have passed before
    the fix and comfortably passes after it (~1.3s measured)."""
    cols = _value_error_pairs(200)  # 401 columns
    t0 = time.perf_counter()
    suggest_error_bindings_by_channel(cols)
    elapsed = time.perf_counter() - t0
    assert elapsed < 15.0, f"suggest_error_bindings_by_channel took {elapsed:.1f}s at 401 columns"

"""P16 — Python port of errorLabelCandidates.ts / errorLabelClassify.ts's
own unit-test coverage: the structural token-list-independence invariant,
and the absolute ranking pins that a consistently-wrong ranking could
survive a before/after diff on (see errorLabelInvariant.test.ts's own
header for why both kinds of test exist).

Full label-to-binding parity against the TypeScript is covered by
test_error_inference_parity_fixture.py; this file locks in the internal
CANDIDATE/RANKING behaviour those bindings are built from.
"""

from __future__ import annotations

from quantized.io.error_inference import infer_error_bindings_from_labels
from quantized.io.error_label_candidates import (
    ERROR_TOKENS,
    flat_norm,
    generate_candidates,
    has_confirmed_candidate,
)
from quantized.io.error_label_classify import (
    classify_error_label,
    classify_error_label_in_labels,
    rank_candidates,
)

# "ose" is a real substring at the EDGE of exactly one ordinary base name in
# this corpus ("dose".endswith("ose")) and nowhere else -- see
# errorLabelInvariant.test.ts for the full rationale.
_INJECTED_TOKEN = "ose"
_INJECTED_TOKENS = (*ERROR_TOKENS, _INJECTED_TOKEN)

_ORDINARY_LABELS = [
    "Kerr", "Phase", "Noise", "Sensor", "Response", "Dose", "Pulse", "Base",
    "Use", "Series", "Second", "Depth", "Delay", "Density", "Set",
    "Temp (K)", "Intensity", "2theta", "Si", "O", "Depth (nm)",
    "NbAu-1", "NbAu-2", "Field", "Moment", "R", "M", "X", "Signal", "Time",
    "Voltage", "Current", "Frequency", "Amplitude", "Count", "Rate",
    "Length", "Width", "Height", "Mass", "Volume", "Pressure", "Angle",
]

_NEVER = [
    "Kerr", "Phase", "Noise", "Sensor", "Response", "Pulse", "Base",
    "Use", "Series", "Second", "Depth", "Delay", "Density", "Set",
]  # "Dose" deliberately excluded -- it is the legitimate exception below.


def test_injecting_an_unrelated_token_only_changes_the_one_label_it_legitimately_touches() -> None:
    changed = []
    for label in _ORDINARY_LABELS:
        before = classify_error_label(label, ERROR_TOKENS)
        after = classify_error_label(label, _INJECTED_TOKENS)
        if before != after:
            changed.append(label)
    assert changed == ["Dose"]


def test_the_legitimate_exception_changes_in_the_expected_direction() -> None:
    assert classify_error_label("Dose", ERROR_TOKENS) is None
    after = classify_error_label("Dose", _INJECTED_TOKENS)
    assert after is not None
    assert after.base == "d"


def test_noise_ends_in_ise_not_ose_and_stays_unaffected() -> None:
    assert not flat_norm("Noise").endswith("ose")
    assert classify_error_label("Noise", ERROR_TOKENS) is None
    assert classify_error_label("Noise", _INJECTED_TOKENS) is None


def test_never_classify_corpus_untouched_by_the_injected_token_with_a_sibling_present() -> None:
    for name in _NEVER:
        before = infer_error_bindings_from_labels(["T", "R", name])
        assert before == [], name
        before_injected = classify_error_label_in_labels(["T", "R", name], 2, ERROR_TOKENS)
        after_injected = classify_error_label_in_labels(["T", "R", name], 2, _INJECTED_TOKENS)
        assert before_injected == after_injected, name


def test_default_token_list_matches_explicit_error_tokens() -> None:
    for label in [*_ORDINARY_LABELS, "Ierr", "MStdErr", "M_std_err", "dR"]:
        assert generate_candidates(label) == generate_candidates(label, ERROR_TOKENS)
        assert classify_error_label(label) == classify_error_label(label, ERROR_TOKENS)


def test_ierr_top_ranked_candidate_is_confirmed_quantity_prefix_reading() -> None:
    ranked = rank_candidates(generate_candidates("Ierr"))
    assert ranked[0].token == "err"
    assert ranked[0].base == "i"
    assert ranked[0].confirmed is True


def test_mstderr_top_ranked_candidate_is_the_longer_token_stderr() -> None:
    ranked = rank_candidates(generate_candidates("MStdErr"))
    assert ranked[0].token == "stderr"
    assert ranked[0].base == "m"
    assert ranked[0].confirmed is True


def test_m_std_err_explicit_separators_ranks_identically_to_camelcase() -> None:
    ranked = rank_candidates(generate_candidates("M_std_err"))
    assert ranked[0].token == "stderr"
    assert ranked[0].base == "m"
    assert ranked[0].confirmed is True


def test_both_pins_resolve_through_full_selection() -> None:
    r1 = classify_error_label_in_labels(["2theta", "Intensity", "Ierr"], 2)
    assert r1 is not None and r1.base == "i"
    r2 = classify_error_label_in_labels(["M", "MStdErr"], 1)
    assert r2 is not None and r2.base == "m"


def test_confirmed_beats_provisional_even_when_provisional_token_is_longer() -> None:
    # "mstd" is one whole segment (no internal capital), so the run rule
    # only ever peels "err" off the end, CONFIRMED. The flat string
    # "mstderr" also happens to end in the strictly LONGER token "stderr",
    # but only reachable by an unaligned glued match, PROVISIONAL.
    ranked = rank_candidates(generate_candidates("Mstd_err"))
    assert ranked[0].token == "err"
    assert ranked[0].base == "mstd"
    assert ranked[0].confirmed is True


def test_longer_token_wins_even_when_the_table_lists_it_after_the_shorter_one() -> None:
    ranked = rank_candidates(generate_candidates("Sdev_X_err"))
    assert ranked[0].token == "sdev"
    assert ranked[0].base == "xerr"
    assert ranked[0].confirmed is True


def test_longer_base_wins_between_two_same_token_confirmed_candidates() -> None:
    ranked = rank_candidates(generate_candidates("X_err"))
    assert ranked[0].token == "err"
    assert ranked[0].base == "x"
    assert ranked[0].axis is None
    assert ranked[0].confirmed is True


def test_lexical_tiebreak_decides_between_two_same_length_confirmed_candidates() -> None:
    ranked = rank_candidates(generate_candidates("Err_Mid_Unc"))
    assert ranked[0].token == "unc"
    assert ranked[0].base == "errmid"
    assert ranked[0].confirmed is True


def test_has_confirmed_candidate_is_context_free() -> None:
    assert has_confirmed_candidate("dR") is True
    assert has_confirmed_candidate("Depth") is False
    # provisional-only ("Serr": glued "err", no aligned segment boundary)
    # does NOT count as confirmed -- it stays eligible as somebody else's
    # sibling evidence.
    assert has_confirmed_candidate("Serr") is False

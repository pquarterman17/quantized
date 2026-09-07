"""P16 — Python port of errorLabelOrdinaryNames.test.ts.

Locks in the behavioural claim that a bare "Depth"/"Density"/"Delay" (an
ordinary measurement column whose name merely STARTS with an
error-token-like prefix -- d- for delta, s- for sigma/std, e- for err) is
"all zero-candidate, so unaffected either way", checked at all three
layers, mirroring the TypeScript file's own rationale for doing so.
"""

from __future__ import annotations

from quantized.io.error_inference import infer_error_bindings_from_labels
from quantized.io.error_label_classify import (
    classify_error_label,
    classify_error_label_in_labels,
)

_ORDINARY = [
    "Depth", "Density", "Delay", "Deviation", "Delta", "Deg",
    "Sample", "Sensitivity", "Separation",
    "Temperature", "Energy", "Extinction",
]


def test_not_error_like_context_free() -> None:
    for name in _ORDINARY:
        assert classify_error_label(name) is None, name


def test_not_error_like_among_siblings() -> None:
    for name in _ORDINARY:
        labels = ["T", "R", name]
        assert classify_error_label_in_labels(labels, 2) is None, name


def test_survive_a_same_initial_sibling_that_could_look_like_their_base() -> None:
    assert classify_error_label_in_labels(["D", "Depth"], 1) is None
    assert classify_error_label_in_labels(["S", "Sample"], 1) is None
    assert classify_error_label_in_labels(["E", "Energy"], 1) is None


def test_bind_no_error_roles_end_to_end() -> None:
    for name in _ORDINARY:
        assert infer_error_bindings_from_labels(["T", "R", name]) == [], name
    assert infer_error_bindings_from_labels(["D", "Depth"]) == []


def test_still_detects_a_genuine_error_bar_alongside_them() -> None:
    """Guards the obvious way to make every assertion above pass for the
    wrong reason: a classifier that returns nothing for everything."""
    assert len(infer_error_bindings_from_labels(["Depth", "R", "Rerr"])) > 0
    assert classify_error_label("Rerr") is not None

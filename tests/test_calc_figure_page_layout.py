"""Unit tests for the pure figure-page layout math (calc.figure_page_layout),
split out of calc.figure_page for the 500-line ceiling (FIGURE_AUTHORING_
WORKFLOW_PLAN F3.5). No matplotlib objects here -- see test_calc_figure_page
for the rendered-figure-level assertions (sharex/sharey wiring, gridspec
spacing, align_labels)."""

from __future__ import annotations

import pytest

from quantized.calc.figure_page_layout import (
    LAYOUT_RESIZE_MODES,
    layout_engine_kwargs,
    share_targets,
    validate_layout,
)

# ── validate_layout ──────────────────────────────────────────────────────────


def test_validate_layout_accepts_defaults() -> None:
    validate_layout(None, None, "constrained")  # must not raise


def test_validate_layout_accepts_every_resize_mode() -> None:
    for mode in LAYOUT_RESIZE_MODES:
        validate_layout(0.2, 0.3, mode)


def test_validate_layout_rejects_unknown_resize_mode() -> None:
    with pytest.raises(ValueError, match="resize_mode"):
        validate_layout(None, None, "auto")


def test_validate_layout_rejects_negative_gap() -> None:
    with pytest.raises(ValueError, match="row_gap"):
        validate_layout(-0.1, None, "constrained")
    with pytest.raises(ValueError, match="col_gap"):
        validate_layout(None, -0.1, "constrained")


def test_validate_layout_rejects_absurd_gap() -> None:
    with pytest.raises(ValueError, match="row_gap"):
        validate_layout(100.0, None, "constrained")


def test_validate_layout_boundary_values_accepted() -> None:
    validate_layout(0.0, 10.0, "none")


# ── layout_engine_kwargs ─────────────────────────────────────────────────────


def test_constrained_default_omits_spacing_when_gaps_unset() -> None:
    engine, spacing = layout_engine_kwargs("constrained", None, None)
    assert engine == "constrained"
    assert spacing == {}


def test_constrained_passes_explicit_gaps_through() -> None:
    engine, spacing = layout_engine_kwargs("constrained", 0.1, 0.2)
    assert engine == "constrained"
    assert spacing == {"wspace": 0.2, "hspace": 0.1}


def test_none_mode_has_no_engine_but_passes_gaps() -> None:
    engine, spacing = layout_engine_kwargs("none", 0.1, 0.2)
    assert engine is None
    assert spacing == {"wspace": 0.2, "hspace": 0.1}


def test_tight_mode_ignores_explicit_gaps() -> None:
    engine, spacing = layout_engine_kwargs("tight", 0.1, 0.2)
    assert engine == "tight"
    assert spacing == {}


def test_partial_gap_only_sets_the_given_axis() -> None:
    _, spacing = layout_engine_kwargs("constrained", 0.5, None)
    assert spacing == {"hspace": 0.5}
    _, spacing2 = layout_engine_kwargs("constrained", None, 0.5)
    assert spacing2 == {"wspace": 0.5}


# ── share_targets ────────────────────────────────────────────────────────────


def test_share_targets_unlinked_is_all_none() -> None:
    assert share_targets(4, False) == [None, None, None, None]


def test_share_targets_linked_shares_every_panel_with_the_first() -> None:
    assert share_targets(4, True) == [None, 0, 0, 0]


def test_share_targets_single_panel_never_shares() -> None:
    assert share_targets(1, True) == [None]


def test_share_targets_zero_panels() -> None:
    assert share_targets(0, True) == []
    assert share_targets(0, False) == []

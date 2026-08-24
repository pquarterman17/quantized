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


# ── facet_mask (F4.4 follow-up, fix round 2, V3) ────────────────────────────
# A faceted panel's "axes" is an invisible cell-frame with no data scale
# (calc.figure_page_facets) -- it must never be a link source OR target, and
# the anchor every other (non-facet) panel links to must be the FIRST
# NON-FACET panel, not unconditionally index 0. Anchoring on index 0
# regardless of facet status was a placement-order bug: a facet panel FIRST
# in placement order made every OTHER pair of ordinary panels fail to link
# too, since the sole anchor (panel 0) was itself disqualified.


def test_share_targets_no_mask_is_byte_identical_to_before_facets_existed() -> None:
    # facet_mask omitted (None) must reproduce today's exact contract.
    assert share_targets(4, True) == [None, 0, 0, 0]
    assert share_targets(4, False) == [None, None, None, None]


def test_share_targets_facet_first_still_links_the_flat_siblings() -> None:
    # facet at index 0, two ordinary panels at 1 and 2 -- the anchor must be
    # index 1 (the first NON-facet panel), not index 0.
    assert share_targets(3, True, facet_mask=[True, False, False]) == [None, None, 1]


def test_share_targets_never_returns_a_facet_index_as_source_or_target() -> None:
    result = share_targets(4, True, facet_mask=[False, True, False, True])
    assert result[1] is None  # facet panel: never a target
    assert result[3] is None  # facet panel: never a target
    assert 1 not in result and 3 not in result  # facet panels: never an anchor


def test_share_targets_all_facet_panels_links_nothing() -> None:
    assert share_targets(3, True, facet_mask=[True, True, True]) == [None, None, None]


def test_share_targets_facet_mask_ignored_when_unlinked() -> None:
    assert share_targets(3, False, facet_mask=[True, False, False]) == [None, None, None]

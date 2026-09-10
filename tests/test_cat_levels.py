"""``quantized.cat_levels`` — when a transform invalidates a level table.

The pipeline-level consequences live in ``test_calc_corrections.py`` and
``test_calc_resample.py``; this file pins the predicate itself, including the
cases no correction happens to produce.
"""

from __future__ import annotations

import numpy as np

from quantized.cat_levels import surviving_cat_levels


def test_returns_none_when_there_was_no_table():
    before = np.array([[1.0, 0.0], [2.0, 1.0]])
    assert surviving_cat_levels(None, before, before) is None
    assert surviving_cat_levels({}, before, before) is None


def test_keeps_an_entry_whose_column_is_unchanged():
    before = np.array([[1.0, 0.0], [2.0, 1.0]])
    after = before.copy()
    assert surviving_cat_levels({1: ("a", "b")}, before, after) == {1: ("a", "b")}


def test_drops_an_entry_whose_column_moved():
    before = np.array([[1.0, 0.0], [2.0, 1.0]])
    after = np.array([[1.0, 0.5], [2.0, 1.5]])
    assert surviving_cat_levels({1: ("a", "b")}, before, after) is None


def test_is_PER_CHANNEL_not_all_or_nothing():
    """The property the pipeline can only demonstrate through one specific
    correction (the ``dq``-skipping footprint scale), asserted directly: moving
    channel 0 must not cost channel 2 its labels."""
    before = np.array([[1.0, 0.0, 0.0], [2.0, 1.0, 1.0]])
    after = np.array([[9.0, 0.5, 0.0], [9.0, 1.5, 1.0]])
    assert surviving_cat_levels({1: ("a", "b"), 2: ("x", "y")}, before, after) == {
        2: ("x", "y")
    }


def test_kept_rows_makes_a_TRIM_a_survival_not_a_change():
    """Without ``kept_rows`` the shape difference alone would look like a change,
    and a trim — which never touches a value — would lose its table."""
    before = np.array([[1.0, 0.0], [2.0, 1.0], [3.0, 0.0], [4.0, 1.0]])
    after = before[[1, 2], :]
    assert surviving_cat_levels({1: ("a", "b")}, before, after, [1, 2]) == {1: ("a", "b")}
    # And with the WRONG subset it correctly reports a change.
    assert surviving_cat_levels({1: ("a", "b")}, before, after, [0, 3]) is None


def test_a_shape_mismatch_it_cannot_explain_drops_everything():
    """Fail CLOSED: if the row counts still disagree after applying ``kept_rows``,
    the function cannot know what corresponds to what, so it keeps nothing."""
    before = np.array([[1.0, 0.0], [2.0, 1.0], [3.0, 0.0]])
    after = np.array([[1.0, 0.0], [2.0, 1.0]])
    assert surviving_cat_levels({1: ("a", "b")}, before, after) is None


def test_NaN_that_stays_NaN_is_not_a_change():
    """A NaN code is already unresolvable by ``level_of``, so a NaN that survives
    as a NaN does not change what the table can describe. Without ``equal_nan``
    every dataset with a missing category would lose its labels to any identity
    transform."""
    before = np.array([[1.0, 0.0], [2.0, np.nan]])
    after = before.copy()
    assert surviving_cat_levels({1: ("a", "b")}, before, after) == {1: ("a", "b")}


def test_a_NaN_that_appears_or_disappears_IS_a_change():
    before = np.array([[1.0, 0.0], [2.0, 1.0]])
    after = np.array([[1.0, 0.0], [2.0, np.nan]])
    assert surviving_cat_levels({1: ("a", "b")}, before, after) is None
    assert surviving_cat_levels({1: ("a", "b")}, after, before) is None


def test_an_out_of_range_channel_index_is_dropped_not_raised_on():
    """`datastruct.py`'s documented rule: coherence degrades at READ time. A
    table entry for a channel that does not exist cannot describe anything, and
    must not crash a correction."""
    before = np.array([[1.0, 0.0], [2.0, 1.0]])
    after = before.copy()
    assert surviving_cat_levels({5: ("a", "b")}, before, after) is None
    assert surviving_cat_levels({-1: ("a", "b")}, before, after) is None
    # A valid entry beside an invalid one still survives.
    assert surviving_cat_levels({1: ("a", "b"), 9: ("c",)}, before, after) == {
        1: ("a", "b")
    }


def test_zero_rows_is_treated_as_unchanged_rather_than_crashing():
    """An empty trim result has no code that contradicts the table. Nothing
    downstream can resolve a label either way, so this is a don't-care that must
    simply not raise."""
    before = np.array([[1.0, 0.0], [2.0, 1.0]])
    after = before[[], :]
    assert surviving_cat_levels({1: ("a", "b")}, before, after, []) == {1: ("a", "b")}

"""``quantized.cat_levels`` — when a transform invalidates a level table.

The pipeline-level consequences live in ``test_calc_corrections.py`` and
``test_calc_resample.py``; this file pins the predicate itself, including the
cases no correction happens to produce.
"""

from __future__ import annotations

import numpy as np

from quantized.cat_levels import surviving_cat_levels, surviving_level_order


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
    the function cannot know what corresponds to what, so it keeps nothing.

    Review LOW 6: the assertion below passes even without the explicit guard
    (``np.array_equal`` already returns False for different lengths), so the
    1-D case is asserted too — that IS the branch the guard exists for, and it
    is otherwise unreachable from the two call sites."""
    before = np.array([[1.0, 0.0], [2.0, 1.0], [3.0, 0.0]])
    after = np.array([[1.0, 0.0], [2.0, 1.0]])
    assert surviving_cat_levels({1: ("a", "b")}, before, after) is None
    # A 1-D input cannot be column-indexed at all; degrade rather than raise.
    assert surviving_cat_levels({0: ("a",)}, np.array([1.0, 2.0]), after) is None
    assert surviving_cat_levels({0: ("a",)}, before, np.array([1.0, 2.0, 3.0])) is None


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


def test_zero_rows_is_zero_EVIDENCE_not_full_survival():
    """Review MEDIUM 2 — the first version of this test asserted the OPPOSITE and
    called it a don't-care. Two empty columns compare equal, so an empty trim
    would have preserved every table, including one the same call had smoothed and
    differentiated. Under this module's own EVIDENCE principle, no rows means no
    evidence."""
    before = np.array([[1.0, 0.0], [2.0, 1.0]])
    after = before[[], :]
    assert surviving_cat_levels({1: ("a", "b")}, before, after, []) is None


def test_an_out_of_range_ROW_index_degrades_rather_than_raising():
    """Review LOW 10: an `IndexError` is not in routes/_errors.py's CALC_ERRORS,
    so it would be a 500 from a function whose contract is to degrade. Not
    reachable from `calc/corrections.py` (its indices come from `np.flatnonzero`
    over a full-length mask), but this is a public helper."""
    before = np.array([[1.0, 0.0], [2.0, 1.0]])
    after = before.copy()
    assert surviving_cat_levels({1: ("a", "b")}, before, after, [0, 99]) is None
    assert surviving_cat_levels({1: ("a", "b")}, before, after, [-1, 0]) is None


def test_level_order_survives_exactly_where_its_table_does():
    """Review MEDIUM 3: `level_order` names level CODES, so it is valid exactly
    when they are. Keyed off the `cat_levels` result so the two cannot drift."""
    assert surviving_level_order(None, {1: ("a", "b")}, True) is None
    assert surviving_level_order({1: (1, 0)}, {1: ("a", "b")}, True) == {1: (1, 0)}
    assert surviving_level_order({1: (1, 0)}, None, True) is None
    assert surviving_level_order({1: (1, 0)}, {2: ("a", "b")}, True) is None
    # Per channel, like its table.
    assert surviving_level_order({1: (1, 0), 2: (0, 1)}, {2: ("a", "b")}, True) == {
        2: (0, 1)
    }


def test_a_minus_one_level_order_follows_the_X_VALUES_not_a_table():
    """`-1` is the x/time column under the frontend's `-1 = x` convention and has
    no `cat_levels` entry to key off, so it survives only while x is unchanged."""
    assert surviving_level_order({-1: (1, 0)}, None, True) == {-1: (1, 0)}
    assert surviving_level_order({-1: (1, 0)}, None, False) is None
    assert surviving_level_order({-1: (1, 0)}, {1: ("a", "b")}, False) is None

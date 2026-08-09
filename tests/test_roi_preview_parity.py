"""Cross-boundary parity: the backend reproduces the frozen RSM preview
fixture (RSM_CUTS_PLAN item 5 — "Preview math + cross-boundary parity
harness").

Companion to ``frontend/src/lib/roiMath.golden.test.ts`` — both suites read
the SAME committed ``frontend/src/lib/roiMath.golden.json``; neither
regenerates it at run time (see ``tools/freeze_roi_preview_fixture.py``'s
module docstring). This side is the STALENESS GUARD: if
``calc/boxcut.py``/``calc/sectorcut.py``'s semantics ever change, THIS test
goes red until the freeze script is re-run and the new JSON is committed in
the same change — proving the fixture the frontend's live-preview mirror
(``frontend/src/lib/roiMath.ts``) is compared against is still what the
backend actually produces today, not a frozen memory of what it used to
produce. The vitest side is the actual drift check (does the client math
still agree); this side only keeps the ground truth honest.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from quantized.calc.boxcut import box_cut, box_stats
from quantized.calc.sectorcut import chi_profile, sector_profile
from quantized.datastruct import DataStruct

FIXTURE_PATH = Path(__file__).parent.parent / "frontend" / "src" / "lib" / "roiMath.golden.json"

_FN_TABLE: dict[str, Callable[..., Any]] = {
    "box_cut": box_cut,
    "box_stats": box_stats,
    "sector_profile": sector_profile,
    "chi_profile": chi_profile,
}
# box_cut/sector_profile/chi_profile return a DataStruct; box_stats returns a
# plain scalar dict (it has no grid path — see calc/boxcut.py's docstring).
_DATASTRUCT_FNS = {"box_cut", "sector_profile", "chi_profile"}


def _load_fixture() -> dict[str, Any]:
    with FIXTURE_PATH.open(encoding="utf-8") as f:
        result: dict[str, Any] = json.load(f)
    return result


FIXTURE = _load_fixture()
RTOL = float(FIXTURE["rtol"])
CASE_NAMES = sorted(FIXTURE["cases"])


def test_fixture_is_committed_and_non_empty() -> None:
    """Guards against the fixture silently going missing/empty — every other
    test in this file would otherwise pass vacuously (an empty parametrize
    list runs zero tests, not a failure)."""
    assert FIXTURE_PATH.is_file()
    assert FIXTURE["cases"]
    assert FIXTURE["datasets"]


def test_fixture_declares_only_dispatchable_functions() -> None:
    """A case whose 'fn' isn't in ``_FN_TABLE`` would silently never run
    (pytest.mark.parametrize can't catch a KeyError before collection) — this
    is the tripwire for a typo in ``tools/freeze_roi_preview_fixture.py``."""
    used_fns = {case["fn"] for case in FIXTURE["cases"].values()}
    assert used_fns <= set(_FN_TABLE)


@pytest.mark.parametrize("case_name", CASE_NAMES)
def test_backend_reproduces_frozen_case(case_name: str) -> None:
    case = FIXTURE["cases"][case_name]
    fn = _FN_TABLE[case["fn"]]
    ds = DataStruct.from_dict(FIXTURE["datasets"][case["dataset"]])
    result = fn(ds, **case["params"])
    expected = case["output"]

    if case["fn"] in _DATASTRUCT_FNS:
        assert isinstance(result, DataStruct)
        np.testing.assert_allclose(result.time, expected["time"], rtol=RTOL)
        np.testing.assert_allclose(result.values, expected["values"], rtol=RTOL)
        assert list(result.labels) == expected["labels"]
        assert list(result.units) == expected["units"]
    else:
        assert isinstance(result, dict)
        assert set(result) == set(expected)
        for key, exp_val in expected.items():
            got = result[key]
            if isinstance(exp_val, float):
                assert got == pytest.approx(exp_val, rel=RTOL)
            else:
                assert got == exp_val

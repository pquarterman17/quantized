"""P1.7 PR 5 audit item 2 — cross-language parity for the bundle-relative
path containment rule.

``quantized.portable.layout.is_bundle_relative`` and
``frontend/src/lib/bundlePath.ts``'s ``isBundleRelativePath`` are two
independently hand-maintained ports of the SAME rule (same doc, same
rule-by-rule breakdown) — nothing in the toolchain enforces that they agree.
This test and its vitest counterpart
(``frontend/src/lib/bundlePath.fixture.test.ts``) both consume the single
shared fixture ``tests/fixtures/portable/bundle_paths.json`` so a change to
one side that is not mirrored on the other fails on ITS OWN suite, rather
than only being caught by memory or by a reviewer manually diffing two
hand-written test files.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from quantized.portable.layout import is_bundle_relative

FIXTURE_PATH = (
    Path(__file__).resolve().parent / "fixtures" / "portable" / "bundle_paths.json"
)


def _load_cases() -> list[dict[str, object]]:
    with open(FIXTURE_PATH, encoding="utf-8") as f:
        data = json.load(f)
    cases = data["cases"]
    assert isinstance(cases, list) and cases, "fixture must carry at least one case"
    return cases


@pytest.mark.parametrize(
    "case",
    _load_cases(),
    ids=[str(c["note"]) for c in _load_cases()],
)
def test_is_bundle_relative_matches_the_shared_fixture(case: dict[str, object]) -> None:
    path = case["path"]
    accept = case["accept"]
    assert isinstance(path, str)
    assert isinstance(accept, bool)
    assert is_bundle_relative(path) is accept, (
        f"is_bundle_relative({path!r}) should be {accept!r} per the shared "
        f"fixture ({case.get('note')!r}) -- check bundlePath.ts stayed in sync"
    )


def test_fixture_has_both_accepted_and_rejected_cases() -> None:
    """A fixture that only ever tested one outcome would not actually catch
    a drift in the other direction."""
    cases = _load_cases()
    accepts = [c for c in cases if c["accept"] is True]
    rejects = [c for c in cases if c["accept"] is False]
    assert accepts, "fixture must include at least one accepted path"
    assert rejects, "fixture must include at least one rejected path"

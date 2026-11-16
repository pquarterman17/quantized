"""Ratchet on the Origin import quality over the committed plot corpus.

Plan item 8 of ``plans/ORIGIN_PLOT_TYPE_PARITY_PLAN.md``. Scores every specimen
in ``../test-data/origin/generated`` (built by Origin itself, see that
folder's README) with ``tools/plot_corpus/score_import.py`` and asserts:

* no ``wrong`` and no ``phantom`` cell in any check (worse than omitted);
* every check's ``match`` count equals its pinned floor: below is a
  regression, above means the import improved and the pin must be RAISED.

Auto-skips when the private corpus is absent (CI).
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools" / "plot_corpus"))

import score_import  # noqa: E402
import score_report  # noqa: E402

FLOOR = json.loads(
    (ROOT / "tests" / "fixtures" / "plot_corpus" / "import_floor.json").read_text("utf-8")
)


@pytest.mark.realdata
def test_import_quality_ratchet(corpus_dir: Path) -> None:
    corpus = corpus_dir / "origin" / "generated"
    if not (corpus / "manifest.json").is_file():
        pytest.skip("../test-data/origin/generated not present")
    specimens = score_import.score_import(corpus, corpus / "_families")
    errors = [
        f"{s['type']}/{s['family']}: {s.get('reason')}"
        for s in specimens
        if s.get("status") == "import_error"
    ]
    assert not errors, f"specimens failed to import: {errors}"
    scored = [s for s in specimens if s.get("status") != "not_built"]

    totals: dict[str, Counter[str]] = {}
    for s in scored:
        for check, counts in score_report.tally(s).items():
            totals.setdefault(check, Counter()).update(counts)

    bad = {
        c: {k: n for k, n in t.items() if k in {"wrong", "phantom"} and n}
        for c, t in totals.items()
    }
    bad = {c: v for c, v in bad.items() if v}
    assert not bad, f"wrong/phantom cells (omit and record a reason instead): {bad}"

    assert len(scored) >= FLOOR["scored_specimens"], (
        f"only {len(scored)} specimens scored, floor {FLOOR['scored_specimens']}"
    )
    got = {c: totals.get(c, Counter())["match"] for c in FLOOR["match"]}
    low = {c: (got[c], f) for c, f in FLOOR["match"].items() if got[c] < f}
    assert not low, f"import match counts fell below the pinned floors (got, floor): {low}"

    risen = {c: (got[c], f) for c, f in FLOOR["match"].items() if got[c] > f}
    assert not risen, (
        "import quality IMPROVED: RAISE the pins in "
        "tests/fixtures/plot_corpus/import_floor.json to the new counts "
        f"(pins only move up). (now, floor): {risen}"
    )

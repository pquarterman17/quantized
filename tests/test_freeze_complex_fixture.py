"""The committed complex-formula oracle is exactly what its generator computes.

``tools/freeze_complex_fixture.py`` derives every expected value from Python's
``cmath`` (cross-checked with numpy); ``frontend/src/lib/formulaComplex.test.ts``
compares the app's evaluator against the committed JSON. This pins that the JSON
was not hand-edited and is not stale against the generator.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_committed_fixture_matches_the_generator() -> None:
    tool = ROOT / "tools" / "freeze_complex_fixture.py"
    spec = importlib.util.spec_from_file_location("freeze_complex_fixture", tool)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    fresh = json.loads(json.dumps(module.build()))
    path = ROOT / "frontend" / "src" / "lib" / "__fixtures__" / "formulaComplex.json"
    committed = json.loads(path.read_text(encoding="utf-8"))
    assert fresh == committed

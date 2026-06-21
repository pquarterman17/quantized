"""Shared pytest fixtures + golden helpers.

Golden cases compare a Python parse against frozen quantized_matlab output
(committed under tests/golden/). The corpus fixtures are committed under
tests/fixtures/ so the parity tests run in CI without MATLAB.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

TESTS_DIR = Path(__file__).parent
FIXTURES = TESTS_DIR / "fixtures"
GOLDEN = TESTS_DIR / "golden"


@pytest.fixture
def fixtures_dir() -> Path:
    return FIXTURES


@pytest.fixture
def load_golden() -> Callable[[str], dict[str, Any]]:
    def _load(name: str) -> dict[str, Any]:
        path = GOLDEN / name
        if not path.exists():
            pytest.skip(f"golden file missing: {name} (run tools/matlab/freeze_reference_values.m)")
        return json.loads(path.read_text(encoding="utf-8"))

    return _load

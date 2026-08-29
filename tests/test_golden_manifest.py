"""Integrity checks for campaign-level golden-fixture provenance."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

GOLDEN_DIR = Path(__file__).parent / "golden"


def test_diraculator_campaign_manifest_covers_every_fixture() -> None:
    manifest = json.loads((GOLDEN_DIR / "manifest.json").read_text(encoding="utf-8"))
    campaign: dict[str, Any] = manifest["campaigns"]["diraculator_w4"]
    fixtures = sorted(GOLDEN_DIR.glob(campaign["fixtures"]))

    assert len(fixtures) == campaign["case_count"] == 94
    assert campaign["source_repo"] == "../quantized_matlab"
    assert campaign["source_commit"] == "aee70d12ddd13024a33ac8d29fafbd3245442c7e"
    assert campaign["freeze_script"] == "tools/matlab/freeze_diraculator_values.m"
    assert campaign["rtol"] == 1e-9
    assert campaign["atol"] == 1e-12

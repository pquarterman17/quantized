"""An exported script reproduces a worksheet with complex formulas (plan item 33).

``frontend/src/components/workshops/pipeline/pipelineComplexRoundTrip.test.ts``
replays one recorded pipeline in the app and pins its worksheet and the
exported script in ``tests/fixtures/wire/pipeline_complex_round_trip.json``.
The script runs here, headless, on the same CSV; its cells must be the app's.
"""

from __future__ import annotations

import csv
import json
import math
import subprocess
import sys
from pathlib import Path

import numpy as np

FIXTURE = Path(__file__).parent / "fixtures" / "wire" / "pipeline_complex_round_trip.json"


def test_the_exported_script_gives_the_apps_cells(tmp_path: Path) -> None:
    fx = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert "NOT REPRODUCED" not in fx["script"]
    (tmp_path / "z.csv").write_text(fx["csv"], encoding="utf-8")
    script = tmp_path / "pipeline.py"
    script.write_text(fx["script"], encoding="utf-8")
    run = subprocess.run(
        [sys.executable, str(script), "z.csv", "--out", "o.csv"],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        timeout=300,
        check=False,
    )
    assert run.returncode == 0, run.stderr
    rows = list(csv.reader((tmp_path / "o.csv").read_text(encoding="utf-8-sig").splitlines()))
    assert rows[0][1:] == fx["app"]["labels"]
    got = np.asarray([[float(c) if c.strip() else math.nan for c in r] for r in rows[1:]], float)
    want = np.asarray(
        [[math.nan if v == "NaN" else v for v in row] for row in fx["app"]["values"]], float
    )
    np.testing.assert_allclose(got[:, 0], fx["app"]["time"], rtol=1e-12)
    np.testing.assert_allclose(got[:, 1:], want, rtol=1e-12, atol=1e-12, equal_nan=True)
    assert np.isnan(got[:, -1]).all()  # the complex RESULT column: blank in both
    assert np.isfinite(got[:, 1:-1]).all()

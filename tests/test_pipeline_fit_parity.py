"""The app's "Run pipeline" and the exported Python script give the SAME fit
(gap audit 4 lane E re-review, M2).

``frontend/src/lib/__fixtures__/pipelineFitParity.json`` holds, for one
recorded pipeline (an import and a Gaussian fit with user starts, bounds and a
held σ): the data as CSV, the request the app's replay (``executeSteps``)
sends to ``POST /api/fitting/fit``, and the script the exporter writes
(``components/workshops/pipeline/pipelineFitParity.test.ts`` pins both). This
runs the script, posts the app's request to the real endpoint, and requires
the same parameters -- with σ held where the user held it.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.auth import TOKEN_HEADER

FIXTURE = (
    Path(__file__).resolve().parents[1]
    / "frontend"
    / "src"
    / "lib"
    / "__fixtures__"
    / "pipelineFitParity.json"
)


def test_run_pipeline_and_the_script_fit_the_same_parameters(tmp_path: Path) -> None:
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    (tmp_path / "peak.csv").write_text(fixture["csv"], encoding="utf-8")
    script = tmp_path / "pipeline.py"
    script.write_text(fixture["script"], encoding="utf-8")
    run = subprocess.run(
        [sys.executable, str(script), "peak.csv", "--out", "o.csv"],
        cwd=tmp_path, capture_output=True, text=True, timeout=300, check=False,
    )  # fmt: skip
    assert run.returncode == 0, run.stderr
    line = next(ln for ln in run.stdout.splitlines() if ln.startswith("2. Fit Gaussian: "))
    printed = [float(v) for v in re.findall(r"=([-0-9.e+]+)", line.split("  R2=")[0])]

    client = TestClient(app)
    reply = client.post(
        "/api/fitting/fit",
        json=fixture["request"],
        headers={TOKEN_HEADER: app.state.api_token},
    )
    assert reply.status_code == 200, reply.text
    in_app = reply.json()["params"]
    assert printed == pytest.approx(in_app, rel=1e-5)
    assert in_app[2] == 0.6  # σ held at the user's value in both
    assert f"R2={reply.json()['R2']:.6g}" in line

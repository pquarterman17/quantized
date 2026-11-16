"""The exported script and ``qz run`` reproduce the app's pipeline NUMBERS
(gap audit 5 #6): formula columns, a background subtraction and a signal
transform, end to end.

One recorded pipeline -- import, median filter (a ``sigop`` transform), a
formula column, corrections with a background subtraction, a second formula
reading the first -- runs three ways:

1. in the app: ``components/workshops/pipeline/pipelineRoundTrip.test.ts``
   replays it with the real ``executeSteps`` (the app's store, its formula
   evaluator, its recompute-after-correction rule). Its two backend calls are
   answered from ``pipelineRoundTripBackend.json``, which THIS module writes
   from the real endpoints and re-checks below (so the stand-in is the
   server's answer, byte for byte). The app's final worksheet, the requests it
   sent, the exported script and the saved template are pinned in
   ``pipelineRoundTrip.json``;
2. the exported script, run here on the same two CSV files;
3. ``qz run`` on the saved template.

Both headless runs must give the app's worksheet. Rewrite the backend file
with ``QZ_WRITE_FIXTURES=1 uv run pytest tests/test_pipeline_round_trip.py``,
then the app fixture with ``QZ_WRITE_FIXTURES=1 npx vitest run
src/components/workshops/pipeline/pipelineRoundTrip.test.ts``.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

import quantized.api as qz
from quantized.app import app
from quantized.auth import TOKEN_HEADER
from quantized.cli_run import run_command

FIX = Path(__file__).resolve().parents[1] / "frontend" / "src" / "lib" / "__fixtures__"
BACKEND = FIX / "pipelineRoundTripBackend.json"
APP = FIX / "pipelineRoundTrip.json"

#: The pipeline's backend calls, as the app records them (the vitest uses the same).
SIGOP = {"method": "median", "channels": [0, 1], "args": {"window": 3}}
CORRECTION = {"params": {"yOff": 0.5, "yScale": 2}, "bg_interp": "linear"}


def _csvs() -> tuple[str, str]:
    x = [i * 0.5 for i in range(20)]
    a = [round(3 + ((i * 7) % 5) * 0.25 - 0.01 * i, 6) for i in range(20)]
    b = [round(2 + 0.1 * i, 6) for i in range(20)]
    data = "x,a,b\n" + "".join(f"{p!r},{q!r},{r!r}\n" for p, q, r in zip(x, a, b, strict=True))
    bg = "x,bg\n" + "".join(f"{float(i)!r},{round(0.5 + 0.01 * i, 6)!r}\n" for i in range(11))
    return data, bg


def _post(client: TestClient, path: str, body: dict[str, Any]) -> dict[str, Any]:
    r = client.post(path, json=body, headers={TOKEN_HEADER: app.state.api_token})
    assert r.status_code == 200, r.text
    out: dict[str, Any] = r.json()
    return out


def _wire(ds: qz.DataStruct) -> dict[str, Any]:
    return {"time": ds.time.tolist(), "values": ds.values.tolist(), "labels": list(ds.labels),
            "units": list(ds.units), "metadata": {}}  # fmt: skip


def _backend(tmp_path: Path) -> dict[str, Any]:
    data_csv, bg_csv = _csvs()
    (tmp_path / "data.csv").write_text(data_csv, encoding="utf-8")
    (tmp_path / "bg.csv").write_text(bg_csv, encoding="utf-8")
    data, bg = qz.load(tmp_path / "data.csv"), qz.load(tmp_path / "bg.csv")
    client = TestClient(app)
    sig = _post(client, "/api/transform/sigop", {"dataset": _wire(data), **SIGOP})["dataset"]
    corrected = _post(
        client, "/api/corrections/apply", {"dataset": sig, "bg_dataset": _wire(bg), **CORRECTION}
    )
    strip = {"metadata": {}}
    return {
        "csv": data_csv,
        "bgCsv": bg_csv,
        "sigop": {**sig, **strip},
        "corrected": {**corrected, **strip},
    }


def test_the_app_stand_in_is_the_real_backend(tmp_path: Path) -> None:
    fresh = _backend(tmp_path)
    if os.environ.get("QZ_WRITE_FIXTURES") == "1":
        BACKEND.write_text(json.dumps(fresh, indent=1) + "\n", encoding="utf-8")
    pinned = json.loads(BACKEND.read_text(encoding="utf-8"))
    assert pinned["csv"] == fresh["csv"] and pinned["bgCsv"] == fresh["bgCsv"]
    for key in ("sigop", "corrected"):
        assert pinned[key]["labels"] == fresh[key]["labels"]
        np.testing.assert_allclose(pinned[key]["values"], fresh[key]["values"], rtol=1e-15)
        np.testing.assert_allclose(pinned[key]["time"], fresh[key]["time"], rtol=1e-15)


def test_the_app_sent_what_the_backend_answered_for() -> None:
    """The requests the app's replay captured carry the CSV's numbers (sigop)
    and the sigop answer plus the background (corrections)."""
    app_fx = json.loads(APP.read_text(encoding="utf-8"))
    backend = json.loads(BACKEND.read_text(encoding="utf-8"))
    sent_sig, sent_corr = app_fx["requests"]["sigop"], app_fx["requests"]["corrections"]
    assert {k: sent_sig[k] for k in SIGOP} == SIGOP
    np.testing.assert_array_equal(sent_corr["dataset"]["values"], backend["sigop"]["values"])
    assert sent_corr["params"] == CORRECTION["params"] and sent_corr["bg_interp"] == "linear"


def _check(path: Path, app_data: dict[str, Any]) -> None:
    # The header row as written (reading it back would take "median(3)" for a unit).
    header = path.read_text(encoding="utf-8-sig").splitlines()[0].split(",")
    assert header[1:] == app_data["labels"]
    out = qz.load(path)
    np.testing.assert_allclose(out.time, app_data["time"], rtol=1e-12)
    np.testing.assert_allclose(out.values, app_data["values"], rtol=1e-12, atol=1e-12)


@pytest.fixture
def inputs(tmp_path: Path) -> Path:
    fx = json.loads(APP.read_text(encoding="utf-8"))
    (tmp_path / "data.csv").write_text(fx["csv"], encoding="utf-8")
    (tmp_path / "bg.csv").write_text(fx["bgCsv"], encoding="utf-8")
    return tmp_path


def test_the_exported_script_gives_the_apps_numbers(inputs: Path) -> None:
    fx = json.loads(APP.read_text(encoding="utf-8"))
    assert "NOT REPRODUCED" not in fx["script"]
    script = inputs / "pipeline.py"
    script.write_text(fx["script"], encoding="utf-8")
    run = subprocess.run(
        [sys.executable, str(script), "data.csv", "--background", "bg.csv", "--out", "o.csv"],
        cwd=inputs, capture_output=True, text=True, timeout=300, check=False,
    )  # fmt: skip
    assert run.returncode == 0, run.stderr
    _check(inputs / "o.csv", fx["app"])


def test_qz_run_gives_the_apps_numbers_from_the_saved_template(inputs: Path) -> None:
    fx = json.loads(APP.read_text(encoding="utf-8"))
    (inputs / "recipe.json").write_text(fx["template"], encoding="utf-8")
    code = run_command(
        [str(inputs / "recipe.json"), str(inputs / "data.csv"), "--background",
         str(inputs / "bg.csv"), "--out", str(inputs / "out")]
    )  # fmt: skip
    assert code == 0
    _check(inputs / "out" / "data - Round trip.csv", fx["app"])

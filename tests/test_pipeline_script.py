"""The exported pipeline script RUNS (origin gap audit 4, G4).

``frontend/src/lib/__fixtures__/pipelineScript.py`` is the frontend
generator's output (``pipelineToPython`` in ``lib/pipeline.ts``;
``lib/pipelinePython.test.ts`` pins the bytes). The old export was
``qz.setShowGrid(true)``-style lines that nothing could run. This executes
the committed script in a fresh interpreter, end to end, on a fixture file,
and checks that it reproduces the mapped steps exactly (the corrections
through ``quantized.api.apply_corrections``, the fit through ``fit_model``)
and that it did NOT run the steps it cannot reproduce.
"""

from __future__ import annotations

import runpy
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

import quantized.api as qz

SCRIPT = (
    Path(__file__).resolve().parents[1]
    / "frontend"
    / "src"
    / "lib"
    / "__fixtures__"
    / "pipelineScript.py"
)


def _peak_csv(path: Path) -> tuple[np.ndarray, np.ndarray]:
    x = np.round(np.linspace(0.0, 10.0, 101), 10)
    y = 4.0 + 80.0 * np.exp(-0.5 * ((x - 5.0) / 0.7) ** 2)
    rows = "\n".join(f"{float(a)!r},{float(b)!r}" for a, b in zip(x, y, strict=True))
    path.write_text("x,signal\n" + rows + "\n", encoding="utf-8")
    return x, y


def test_the_recorded_name_keeps_its_quotes_and_newline() -> None:
    """The fixture's recorded input name and fit label carry ``"`` and a
    newline: they must stay inside their Python literals."""
    module = runpy.run_path(str(SCRIPT))  # defines, does not run main()
    assert module["RECORDED_INPUTS"] == ['peak "run 1"\n.csv']


def test_generated_script_runs_end_to_end(tmp_path: Path) -> None:
    _peak_csv(tmp_path / "peak.csv")
    run = subprocess.run(
        [sys.executable, str(SCRIPT), "peak.csv", "--out", "result.csv"],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        timeout=300,
        check=False,
    )
    assert run.returncode == 0, run.stderr
    # The data the app would have after steps 1-2. Step 6, a row deletion the
    # app records as a "ui" step, is not reproducible, so the correction at
    # step 7 must not run (gap audit 4 lane E review, H5).
    expected = qz.apply_corrections(qz.load(tmp_path / "peak.csv"), {"yOff": -2, "yScale": 0.5})
    got = qz.load(tmp_path / "result.csv")
    np.testing.assert_allclose(got.time, expected.time)  # no xOff=1 from step 7
    np.testing.assert_allclose(got.column(0), expected.column(0), rtol=1e-12)
    assert got.labels == expected.labels

    # The fit ran on the recorded window, on the corrected data.
    # The label prints over two lines: its newline is data, not code.
    lines = run.stdout.splitlines()
    assert '4. Fit "Gaussian"' in lines
    fit_line = lines[lines.index('4. Fit "Gaussian"') + 1]
    assert fit_line.startswith("window: ")
    x, y = expected.time, expected.column(0)
    keep = (x >= 2) & (x <= 8)
    # ... with the recorded user starts, bounds and HELD σ (M5): the free fit
    # gives σ ≈ 0.82, so a script that dropped the recorded holds prints
    # another σ, R² and amplitude (re-review L7).
    ref = qz.fit_model(
        "Gaussian",
        x[keep],
        y[keep],
        p0=[30, 5.2, 1],
        lower=[0, None, 0.01],
        upper=[None, None, None],
        fixed=[False, False, True],
    )
    free = qz.fit_model("Gaussian", x[keep], y[keep])
    assert abs(free["params"][2] - 1.0) > 0.1 and ref["params"][2] == 1.0
    assert ", σ=1  R2=" in fit_line
    assert f"R2={ref['R2']:.6g}" in fit_line
    assert f"R2={free['R2']:.6g}" not in fit_line
    assert abs(ref["params"][1] - 5.0) < 1e-6  # the peak centre, on the corrected data
    assert "note: step 4" not in run.stdout  # 61 points, as recorded
    assert "steps from 6 on were NOT reproduced" in run.stdout


def test_generated_script_refuses_the_wrong_number_of_inputs(tmp_path: Path) -> None:
    run = subprocess.run(
        [sys.executable, str(SCRIPT), "a.csv", "b.csv"],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        timeout=300,
        check=False,
    )
    assert run.returncode == 2
    assert "give 1 input file(s)" in run.stderr


@pytest.mark.parametrize("field", ["p0", "lower", "upper", "fixed"])
def test_fit_model_refuses_lists_of_the_wrong_length(field: str) -> None:
    """A step edited from Gaussian to Linear must not fit 3 parameters to a
    2-parameter model (re-review M1)."""
    x = np.linspace(0.0, 1.0, 11)
    value = {"p0": [1.0, 0.0, 1.0], "lower": [0, 0, 0], "upper": [9, 9, 9], "fixed": [False] * 3}
    with pytest.raises(ValueError, match=f"{field} has 3 entries but Linear has 2"):
        qz.fit_model("Linear", x, 2 * x, **{field: value[field]})  # type: ignore[arg-type]


def test_fit_model_refuses_a_held_start_outside_its_bounds() -> None:
    """As ``POST /api/fitting/fit`` does (review L3): a clipped start would be
    reported as held while it is not."""
    x = np.linspace(0.0, 1.0, 11)
    with pytest.raises(ValueError, match="held"):
        qz.fit_model(
            "Linear", x, 2 * x, p0=[5, 0], lower=[0, 0], upper=[1, 10], fixed=[True, False]
        )
    fit = qz.fit_model("Linear", x, 2 * x + 1, p0=[1, 0], lower=[None, None], upper=[None, None])
    np.testing.assert_allclose(fit["params"], [2.0, 1.0], rtol=1e-8)


def test_fit_model_fits_a_registry_model_by_name() -> None:
    x = np.linspace(-5.0, 5.0, 201)
    y = 50.0 * np.exp(-0.5 * ((x - 0.4) / 0.9) ** 2)
    fit = qz.fit_model("Gaussian", x, y)
    assert fit["paramNames"] == ["A", "μ", "σ"]
    np.testing.assert_allclose(fit["params"][1:], [0.4, 0.9], rtol=1e-6)

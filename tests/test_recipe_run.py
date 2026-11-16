"""``qz run`` and ``quantized.recipe_run`` (gap audit 5 #6): a template saved
in the app re-runs headless on new files, refusing what it cannot replay
exactly. The numbers against the APP are pinned by
``tests/test_pipeline_round_trip.py``; this covers the runner's own rules."""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import pytest

import quantized.api as qz
from quantized.cli import main
from quantized.cli_run import run_command
from quantized.recipe_run import extract_outputs, parse_recipe, recipe_problems, run_recipe


def _step(
    kind: str, label: str, params: dict[str, Any], code: str = "", **extra: Any
) -> dict[str, Any]:
    return {
        "id": "",
        "kind": kind,
        "label": label,
        "code": code,
        "params": params,
        "enabled": True,
        **extra,
    }


def _recipe(*steps: dict[str, Any], outputs: list[str] | None = None) -> str:
    return json.dumps(
        {"version": 1, "name": "Peak", "steps": list(steps), "outputs": outputs or []}
    )


FIT = _step("fit", "Fit Gaussian", {"model": "Gaussian", "yKey": 0, "xKey": None, "p0": None})


def _peak(path: Path, centre: float) -> None:
    x = np.round(np.linspace(0.0, 10.0, 101), 10)
    y = 2.0 + 40.0 * np.exp(-0.5 * ((x - centre) / 0.8) ** 2)
    path.write_text(
        "x,signal\n" + "".join(f"{float(a)!r},{float(b)!r}\n" for a, b in zip(x, y, strict=True)),
        "utf-8",
    )


def test_parse_refuses_what_the_app_refuses() -> None:
    for text, msg in [
        ("{", "bad JSON"),
        (json.dumps({"version": 2, "name": "x", "steps": []}), "version"),
        (json.dumps({"version": 1, "name": " ", "steps": []}), "name"),
        (json.dumps({"version": 1, "name": "x", "steps": [{"kind": "warp"}]}), "malformed"),
    ]:
        with pytest.raises(ValueError, match=msg):
            parse_recipe(text)
    r = parse_recipe(_recipe(FIT, outputs=["A", 3, "R2"]))  # type: ignore[list-item]
    assert r.name == "Peak" and r.outputs == ("A", "R2")


def test_every_unreplayable_step_is_listed_up_front() -> None:
    steps = [
        _step("expression", "Add column t", {"name": "t", "expr": "if(A > 0, A, 0)"}),
        _step("expression", "Add column u", {"name": "u", "expr": "A*2", "derived": True}),
        _step(
            "correction",
            "Corrections",
            {"params": {}, "bg": {"datasetId": "d", "interp": "linear"}},
        ),
        _step("fit", "Weighted", {"model": "Linear", "yKey": 0, "weight": {"mode": "column"}}),
        _step("fit", "Template", {"model": "Linear", "fitTemplate": {}}),
        _step("transform", "Join", {"op": "join"}),
        _step("transform", "Resample", {"op": "resample", "mode": "match"}),
        {**_step("transform", "Off", {"op": "join"}), "enabled": False},
        _step(
            "transform", "Median", {"op": "sigop", "method": "median", "channels": [0], "args": {}}
        ),
    ]
    probs = recipe_problems(parse_recipe(_recipe(*steps)))
    assert [p.split(" (")[0] for p in probs] == [f"step {n}" for n in range(1, 8)]
    assert "--background" in probs[2]
    assert len(recipe_problems(parse_recipe(_recipe(*steps)), has_background=True)) == 6
    with pytest.raises(ValueError, match="cannot run headless"):
        run_recipe(parse_recipe(_recipe(*steps)), qz.DataStruct.create([0.0], [1.0]))


def test_run_replays_formulas_corrections_and_the_fit() -> None:
    x = np.linspace(0.0, 10.0, 101)
    data = qz.DataStruct.create(x, 2.0 + 40.0 * np.exp(-0.5 * ((x - 4.0) / 0.8) ** 2), labels=["s"])
    steps = [
        _step("import", "Import a.csv", {"name": "a.csv"}),
        _step("expression", "Add column t", {"name": "t", "expr": "A * 2"}),
        _step("expression", "Edit column t", {"name": "t", "expr": "A * 3"}),
        _step("correction", "Corrections", {"params": {"yOff": 2}, "bg": None}),
        _step("ui", "Sort", {}, code='qz.sortRows("d", 0, "asc")'),
        _step("ui", "Log", {}, code='qz.setYScale("log")'),
        FIT,
    ]
    run = run_recipe(parse_recipe(_recipe(*steps)), data)
    assert run.data.labels == ("s", "t")  # the edit replaced the formula
    np.testing.assert_allclose(run.data.column(1), 3 * (data.column(0) - 2))  # recomputed after
    assert len(run.warnings) == 1 and "not replayed" in run.warnings[0]
    ((label, fit),) = run.fits
    assert label == "7. Fit Gaussian" and fit["params"][1] == pytest.approx(4.0, abs=1e-6)
    assert extract_outputs(["A", "μ", "σ", "R2"], fit)[3] == fit["R2"]
    assert all(math.isnan(v) for v in extract_outputs(["A", "R2"], None))


def test_a_failing_step_names_itself() -> None:
    steps = [_step("expression", "Add column t", {"name": "t", "expr": "Q + 1"})]
    with pytest.raises(ValueError, match=r"1\. Add column t failed: unknown variable"):
        run_recipe(parse_recipe(_recipe(*steps)), qz.DataStruct.create([0.0, 1.0], [1.0, 2.0]))


def test_qz_run_writes_data_summary_figures_and_report(tmp_path: Path) -> None:
    _peak(tmp_path / "a.csv", 4.0)
    _peak(tmp_path / "b.csv", 6.0)
    (tmp_path / "broken.csv").write_text("", "utf-8")  # unreadable
    (tmp_path / "r.json").write_text(_recipe(FIT, outputs=["A", "μ", "σ", "R2"]), "utf-8")
    out = tmp_path / "out"
    args = [
        str(tmp_path / "r.json"),
        str(tmp_path / "*.csv"),
        "--out",
        str(out),
        "--figures",
        "pdf",
    ]
    assert run_command(args) == 1  # broken.csv fails, the others still run
    report = json.loads((out / "run-report.json").read_text("utf-8"))
    assert [e["status"] for e in report["inputs"]] == ["ok", "ok", "failed"]
    assert (out / "a - Peak.csv").exists() and (out / "b - Peak.pdf").read_bytes()[:5] == b"%PDF-"
    summary = qz.load(out / "Peak summary.csv")
    np.testing.assert_allclose(summary.column(1)[:2], [4.0, 6.0], atol=1e-6)
    assert math.isnan(summary.column(1)[2])
    # Nothing is overwritten without --overwrite.
    assert run_command(args) == 1
    assert run_command([*args, "--overwrite"]) == 1  # still only broken.csv


def test_qz_run_dwk_project_reads_back(tmp_path: Path) -> None:
    _peak(tmp_path / "a.csv", 5.0)
    (tmp_path / "r.json").write_text(_recipe(FIT, outputs=["A", "μ"]), "utf-8")
    args = [str(tmp_path / "r.json"), str(tmp_path / "a.csv"), "--out", str(tmp_path / "o")]
    code = run_command([*args, "--format", "dwk"])
    assert code == 0
    ws = qz.read_workspace(tmp_path / "o" / "Peak.dwk")
    assert [d.name for d in ws.datasets] == ["a.csv (Peak)", "Peak summary"]
    assert ws.datasets[0].source_path == str((tmp_path / "a.csv").resolve())


def test_qz_run_refuses_an_unreplayable_recipe_before_touching_anything(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    _peak(tmp_path / "a.csv", 5.0)
    bad = _step("expression", "Add column t", {"name": "t", "expr": "mean(A)"})
    (tmp_path / "r.json").write_text(_recipe(bad), "utf-8")
    with pytest.raises(SystemExit) as stop:
        main(
            ["run", str(tmp_path / "r.json"), str(tmp_path / "a.csv"), "--out", str(tmp_path / "o")]
        )
    assert stop.value.code == 2
    assert "step 1 (Add column t)" in capsys.readouterr().err
    assert not (tmp_path / "o").exists()


def test_qz_run_usage_errors(tmp_path: Path) -> None:
    (tmp_path / "r.json").write_text(_recipe(FIT), "utf-8")
    assert run_command([str(tmp_path / "missing.json"), "x.csv", "--out", str(tmp_path)]) == 2
    assert (
        run_command([str(tmp_path / "r.json"), str(tmp_path / "*.nothing"), "--out", str(tmp_path)])
        == 2
    )

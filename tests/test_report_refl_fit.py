"""Reflectivity fit -> report (P2.2 slice 3): ``calc.report_emit.from_refl_fit``
and its ``/api/report/emit`` kind.

The frontend sends a saved fit record's result (``fit_reflectivity``'s dict
minus its curves) through the same emit route the peak tables use; these pin
what the report says: value and standard error per parameter with "—" where
the fit reports none, the objective under its honest label, points / free /
convergence, and the warnings.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.refl_fit import fit_reflectivity
from quantized.calc.report import validate_report
from quantized.calc.report_emit import from_refl_fit
from quantized.io.report_export import to_latex

client = TestClient(app)

FIXTURES = Path(__file__).parent / "fixtures" / "baselines"


def _p(name: str, value: float, stderr: float | None, *, vary: bool = True,
       tie: str | None = None, at_bound: bool = False) -> dict[str, Any]:
    return {"name": name, "value": value, "stderr": stderr, "vary": vary, "tie": tie,
            "at_bound": at_bound}


def _result(**over: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "parameters": [
            _p("L1.thickness", 187.5, 0.8),
            _p("L1.roughness", 15.0, None, at_bound=True),
            _p("L2.sld", 2.1e-5, None, vary=False),
            _p("L2.roughness", 15.0, None, vary=False, tie="L1.roughness"),
            _p("scale", 0.97, 0.01),
        ],
        "free": ["L1.thickness", "L1.roughness", "scale"],
        "correlation": [],
        "chi2": 12.0,
        "reduced_chi2": 1.25,
        "sum_sq_log": None,
        "reduced_sum_sq_log": None,
        "n_points": 60,
        "n_free": 3,
        "success": True,
        "message": "ftol satisfied",
        "n_evaluations": 42,
        "weighting": "dr",
        "warnings": ["parameters ended on a bound (errors not reported): L1.roughness"],
    }
    base.update(over)
    return base


def _blocks(sheet: dict[str, Any]) -> list[dict[str, Any]]:
    return [b for s in sheet["sections"] for b in s["blocks"]]


def _table(sheet: dict[str, Any]) -> dict[str, Any]:
    return next(b for b in _blocks(sheet) if b["type"] == "table")


def _texts(sheet: dict[str, Any]) -> list[str]:
    return [b["text"] for b in _blocks(sheet) if b["type"] == "text"]


def test_parameter_table_reports_value_stderr_and_a_dash_for_none() -> None:
    sheet = from_refl_fit(_result(), title="Reflectivity fit #2").to_dict()
    validate_report(sheet)
    table = _table(sheet)
    assert table["columns"] == ["Parameter", "Value", "± stderr", "Status"]
    rows = {r[0]: r for r in table["rows"]}
    assert rows["L1.thickness"][1:] == [187.5, 0.8, "free"]
    assert rows["L1.roughness"][1:] == [15.0, "—", "at bound"]  # null stays "not reported"
    assert rows["L2.sld"][1:] == [2.1e-5, "—", "fixed"]
    assert rows["L2.roughness"][3] == "tied to L1.roughness"
    assert [r[0] for r in table["rows"]] == [p["name"] for p in _result()["parameters"]]


def test_stats_line_names_the_chi_square_only_for_dr_weighting() -> None:
    texts = _texts(from_refl_fit(_result()).to_dict())
    assert "Reduced χ² = 1.25 · points = 60 · free parameters = 3 · converged: yes" in texts
    assert "Warning: parameters ended on a bound (errors not reported): L1.roughness" in texts
    assert "Optimizer: ftol satisfied" in texts

    log = _result(weighting="log", chi2=None, reduced_chi2=None, sum_sq_log=0.5,
                  reduced_sum_sq_log=0.0089, success=False, warnings=[])
    texts = _texts(from_refl_fit(log).to_dict())
    assert texts[0] == (
        "Reduced Σ(Δlog₁₀R)² = 0.0089 · points = 60 · free parameters = 3 · converged: no"
    )
    assert not any("χ²" in t for t in texts)
    assert not any(t.startswith("Warning") for t in texts)


def test_a_missing_objective_reads_as_a_dash_not_zero() -> None:
    texts = _texts(from_refl_fit(_result(reduced_chi2=None)).to_dict())
    assert texts[0].startswith("Reduced χ² = — ·")


def test_a_real_fit_result_reports_every_parameter() -> None:
    q, r, dr, dq = np.loadtxt(FIXTURES / "xrr_bilayer_kiessig.refl", comments="#").T
    params: list[dict[str, Any]] = [
        {"name": "L0.sld", "value": 0.0}, {"name": "L0.isld", "value": 0.0},
        {"name": "L1.thickness", "value": 295.0, "vary": True, "min": 250.0, "max": 350.0},
        {"name": "L1.sld", "value": 3.0e-6}, {"name": "L1.isld", "value": 0.05e-6},
        {"name": "L1.roughness", "value": 6.0},
        {"name": "L2.thickness", "value": 150.0}, {"name": "L2.sld", "value": 5.5e-6},
        {"name": "L2.isld", "value": 0.08e-6}, {"name": "L2.roughness", "value": 4.0},
        {"name": "L3.sld", "value": 2.07e-6}, {"name": "L3.isld", "value": 0.02e-6},
        {"name": "L3.roughness", "value": 3.0},
        {"name": "scale", "value": 1.0},
        {"name": "background", "value": 0.0, "vary": True, "min": 0.0, "max": 1e-4},
    ]
    channel = {"q": q, "r": r, "dr": dr, "dq": dq, "label": "xrr"}
    out = fit_reflectivity(params, [channel], max_nfev=60)
    out.pop("curves")
    out.pop("sld_profiles")
    sheet = from_refl_fit(out).to_dict()
    validate_report(sheet)
    rows = {row[0]: row for row in _table(sheet)["rows"]}
    assert set(rows) == {p["name"] for p in out["parameters"]}
    assert rows["L1.sld"][2] == "—" and rows["L1.sld"][3] == "fixed"
    assert isinstance(rows["L1.thickness"][2], float)
    assert _texts(sheet)[0].startswith("Reduced χ² = ")


def test_emit_route_builds_the_refl_fit_report_from_wire_json() -> None:
    body = {
        "kind": "refl_fit",
        "result": {**_result(), "objective": {"label": "reduced χ²", "value": 1.25}},
        "title": "Reflectivity fit #1 — film.refl",
        "source_refs": [{"kind": "dataset", "id": "ds-1", "name": "film.refl"}],
    }
    resp = client.post("/api/report/emit", json=body)
    assert resp.status_code == 200, resp.text
    report = resp.json()["report"]
    validate_report(report)
    assert report["title"] == "Reflectivity fit #1 — film.refl"
    assert report["source_refs"][0]["id"] == "ds-1"
    assert _table(report)["rows"][1][2] == "—"


def test_emit_route_refuses_a_result_without_a_weighting_with_ascii_text() -> None:
    for bad in (_result(weighting="chi"), _result(parameters=[])):
        resp = client.post("/api/report/emit", json={"kind": "refl_fit", "result": bad})
        assert resp.status_code == 422
        assert resp.json()["detail"].isascii()


def test_the_latex_render_is_pure_ascii_for_both_weightings() -> None:
    # io.report_export promises output that compiles under plain pdfLaTeX, so
    # every glyph the refl-fit report emits (chi, Sigma, subscript digits, the
    # em dash of an unreported error) must be mapped to a LaTeX token.
    log = _result(weighting="log", chi2=None, reduced_chi2=None, sum_sq_log=0.5,
                  reduced_sum_sq_log=0.0089)
    for result in (_result(), log, _result(reduced_chi2=None)):
        tex = to_latex(from_refl_fit(result, title="Reflectivity fit #1 — film.refl").to_dict())
        bad = sorted({ch for ch in tex if not ch.isascii()})
        assert bad == [], bad
    tex = to_latex(from_refl_fit(log).to_dict())
    assert r"$\Sigma$" in tex and r"log$_1$$_0$R" in tex
    assert "---" in tex  # the unreported stderr

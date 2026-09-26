"""Peak model fit -> report (audit P2.4 slice 2): ``calc.report_emit_peaks.
from_peak_model_fit`` and its ``/api/report/emit`` kind.

The Peak Analyzer sends ``fit_peak_model``'s result minus its curves through
the emit route; these pin what the report says: per-peak values with their
standard errors (area included), "—" where the fit reports none, the
objective under its honest label (SSR unweighted, chi-square only weighted),
and the warnings.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

from quantized.app import app
from quantized.calc.peak_model_fit import fit_peak_model
from quantized.calc.report import validate_report
from quantized.calc.report_emit_peaks import from_peak_model_fit

client = TestClient(app)


def _p(name: str, value: float, vary: bool = True, tie: str | None = None) -> dict[str, Any]:
    return {"name": name, "value": value, "vary": vary, "tie": tie}


def _fit(weighted: bool = False) -> dict[str, Any]:
    x = np.linspace(0.0, 10.0, 201)
    rng = np.random.default_rng(3)
    y = (5.0 * np.exp(-4 * np.log(2) * (x - 3.5) ** 2 / 0.8**2)
         + 3.0 / (1 + 4 * (x - 6.5) ** 2 / 1.0**2) + 0.4 + rng.normal(0, 0.02, x.size))
    params = [
        _p("p0.center", 3.4), _p("p0.height", 4.0), _p("p0.fwhm", 1.0),
        _p("p1.center", 6.6), _p("p1.height", 2.5), _p("p1.fwhm", 1.1),
        _p("bg.c0", 0.4, vary=False),
    ]
    out = fit_peak_model(x, y, ["gaussian", "lorentzian"], params, background="constant",
                         y_err=np.full(x.size, 0.02) if weighted else None)
    out.pop("curves")
    return out


def _texts(rep: Any) -> list[str]:
    return [b["text"] for b in rep.iter_blocks() if b["type"] == "text"]


def _tables(rep: Any) -> list[dict[str, Any]]:
    return [b for b in rep.iter_blocks() if b["type"] == "table"]


def test_unweighted_report_says_ssr_never_chi2() -> None:
    result = _fit()
    assert result["metrics"]["objective"] == "ssr"
    rep = from_peak_model_fit(result, title="Peaks")
    validate_report(rep.to_dict())
    stats = [t for t in _texts(rep) if "points =" in t]
    assert len(stats) == 1
    assert "SSR = " in stats[0] and "Reduced SSR = " in stats[0]
    assert "χ²" not in " ".join(_texts(rep))
    peaks, params = _tables(rep)
    assert peaks["columns"][:4] == ["Peak", "Shape", "Center", "± center"]
    assert peaks["columns"][-2:] == ["Area", "± area"]
    assert [r[1] for r in peaks["rows"]] == ["gaussian", "lorentzian"]
    # every free peak quantity carries a finite error, the area included
    assert all(isinstance(c, float) for r in peaks["rows"] for c in r[2:])
    by_name = {r[0]: r for r in params["rows"]}
    assert by_name["bg.c0"][2] == "—" and by_name["bg.c0"][3] == "fixed"
    assert isinstance(by_name["p0.center"][2], float) and by_name["p0.center"][3] == "free"


def test_weighted_report_labels_chi2() -> None:
    rep = from_peak_model_fit(_fit(weighted=True))
    stats = next(t for t in _texts(rep) if "points =" in t)
    assert stats.startswith("χ² = ") and "Reduced χ² = " in stats
    assert "SSR" not in stats


def test_warnings_and_optimizer_message_become_lines() -> None:
    result = _fit()
    result["warnings"] = ["peaks p0 and p1 overlap", "parameters ended on a bound: p0.fwhm"]
    texts = _texts(from_peak_model_fit(result))
    assert "Warning: peaks p0 and p1 overlap" in texts
    assert "Warning: parameters ended on a bound: p0.fwhm" in texts
    assert any(t.startswith("Optimizer: ") for t in texts)


def test_null_stderr_shows_dash_and_status() -> None:
    result = _fit()
    result["peaks"][0]["area_stderr"] = None
    result["parameters"][0].update(stderr=None, at_bound=True)
    result["parameters"][2].update(stderr=None, tie="p1.fwhm", vary=False)
    peaks, params = _tables(from_peak_model_fit(result))
    assert peaks["rows"][0][-1] == "—"
    assert params["rows"][0][2:] == ["—", "at bound"]
    assert params["rows"][2][2:] == ["—", "tied to p1.fwhm"]


def test_rejects_unknown_objective_and_empty_result() -> None:
    result = _fit()
    result["metrics"]["objective"] = "rmse"
    with pytest.raises(ValueError, match="objective"):
        from_peak_model_fit(result)
    with pytest.raises(ValueError, match="objective"):
        from_peak_model_fit({})
    ok = _fit()
    ok["peaks"] = []
    with pytest.raises(ValueError, match="parameters and peaks"):
        from_peak_model_fit(ok)


def test_emit_route_accepts_the_kind() -> None:
    resp = client.post("/api/report/emit", json={
        "kind": "peak_model_fit", "result": _fit(), "title": "XRD peaks",
        "source_refs": [{"kind": "dataset", "id": "d1", "name": "scan"}],
    })
    assert resp.status_code == 200, resp.text
    report = resp.json()["report"]
    validate_report(report)
    assert report["title"] == "XRD peaks"
    bad = client.post("/api/report/emit", json={"kind": "peak_model_fit", "result": {}})
    assert bad.status_code == 422

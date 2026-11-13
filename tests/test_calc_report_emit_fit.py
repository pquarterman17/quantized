"""The curve-fit report sheet carries NLFit's inference, ANOVA and matrices.

``calc.report_emit_fit.fit_report_blocks`` only reshapes
``calc.fit_report.fit_report``; these tests pin the shaping (y recovered as
yFit + residuals, ``dy`` weights, ``ciLevel``) and that ``from_curve_fit``
includes the blocks only when the result has residuals.
"""

from __future__ import annotations

import numpy as np
import pytest

from quantized.calc.fit_models import evaluate
from quantized.calc.fit_report import fit_report
from quantized.calc.fitting import curve_fit
from quantized.calc.report_emit import from_curve_fit
from quantized.calc.report_emit_fit import fit_report_blocks

NAMES = ["A", "tau", "C"]


def _result(dy: list[float] | None = None) -> tuple[dict, np.ndarray]:
    x = np.linspace(0.0, 8.0, 40)
    y = 3.0 * np.exp(-x / 2.0) + 0.2 + 0.02 * np.cos(4.0 * x)
    weights = None if dy is None else 1.0 / np.asarray(dy) ** 2
    res = curve_fit(x, y, lambda xx, pp: evaluate("Exponential Decay", xx, pp), [3.0, 2.0, 0.2],
                    weights=weights)
    out = {k: (v.tolist() if isinstance(v, np.ndarray) else v) for k, v in res.items()}
    return out, y


def _table(blocks: list[dict], caption_start: str) -> dict:
    return next(b for b in blocks if (b.get("caption") or "").startswith(caption_start))


@pytest.mark.parametrize("weighted", [False, True])
def test_blocks_match_fit_report(weighted: bool) -> None:
    dy = [0.02 + 0.001 * i for i in range(40)] if weighted else None
    result, y = _result(dy)
    if dy:
        result["dy"] = dy
    result["ciLevel"] = 0.9
    blocks = fit_report_blocks(result, NAMES)
    want = fit_report(result["params"], result["errors"], result["covar"], y.tolist(),
                      result["residuals"], result["nFree"],
                      weights=None if dy is None else [1 / d**2 for d in dy], level=0.9)
    inf = _table(blocks, "Parameter inference (90%")
    assert inf["columns"][5:] == ["LCL (90%)", "UCL (90%)"]
    for row, p in zip(inf["rows"], want["parameters"], strict=True):
        assert row[3] == pytest.approx(p["t"]) and row[5] == pytest.approx(p["lcl"])
    anova = _table(blocks, "ANOVA")
    assert [r[0] for r in anova["rows"]] == [
        "Regression", "Residual", "Uncorrected Total", "Corrected Total"]
    assert anova["rows"][1][2] == pytest.approx(want["anova"][1]["ss"])
    stats = _table(blocks, "Statistics")
    assert stats["caption"].endswith("(weighted)") == weighted
    assert _table(blocks, "Correlation matrix")["columns"] == ["", *NAMES]
    assert _table(blocks, "Covariance matrix")["rows"][0][0] == "A"


def test_from_curve_fit_includes_blocks_only_with_residuals() -> None:
    result, _ = _result()
    full = from_curve_fit(result, param_names=NAMES).to_dict()
    captions = [b.get("caption") for b in full["sections"][0]["blocks"]]
    assert "ANOVA" in captions and "Correlation matrix" in captions
    bare = from_curve_fit({"params": result["params"], "errors": result["errors"]},
                          param_names=NAMES).to_dict()
    assert "ANOVA" not in [b.get("caption") for b in bare["sections"][0]["blocks"]]


def test_mismatched_or_missing_residuals_add_nothing() -> None:
    assert fit_report_blocks({"params": [1.0], "residuals": [0.1, 0.2], "yFit": [1.0]}, ["a"]) == []
    assert fit_report_blocks({"params": [1.0]}, ["a"]) == []

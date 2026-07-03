"""Report-sheet schema + emitters (calc.report / calc.report_emit).

The schema is plain serializable data, so the tests assert structure,
round-trip fidelity, validation, and that the emitters map real result dicts
(from the fitting / peak / ANOVA calc functions) into well-formed reports.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from quantized.calc.peak_batch import batch_integrate_peaks
from quantized.calc.peak_integrate import integrate_peaks
from quantized.calc.report import (
    BLOCK_TYPES,
    ReportSheet,
    figure_block,
    params_block,
    section,
    source_ref,
    table_block,
    text_block,
    validate_report,
)
from quantized.calc.report_emit import (
    from_anova,
    from_batch_integrate,
    from_curve_fit,
    from_integrate,
    from_multipeak_fit,
    from_stats_table,
)
from quantized.calc.stats_anova2 import anova2


# --------------------------------------------------------------------------
# block builders + schema
# --------------------------------------------------------------------------
def test_block_builders_shapes() -> None:
    assert text_block("hi") == {"type": "text", "text": "hi"}
    tb = table_block(["A", "B"], [[1, 2], [3, 4]], caption="cap")
    assert tb["type"] == "table" and tb["columns"] == ["A", "B"]
    assert tb["rows"] == [[1, 2], [3, 4]] and tb["caption"] == "cap"
    pb = params_block([{"name": "a", "value": 1.5, "error": 0.1, "unit": "T"}])
    assert pb["params"][0] == {"name": "a", "value": 1.5, "error": 0.1, "unit": "T"}
    fb = figure_block("fig1", caption="a figure")
    assert fb == {"type": "figure", "name": "fig1", "caption": "a figure"}
    assert set(BLOCK_TYPES) == {"text", "table", "params", "figure"}


def test_table_block_rejects_ragged_rows() -> None:
    with pytest.raises(ValueError, match="expected 2"):
        table_block(["A", "B"], [[1, 2], [3]])


def test_cell_coercion_numpy_and_nonfinite() -> None:
    tb = table_block(["x"], [[np.float64(2.5)], [np.int64(3)], [np.nan], [np.inf]])
    assert tb["rows"] == [[2.5], [3], [None], [None]]  # numpy->python, non-finite->None


def test_params_block_drops_nan_error() -> None:
    pb = params_block([{"name": "a", "value": 1.0, "error": float("nan")}])
    assert "error" not in pb["params"][0]


def test_figure_block_requires_image_keys() -> None:
    with pytest.raises(ValueError, match="mime"):
        figure_block("f", image={"data": "abc"})  # type: ignore[arg-type]
    fb = figure_block("f", image={"mime": "image/png", "data": "QUJD"})
    assert fb["image"] == {"mime": "image/png", "data": "QUJD"}


def test_report_roundtrip_json() -> None:
    rep = ReportSheet(
        title="My report",
        sections=(section("S1", [text_block("note"), table_block(["a"], [[1]])]),),
        source_refs=(source_ref("dataset", "ds1", "Sample A"),),
        created="2026-07-03T00:00:00",
        meta={"tool": "quantized"},
    )
    back = ReportSheet.from_json(rep.to_json())
    assert back.to_dict() == rep.to_dict()
    assert back.title == "My report"
    assert list(back.iter_blocks())[0] == {"type": "text", "text": "note"}


def test_validate_report_catches_bad_blocks() -> None:
    with pytest.raises(ValueError, match="title"):
        validate_report({"sections": []})
    bad = {"title": "t", "sections": [{"title": "s", "blocks": [{"type": "bogus"}]}]}
    with pytest.raises(ValueError, match="unknown block type"):
        validate_report(bad)
    ragged = {"title": "t", "sections": [
        {"title": "s", "blocks": [{"type": "table", "columns": ["a", "b"], "rows": [[1]]}]}]}
    with pytest.raises(ValueError, match="match the column count"):
        validate_report(ragged)


def test_validate_report_rejects_non_dict_entries() -> None:
    # non-dict section / block / param must raise ValueError, never AttributeError
    with pytest.raises(ValueError, match="section 0 must be an object"):
        validate_report({"title": "t", "sections": ["oops"]})
    with pytest.raises(ValueError, match="block must be an object"):
        validate_report({"title": "t", "sections": [{"title": "s", "blocks": ["oops"]}]})
    with pytest.raises(ValueError, match="each param needs"):
        validate_report({"title": "t", "sections": [
            {"title": "s", "blocks": [{"type": "params", "params": ["namevalue"]}]}]})


def test_params_block_sanitizes_nonfinite_for_strict_json() -> None:
    import json

    pb = params_block([{"name": "a", "value": float("nan"), "error": float("inf")}])
    assert pb["params"][0] == {"name": "a", "value": None}  # NaN->None, inf error dropped
    rep = ReportSheet(title="t", sections=(section("s", [pb]),)).to_dict()
    json.dumps(rep, allow_nan=False)  # must not raise (valid wire JSON)


# --------------------------------------------------------------------------
# emitters
# --------------------------------------------------------------------------
def test_from_curve_fit_maps_params_and_gof() -> None:
    result = {
        "params": [2.0, 5.0], "errors": [0.1, 0.3],
        "R2": 0.995, "chiSqRed": 1.02, "RMSE": 0.05, "AIC": -120.0,
        "nFree": 2, "nPoints": 50,
    }
    rep = from_curve_fit(
        result, param_names=["amplitude", "center"], param_units=["V", "nm"],
        model_name="Gaussian", source_refs=[source_ref("dataset", "ds1")],
    )
    validate_report(rep.to_dict())
    blocks = list(rep.iter_blocks())
    assert blocks[0] == {"type": "text", "text": "Model: Gaussian"}
    pblock = next(b for b in blocks if b["type"] == "params")
    assert pblock["params"][0] == {"name": "amplitude", "value": 2.0, "error": 0.1, "unit": "V"}
    gof = next(b for b in blocks if b["type"] == "table")
    metrics = {row[0]: row[1] for row in gof["rows"]}
    assert math.isclose(metrics["R²"], 0.995)
    assert metrics["Points"] == 50
    assert rep.source_refs[0]["id"] == "ds1"


def test_from_curve_fit_param_name_mismatch() -> None:
    with pytest.raises(ValueError, match="must match"):
        from_curve_fit({"params": [1.0, 2.0], "errors": [0.1, 0.2]}, param_names=["only_one"])


def test_from_multipeak_fit_builds_table() -> None:
    result = {
        "peaks": [
            {"model": "Gaussian", "center": 10.0, "fwhm": 1.2, "height": 100.0,
             "area": 150.0, "eta": None},
            {"model": "Gaussian", "center": 20.0, "fwhm": 1.5, "height": 80.0,
             "area": 120.0, "eta": None},
        ],
        "rmse": 2.5, "nPeaks": 2, "model": "Gaussian",
    }
    rep = from_multipeak_fit(result)
    validate_report(rep.to_dict())
    table = next(b for b in rep.iter_blocks() if b["type"] == "table")
    assert table["columns"][:3] == ["Peak", "Model", "Center"]
    assert len(table["rows"]) == 2
    assert table["rows"][0][0] == 1 and table["rows"][1][2] == 20.0


def test_from_anova_uses_real_result() -> None:
    battery = [
        [[130, 155, 74, 180], [34, 40, 80, 75]],
        [[150, 188, 159, 126], [136, 122, 106, 115]],
    ]
    rep = from_anova(anova2(battery), title="Battery ANOVA")
    validate_report(rep.to_dict())
    table = next(b for b in rep.iter_blocks() if b["type"] == "table")
    assert table["columns"] == ["Source", "SS", "df", "MS", "F", "p"]
    sources = [row[0] for row in table["rows"]]
    assert sources == ["A", "B", "AxB", "Error", "Total"]


def test_from_integrate_builds_region_table() -> None:
    import numpy as np

    x = np.linspace(0.0, 10.0, 400)
    y = 100.0 * np.exp(-0.5 * ((x - 5.0) / 0.4) ** 2) + 2.0
    rep = from_integrate(integrate_peaks(x, y, [(4.0, 6.0)]))
    validate_report(rep.to_dict())
    table = next(b for b in rep.iter_blocks() if b["type"] == "table")
    assert table["columns"][0] == "Region" and "Area" in table["columns"]
    assert len(table["rows"]) == 1
    assert any(b["type"] == "text" and "Total net area" in b["text"] for b in rep.iter_blocks())


def test_from_batch_integrate_trend_table() -> None:
    import numpy as np

    x = np.linspace(0.0, 100.0, 401)
    spectra = [list(100.0 * np.exp(-0.5 * ((x - c) / 4.0) ** 2) + 2.0) for c in (50.0, 50.0)]
    result = batch_integrate_peaks(x, spectra, [(40.0, 60.0)], align=True, labels=["300K", "10K"])
    rep = from_batch_integrate(result)
    validate_report(rep.to_dict())
    table = next(b for b in rep.iter_blocks() if b["type"] == "table")
    assert table["columns"][0] == "Spectrum" and "Shift" in table["columns"]  # aligned run
    assert [row[0] for row in table["rows"]] == ["300K", "10K"]


def test_from_integrate_and_batch_errors() -> None:
    with pytest.raises(ValueError, match="needs a result with peaks"):
        from_integrate({"peaks": []})
    with pytest.raises(ValueError, match="needs results and regions"):
        from_batch_integrate({"results": [], "regions": []})


def test_from_stats_table_default_columns_and_empty() -> None:
    recs = [{"group": 1, "diff": 2.5, "p": 0.01}, {"group": 2, "diff": -1.0, "p": 0.3}]
    rep = from_stats_table(recs, title="Post-hoc")
    table = next(b for b in rep.iter_blocks() if b["type"] == "table")
    assert table["columns"] == ["Group", "Difference", "p"]
    assert table["rows"][0] == [1, 2.5, 0.01]
    with pytest.raises(ValueError, match="at least one record"):
        from_stats_table([], title="x")

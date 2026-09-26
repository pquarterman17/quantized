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



def test_from_multipeak_fit_marks_hand_edited_rows() -> None:
    result = {
        "peaks": [
            {"model": "Gaussian", "center": 10.0, "fwhm": 1.2, "height": 100.0,
             "area": 150.0, "eta": None, "status": "ok"},
            {"model": "Gaussian", "center": 20.0, "fwhm": 1.5, "height": 80.0,
             "area": 120.0, "eta": None, "status": "manual-edit"},
        ],
        "rmse": None, "nPeaks": 2, "model": "Gaussian",
    }
    rep = from_multipeak_fit(result)
    validate_report(rep.to_dict())
    table = next(b for b in rep.iter_blocks() if b["type"] == "table")
    assert table["columns"][-1] == "Source"
    assert [row[-1] for row in table["rows"]] == ["fit", "edited by hand"]
    assert "1 edited by hand" in table["caption"]


def test_from_multipeak_fit_has_no_source_column_for_pure_fits() -> None:
    result = {"peaks": [{"model": "Gaussian", "center": 10.0, "fwhm": 1.2,
                         "height": 100.0, "area": 150.0, "eta": None, "status": "ok"}]}
    table = next(b for b in from_multipeak_fit(result).iter_blocks() if b["type"] == "table")
    assert "Source" not in table["columns"]


# ── a published model-fit peak table (ported from PR #434) ──────────────────
# The Peaks workshop's "→ Report" sends the durable PeakTable's per-peak 1σ
# errors (null where the fit reported none) and the model fit's objective.

_MF_PEAKS: list[dict[str, object]] = [
    {"model": "pseudo_voigt", "center": 36.0, "fwhm": 0.4, "height": 800.0,
     "area": 340.0, "eta": 0.3, "centerErr": 0.0003, "fwhmErr": 0.001,
     "heightErr": 2.0, "areaErr": 1.5, "etaErr": 0.02,
     "fwhmG": None, "fwhmGErr": None, "fwhmL": None, "fwhmLErr": None},
    {"model": "gaussian", "center": 44.0, "fwhm": 0.6, "height": 400.0,
     "area": 377.0, "eta": None, "centerErr": None, "fwhmErr": 0.002,
     "heightErr": 1.0, "areaErr": None, "etaErr": None,
     "fwhmG": None, "fwhmGErr": None, "fwhmL": None, "fwhmLErr": None},
]


def _model_fit_result(**over: object) -> dict[str, object]:
    result: dict[str, object] = {
        "peaks": _MF_PEAKS,
        "R2": 0.9999, "rmse": 0.05, "nPeaks": 2, "model": "mixed (pseudo_voigt, gaussian)",
        "objective": "ssr", "ssr": 12.5, "chi2": None,
    }
    result.update(over)
    return result


def _tables(result: dict[str, object]) -> list[dict[str, object]]:
    rep = from_multipeak_fit(result)
    validate_report(rep.to_dict())
    return [b for b in rep.iter_blocks() if b["type"] == "table"]


def test_from_multipeak_fit_prints_model_fit_errors_and_objective() -> None:
    peaks_t, gof_t = _tables(_model_fit_result())
    assert peaks_t["columns"] == ["Peak", "Model", "Center", "± center", "FWHM", "± FWHM",
                                  "Height", "± height", "Area", "± area", "η", "± η"]
    assert peaks_t["rows"][0][2:12] == [36.0, 0.0003, 0.4, 0.001, 800.0, 2.0, 340.0, 1.5,
                                        0.3, 0.02]
    # a null error is the dash; a shape parameter the row does not have is blank
    assert peaks_t["rows"][1][3] == "—" and peaks_t["rows"][1][9] == "—"
    assert peaks_t["rows"][1][10:12] == [None, None]
    assert gof_t["rows"] == [["RMSE", 0.05], ["Peaks", 2], ["R²", 0.9999], ["SSR", 12.5]]


def test_from_multipeak_fit_model_fit_explains_the_dash() -> None:
    rep = from_multipeak_fit(_model_fit_result())
    assert any(b["type"] == "text" and "1σ" in b["text"] for b in rep.iter_blocks())


def test_from_multipeak_fit_model_fit_keeps_the_pm_layout_when_every_error_is_null() -> None:
    # A manual edit clears errors and the global metrics; the dashes stay.
    peak = {"model": "gaussian", "center": 36.0, "fwhm": 0.4, "height": 800.0,
            "area": 340.0, "eta": None, "centerErr": None, "fwhmErr": None,
            "heightErr": None, "areaErr": None, "status": "manual-edit"}
    peaks_t, gof_t = _tables(_model_fit_result(peaks=[peak], R2=None, rmse=None, ssr=None,
                                               nPeaks=1))
    assert "± center" in peaks_t["columns"] and peaks_t["columns"][-1] == "Source"
    assert peaks_t["rows"][0][3] == "—" and peaks_t["rows"][0][9] == "—"
    assert gof_t["rows"] == [["Peaks", 1]]


def test_from_multipeak_fit_labels_a_chi2_fits_r2_as_weighted() -> None:
    _, gof = _tables(_model_fit_result(objective="chi2", chi2=9.5, R2=0.97))
    assert ["weighted R²", 0.97] in gof["rows"] and ["χ²", 9.5] in gof["rows"]
    assert ["SSR", 12.5] in gof["rows"]
    assert not any(r[0] == "R²" for r in gof["rows"])
    _, gof = _tables(_model_fit_result(chi2=9.5))  # an SSR fit never prints χ²
    assert not any(r[0] == "χ²" for r in gof["rows"])


def test_from_multipeak_fit_prints_voigt_widths_only_when_a_row_has_them() -> None:
    voigt = {"model": "voigt", "center": 50.0, "fwhm": 0.5, "height": 300.0, "area": 170.0,
             "eta": None, "centerErr": 0.001, "fwhmErr": 0.003, "heightErr": 3.0,
             "areaErr": 2.0, "etaErr": None, "fwhmG": 0.3, "fwhmGErr": 0.01,
             "fwhmL": 0.25, "fwhmLErr": None}
    peaks_t, _ = _tables(_model_fit_result(peaks=[*_MF_PEAKS, voigt], nPeaks=3))
    assert peaks_t["columns"][-4:] == ["FWHM (G)", "± FWHM (G)", "FWHM (L)", "± FWHM (L)"]
    assert peaks_t["rows"][2][-4:] == [0.3, 0.01, 0.25, "—"]
    assert peaks_t["rows"][0][-4:] == [None, None, None, None]
    no_voigt, _ = _tables(_model_fit_result())
    assert "FWHM (G)" not in no_voigt["columns"]


def test_from_multipeak_fit_classic_table_is_unchanged_by_error_support() -> None:
    # The whole sheet, pinned: a classic (legacy) fit's report must stay
    # byte-identical to the one emitted before model-fit errors were added.
    result = {
        "peaks": [
            {"model": "pseudo-voigt", "center": 10.0, "fwhm": 1.2, "height": 100.0,
             "area": 150.0, "eta": 0.3, "bg": 2.0, "status": "fitted", "centerErr": None},
            {"model": "pseudo-voigt", "center": 20.0, "fwhm": 1.4, "height": 50.0,
             "area": 90.0, "eta": 0.5, "bg": 1.0, "status": "manual-edit"},
        ],
        "bgCoeffs": [1.0, 0.1], "R2": 0.99, "rmse": 2.5, "nPeaks": 2, "model": "pseudo-voigt",
    }
    assert from_multipeak_fit(result, title="T").to_dict()["sections"] == [{
        "title": "Peak fit",
        "blocks": [
            {"type": "table", "caption": "2 peak(s), 1 edited by hand",
             "columns": ["Peak", "Model", "Center", "FWHM", "Height", "Area", "η", "Source"],
             "rows": [[1, "pseudo-voigt", 10.0, 1.2, 100.0, 150.0, 0.3, "fit"],
                      [2, "pseudo-voigt", 20.0, 1.4, 50.0, 90.0, 0.5, "edited by hand"]]},
            {"type": "table", "caption": "Goodness of fit", "columns": ["Metric", "Value"],
             "rows": [["RMSE", 2.5], ["Peaks", 2]]},
        ],
    }]

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

"""Public API stability + headless smoke test (ORIGIN_GAP_PLAN #9).

``quantized.api`` is the blessed, frozen surface for driving the engine from
scripts / notebooks / CI. This test freezes the name set (a rename or removal
fails here on purpose) and proves an end-to-end analysis runs with no server.
"""

from __future__ import annotations

import numpy as np

import quantized.api as qz

# The frozen public surface. Changing it is a deliberate act: update this set
# in the same commit as the api.py change (that is the point of the guard).
_EXPECTED = {
    "DataStruct", "load",
    "curve_fit", "fit_single_peak", "fit_multi_peak", "find_peaks_robust",
    "integrate_peaks", "batch_integrate_peaks",
    "estimate_background", "fit_region_background", "baseline_als",
    "baseline_modpoly", "baseline_rolling_ball",
    "apply_corrections",
    "descriptive_stats", "lin_regress", "t_test", "anova1", "pca_analysis",
    "multiple_regression", "correlation_matrix", "partial_correlation",
    "stepwise_regression",
    "anova2", "anova2_unbalanced", "repeated_measures_anova", "tukey_hsd",
    "dunnett_test",
    "mann_whitney", "wilcoxon_signed_rank", "kruskal_wallis", "friedman",
    "sign_test", "shapiro_wilk", "anderson_darling", "levene", "ks_normal",
    "ks_two_sample", "recommend_test",
    "fit_distribution", "t_test_power", "required_n",
    "box_stats", "grouped_box_stats", "violin_kde", "qq_plot", "histogram",
    "ReportSheet", "section", "text_block", "table_block", "params_block",
    "figure_block", "source_ref", "validate_report",
    "from_curve_fit", "from_multipeak_fit", "from_anova", "from_stats_table",
    "render_figure", "render_map_figure", "render_statplot_figure",
    "render_report", "to_latex", "to_html", "format_value_error",
}


def test_public_surface_is_frozen() -> None:
    assert set(qz.__all__) == _EXPECTED, (
        "public API drift — update _EXPECTED and api.__all__ together"
    )


def test_every_public_name_resolves_and_is_callable() -> None:
    for name in qz.__all__:
        obj = getattr(qz, name, None)
        assert obj is not None, f"{name} missing from quantized.api"
        assert callable(obj), f"{name} is not callable"


def test_no_duplicate_names() -> None:
    assert len(qz.__all__) == len(set(qz.__all__))


def test_package_import_stays_light() -> None:
    # `import quantized` must not eagerly pull in the heavy api surface (the
    # FastAPI server imports the package, not the notebook API).
    import quantized

    assert quantized.__version__
    assert not hasattr(quantized, "render_figure")  # only reachable via quantized.api


def test_headless_pipeline_end_to_end() -> None:
    # load-equivalent: build a DataStruct directly (load() needs a file)
    x = np.linspace(0.0, 10.0, 400)
    y = 100.0 * np.exp(-0.5 * ((x - 5.0) / 0.4) ** 2) + 3.0
    ds = qz.DataStruct.create(x, y, labels=["intensity"], units=["counts"])
    assert ds.n_channels == 1

    # detect + integrate + fit through the public surface
    found_peaks, _background = qz.find_peaks_robust(x, y)
    assert found_peaks and abs(found_peaks[0]["center"] - 5.0) < 0.1
    integ = qz.integrate_peaks(x, ds.column(0), [(4.0, 6.0)])
    assert integ["peaks"][0]["area"] > 0
    fit = qz.fit_single_peak(x, y, 4.0, 6.0, seed_center=5.0, model="Gaussian")
    assert isinstance(fit, dict) and fit

    # descriptive stats + a box summary
    stats = qz.descriptive_stats(y)
    assert "mean" in stats
    box = qz.box_stats(y)
    assert box["n"] == y.size

    # report -> render to LaTeX + HTML with no server
    report = qz.from_stats_table(
        [{"peak": "111", "area": integ["peaks"][0]["area"]}], title="Headless run"
    )
    qz.validate_report(report.to_dict())
    assert r"\toprule" in qz.to_latex(report.to_dict())
    assert qz.to_html(report.to_dict()).startswith("<!doctype html>")

    # publication figure bytes
    assert qz.render_figure(x, [("intensity", y)], fmt="pdf")[:5] == b"%PDF-"

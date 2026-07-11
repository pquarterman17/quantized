"""``quantized`` headless public API — drive the analysis engine from code.

ORIGIN_GAP_PLAN #9. Everything the app does to your data is a pure function you
can call from a script, notebook, or CI job — no GUI, no server, cross-platform.
This is the differentiator Origin structurally can't match: *analysis is code*.

This module is the **blessed, stable surface**. Names here are frozen — a
rename or removal breaks ``tests/test_public_api.py`` on purpose. The
underlying modules (``quantized.calc.*`` / ``quantized.io.*``) may reorganize;
import from here to stay insulated.

Example — load a scan, integrate a peak, build a report, render it::

    import numpy as np
    import quantized.api as qz

    data = qz.load("scan.xy")                     # any registered format -> DataStruct
    x, y = data.time, data.column(0)

    result = qz.integrate_peaks(x, y, [(28.0, 32.0)])   # net area / centroid / FWHM
    fit = qz.fit_single_peak(x, y, 28.0, 32.0, seed_center=30.0, model="Gaussian")

    report = qz.from_stats_table(
        [{"region": "111", **result["peaks"][0]}], title="Peak integration"
    )
    open("report.html", "w").write(qz.to_html(report.to_dict()))
    pdf = qz.render_figure(x, [("intensity", y)], fmt="pdf")   # publication vector

Note: importing this module pulls in matplotlib (for the render helpers), so it
is heavier than ``import quantized``; the FastAPI server never imports it.
"""

from __future__ import annotations

# ── Data contract + file loading ──────────────────────────────────────────
from quantized.calc.backgrounds import (
    anchor_baseline,
    footprint_correction,
    shirley_background,
    xrd_low_angle_background,
)
from quantized.calc.baseline import (
    baseline_als,
    baseline_modpoly,
    baseline_rolling_ball,
    estimate_background,
    fit_region_background,
)

# ── Corrections ────────────────────────────────────────────────────────────
from quantized.calc.corrections import apply_corrections

# ── Publication rendering (matplotlib) ─────────────────────────────────────
from quantized.calc.figure import render_figure
from quantized.calc.figure_map import render_map_figure
from quantized.calc.figure_statplots import render_statplot_figure

# ── Curve & peak fitting ───────────────────────────────────────────────────
from quantized.calc.fitting import curve_fit
from quantized.calc.peak_batch import batch_integrate_peaks
from quantized.calc.peak_fit import fit_single_peak
from quantized.calc.peak_integrate import integrate_peaks
from quantized.calc.peak_multifit import fit_multi_peak
from quantized.calc.peaks import find_peaks_robust

# ── Reporting ──────────────────────────────────────────────────────────────
from quantized.calc.report import (
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

# ── Statistical plots ──────────────────────────────────────────────────────
from quantized.calc.statplots import (
    box_stats,
    grouped_box_stats,
    histogram,
    qq_plot,
    violin_kde,
)

# ── Statistics ─────────────────────────────────────────────────────────────
from quantized.calc.stats import (
    anova1,
    descriptive_stats,
    lin_regress,
    pca_analysis,
    t_test,
)
from quantized.calc.stats_anova2 import anova2, dunnett_test, tukey_hsd
from quantized.calc.stats_anova_ext import anova2_unbalanced, repeated_measures_anova
from quantized.calc.stats_dist import fit_distribution, required_n, t_test_power
from quantized.calc.stats_multivar import (
    correlation_matrix,
    multiple_regression,
    partial_correlation,
    stepwise_regression,
)
from quantized.calc.stats_tests import (
    anderson_darling,
    friedman,
    kruskal_wallis,
    ks_normal,
    ks_two_sample,
    levene,
    mann_whitney,
    recommend_test,
    shapiro_wilk,
    sign_test,
    wilcoxon_signed_rank,
)
from quantized.datastruct import DataStruct
from quantized.io.registry import import_auto as load
from quantized.io.report_export import (
    format_value_error,
    render_report,
    to_html,
    to_latex,
)

__all__ = [
    # data + I/O
    "DataStruct",
    "load",
    # fitting
    "curve_fit",
    "fit_single_peak",
    "fit_multi_peak",
    "find_peaks_robust",
    "integrate_peaks",
    "batch_integrate_peaks",
    # baseline
    "estimate_background",
    "fit_region_background",
    "baseline_als",
    "baseline_modpoly",
    "baseline_rolling_ball",
    # backgrounds (GOTO #2/#3/#7 — new beyond MATLAB parity)
    "anchor_baseline",
    "shirley_background",
    "xrd_low_angle_background",
    "footprint_correction",
    # corrections
    "apply_corrections",
    # statistics — core
    "descriptive_stats",
    "lin_regress",
    "t_test",
    "anova1",
    "pca_analysis",
    # statistics — multivariate
    "multiple_regression",
    "correlation_matrix",
    "partial_correlation",
    "stepwise_regression",
    # statistics — designed experiments
    "anova2",
    "anova2_unbalanced",
    "repeated_measures_anova",
    "tukey_hsd",
    "dunnett_test",
    # statistics — nonparametric + assumptions
    "mann_whitney",
    "wilcoxon_signed_rank",
    "kruskal_wallis",
    "friedman",
    "sign_test",
    "shapiro_wilk",
    "anderson_darling",
    "levene",
    "ks_normal",
    "ks_two_sample",
    "recommend_test",
    # statistics — distributions + power
    "fit_distribution",
    "t_test_power",
    "required_n",
    # statistical plots
    "box_stats",
    "grouped_box_stats",
    "violin_kde",
    "qq_plot",
    "histogram",
    # reporting
    "ReportSheet",
    "section",
    "text_block",
    "table_block",
    "params_block",
    "figure_block",
    "source_ref",
    "validate_report",
    "from_curve_fit",
    "from_multipeak_fit",
    "from_anova",
    "from_stats_table",
    "from_integrate",
    "from_batch_integrate",
    # export / rendering
    "render_figure",
    "render_map_figure",
    "render_statplot_figure",
    "render_report",
    "to_latex",
    "to_html",
    "format_value_error",
]

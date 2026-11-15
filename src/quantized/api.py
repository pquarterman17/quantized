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

Example — every book of an Origin project, without Origin (``qz convert`` on
the command line is the batch form of the second call)::

    books = qz.read_origin_books("legacy.opj")     # one DataStruct per book/sheet
    for b in books:
        print(b.metadata["origin_book"], b.metadata["origin_folder_path"], b.n_points)
    report = qz.convert_origin_project("legacy.opj", "out", "xlsx")
    qz.save_table(books[0], "first_book.csv")      # Long Name + Units header rows

A pipeline recorded in the app exports as a Python script built on this module
(``Export script`` in the Pipeline panel; ``docs/pipeline-studio-replay.md``).

Note: importing this module pulls in matplotlib (for the render helpers), so it
is heavier than ``import quantized``; the FastAPI server never imports it.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray

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
from quantized.calc.fit_autoguess import auto_guess
from quantized.calc.fit_models import FIT_MODELS, evaluate
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
    from_stats_table,
)
from quantized.calc.report_emit_peaks import from_multipeak_fit

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
from quantized.heavy_import import heavy_imports
from quantized.io.datastruct_table import write_table
from quantized.io.origin_convert import convert_origin_project as _convert_origin_project
from quantized.io.origin_project import read_origin_books as _read_origin_books
from quantized.io.registry import import_auto as load
from quantized.io.report_export import figure_target, format_value_error, to_html, to_latex
from quantized.io.report_export import render_report as _render_report_io


def read_origin_books(path: str | Path) -> list[DataStruct]:
    """Every workbook sheet of an Origin project (``.opj``/``.opju``), each its
    own DataStruct, in project order — no Origin needed.

    :func:`load` keeps the one-file-one-DataStruct contract and returns only
    the project's largest book; this returns them all. Each carries
    ``metadata["origin_book"]`` (``"Book4"``, ``"Book4@2"`` for sheet 2),
    ``metadata["origin_folder_path"]`` (its Project Explorer folders, ``[]``
    at the root) and the reader's own loss markers when the decode was
    incomplete (``origin_columns_lost``, ``origin_worksheet_losses``,
    ``x_column_recovered`` false) — check those before trusting a book;
    :func:`convert_origin_project` does. Raises ``OriginProjectError`` (a
    ``ValueError``) when the project cannot be read at all.
    """
    return _read_origin_books(Path(path))


def convert_origin_project(
    path: str | Path,
    out_dir: str | Path,
    fmt: str = "csv",
    *,
    prefix: str | None = None,
    allow_partial: bool = False,
) -> dict[str, Any]:
    """Write every book of one Origin project to ``out_dir`` as ``fmt``
    (``"csv"``, ``"xlsx"`` or ``"dwk"``) and return its report.

    Fails closed per book: a book the reader could not fully decode is
    reported and not written (``allow_partial=True`` writes it anyway, still
    reported). Never raises for an unreadable project — the report's
    ``status`` is ``"failed"`` with an ``error``. File naming and the report
    shape: ``quantized.io.origin_convert``. ``qz convert`` runs this over
    many files.
    """
    return _convert_origin_project(
        Path(path), Path(out_dir), fmt, prefix=prefix, allow_partial=allow_partial
    )


def save_table(
    data: DataStruct | Sequence[tuple[str, DataStruct]],
    path: str | Path,
    *,
    sheet_name: str = "Sheet1",
    header: bool = True,
) -> Path:
    """Write a DataStruct to ``.csv``, ``.tsv`` or ``.xlsx`` (by suffix).

    The layout is the app's own worksheet export: the X column, every value
    channel, then any Origin text columns; ``header`` writes the Long Name and
    Units rows :func:`load` reads back. For an ``.xlsx`` of several tabs pass
    ``[(tab name, DataStruct), ...]``. Returns the path written.
    """
    sheets = [(sheet_name, data)] if isinstance(data, DataStruct) else list(data)
    return write_table(sheets, Path(path), header=header)


def fit_model(
    model: str,
    x: ArrayLike,
    y: ArrayLike,
    *,
    p0: Sequence[float] | None = None,
    lower: Sequence[float] | None = None,
    upper: Sequence[float] | None = None,
    fixed: Sequence[bool] | None = None,
    weights: ArrayLike | None = None,
) -> dict[str, Any]:
    """Fit a built-in model BY NAME (``"Gaussian"``, ``"Linear"``, …) to
    ``(x, y)`` — what the app's Curve Fit and ``POST /api/fitting/fit`` do.

    ``p0`` defaults to the model's automatic initial guess from the data,
    exactly as the app's fit does; bounds default to unbounded. Returns
    :func:`curve_fit`'s result (``params``, ``errors``, ``R2``, ``yFit``…)
    plus ``paramNames``. Raises ``ValueError`` for an unknown model name.
    """
    if model not in FIT_MODELS:
        raise ValueError(f"unknown fit model {model!r}")
    xs = np.asarray(x, dtype=float)
    ys = np.asarray(y, dtype=float)

    def model_fcn(xx: NDArray[np.float64], pp: NDArray[np.float64]) -> NDArray[np.float64]:
        return np.asarray(evaluate(model, xx, pp), dtype=float)

    start = list(p0) if p0 is not None else auto_guess(model, xs, ys)
    result = curve_fit(
        xs, ys, model_fcn, start, lower=lower, upper=upper, fixed=fixed, weights=weights
    )
    result["paramNames"] = list(FIT_MODELS[model]["paramNames"])
    return result


def render_report(
    report: Mapping[str, Any],
    fmt: str,
    *,
    render_figures: bool = False,
    warnings: list[str] | None = None,
) -> tuple[bytes, str, bool]:
    """Render ``report`` to ``fmt`` (see ``io.report_export.render_report``).

    ``render_figures=True`` additionally renders every figure block's
    ``spec`` first, through the SAME exporter ``/api/export/figure`` and the
    server's own report route use (``routes.report_figures``) — so a report
    built and rendered entirely from a script embeds real figures too, not
    just the placeholder text ``io.report_export.render_report`` alone can
    produce for a spec-bearing block (PRIMARY_SOFTWARE_AUDIT_PLAN P3.6 review,
    finding 10: the pure ``io``/``calc`` layers may never import ``routes``,
    so spec rendering lives there — this wrapper is ``api.py``'s own bridge to
    it, paid for only by scripts that ask for it; the plan note on that
    finding documents why the deeper move — a calc-level ``render_figure_spec``
    shared by the route and this wrapper — is future work, not done here).
    Default ``False`` keeps this byte-identical to the plain export.
    """
    figures = None
    if render_figures:
        # Local import: quantized.routes pulls in fastapi/pydantic, a cost
        # this module's own docstring already promises to defer (matplotlib
        # there, the web stack here) -- paid only by a caller that asks. Goes
        # through heavy_imports like every other lazy quantized.* import
        # (BUG-032 guard).
        with heavy_imports("quantized.routes.report_figures"):
            from quantized.routes.report_figures import render_report_figures

        figures = render_report_figures(dict(report), figure_target(fmt))
    return _render_report_io(report, fmt, figures=figures, warnings=warnings)


__all__ = [
    # data + I/O
    "DataStruct",
    "load",
    "read_origin_books",
    "convert_origin_project",
    "save_table",
    # fitting
    "curve_fit",
    "fit_model",
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

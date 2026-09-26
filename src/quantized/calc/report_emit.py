"""Emitters: turn calc result dicts into :class:`ReportSheet`s (#36).

Each analysis already returns a plain result dict; these functions map the
known fields into the report schema (:mod:`quantized.calc.report`) so a fit,
peak fit, or stats test lands as a structured report that the #37/#38
exporters and the frontend viewer render uniformly. No new math — pure
re-shaping.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from typing import Any

from quantized.calc.report import (
    ReportSheet,
    params_block,
    section,
    table_block,
    text_block,
)

__all__ = [
    "from_anova",
    "from_batch_integrate",
    "from_curve_fit",
    "from_integrate",
    "from_multipeak_fit",
    "from_peak_model_fit",
    "from_refl_fit",
    "from_stats_table",
]


def _gof_table(result: Mapping[str, Any], keys: Sequence[tuple[str, str]]) -> dict[str, Any]:
    """A two-column goodness-of-fit table from selected result keys."""
    rows = [[label, result[key]] for label, key in keys if result.get(key) is not None]
    return table_block(["Metric", "Value"], rows, caption="Goodness of fit")


def from_curve_fit(
    result: Mapping[str, Any],
    *,
    param_names: Sequence[str],
    param_units: Sequence[str] | None = None,
    title: str = "Curve fit",
    model_name: str | None = None,
    source_refs: Sequence[Mapping[str, Any]] | None = None,
) -> ReportSheet:
    """Build a report from a ``calc.fitting`` result dict.

    ``result`` carries ``params`` / ``errors`` arrays (whose order matches
    ``param_names``) plus goodness-of-fit scalars (R2, chiSqRed, RMSE, AIC).
    """
    params = list(result.get("params", []))
    errors = list(result.get("errors", []) or [None] * len(params))
    units = list(param_units) if param_units is not None else [""] * len(params)
    if len(param_names) != len(params):
        raise ValueError(
            f"param_names ({len(param_names)}) must match params ({len(params)})"
        )
    rows = [
        {"name": param_names[i], "value": params[i],
         "error": errors[i] if i < len(errors) else None,
         "unit": units[i] if i < len(units) else ""}
        for i in range(len(params))
    ]
    blocks: list[dict[str, Any]] = []
    if model_name:
        blocks.append(text_block(f"Model: {model_name}"))
    blocks.append(params_block(rows, caption="Fitted parameters"))
    blocks.append(
        _gof_table(result, [
            ("R²", "R2"), ("Reduced χ²", "chiSqRed"),
            ("RMSE", "RMSE"), ("AIC", "AIC"),
            ("Free params", "nFree"), ("Points", "nPoints"),
        ])
    )
    return ReportSheet(
        title=title,
        sections=(section("Fit results", blocks),),
        source_refs=tuple(dict(r) for r in (source_refs or ())),
    )


# The derived per-peak quantities a model-fit peak table carries a 1σ for.
_PEAK_KEYS = ("center", "fwhm", "height", "area")
# A Voigt row's Gaussian / Lorentzian FWHM components, and their column label.
_VOIGT_WIDTHS = (("fwhmG", "FWHM (G)"), ("fwhmL", "FWHM (L)"))
_PEAK_ERR_NOTE = (
    "± is the 1σ standard error from the Peak Analyzer model fit; — marks a value "
    "it reports no error for (fixed, tied, on a bound, undetermined, or edited by hand)."
)


def _pm_opt(value: Any, err: Any) -> list[Any]:
    """:func:`_pm` for a shape parameter only some rows have: blank where absent."""
    return _pm(value, err) if _finite(value) is not None else [None, None]


def from_multipeak_fit(
    result: Mapping[str, Any],
    *,
    title: str = "Multi-peak fit",
    source_refs: Sequence[Mapping[str, Any]] | None = None,
) -> ReportSheet:
    """Build a report from a ``calc.peak_multifit`` result dict.

    A durable peak table the Peak Analyzer's model fit published (the
    frontend's ``PeakTable`` with ``producer: "model_fit"``) arrives in the
    same shape plus ``objective`` (``"ssr"`` / ``"chi2"``), ``ssr``, ``chi2``,
    ``R2`` and, per peak, the 1σ errors ``centerErr`` / ``fwhmErr`` /
    ``heightErr`` / ``areaErr`` / ``etaErr`` and a Voigt row's ``fwhmG`` /
    ``fwhmL`` (with ``fwhmGErr`` / ``fwhmLErr``), null where the fit reported
    none. Its table then gains a "±" column after each value ("—" for a null
    error, even when every error is null: the dashes are information), the
    Voigt width columns when a row has them, and the goodness-of-fit table
    gains R² (labelled weighted for a χ² fit, calc/peak_model_fit.py), SSR and
    χ² (weighted fits only). A payload with neither ``objective`` nor any
    finite error (every classic fit) is laid out exactly as before.
    (Ported from PR #434, adapted to the PeakTable field names.)
    """
    peaks = list(result.get("peaks", []))
    objective = result.get("objective")
    model_fit = objective in ("ssr", "chi2")
    has_err = model_fit or any(
        _finite(pk.get(f"{k}Err")) is not None for pk in peaks for k in _PEAK_KEYS)
    widths = [(k, label) for k, label in _VOIGT_WIDTHS
              if has_err and any(_finite(pk.get(k)) is not None for pk in peaks)]
    if has_err:
        cols = ["Peak", "Model", "Center", "± center", "FWHM", "± FWHM", "Height", "± height",
                "Area", "± area", "η", "± η"]
        cols += [c for _, label in widths for c in (label, f"± {label}")]
    else:
        cols = ["Peak", "Model", "Center", "FWHM", "Height", "Area", "η"]
    # Rows the user edited by hand are not fit output; say so rather than let
    # manual numbers read as fitted values. Only shown when there are any.
    n_edited = sum(1 for pk in peaks if pk.get("status") == "manual-edit")
    if n_edited:
        cols.append("Source")
    rows = []
    for i, pk in enumerate(peaks, start=1):
        if has_err:
            values = [v for k in _PEAK_KEYS for v in _pm(pk.get(k), pk.get(f"{k}Err"))]
            values += _pm_opt(pk.get("eta"), pk.get("etaErr"))
            values += [v for k, _ in widths for v in _pm_opt(pk.get(k), pk.get(f"{k}Err"))]
        else:
            values = [pk.get("center"), pk.get("fwhm"), pk.get("height"),
                      pk.get("area"), pk.get("eta")]
        row = [i, pk.get("model", result.get("model", "")), *values]
        if n_edited:
            row.append("edited by hand" if pk.get("status") == "manual-edit" else "fit")
        rows.append(row)
    caption = f"{len(peaks)} peak(s)" + (f", {n_edited} edited by hand" if n_edited else "")
    gof = [("RMSE", "rmse"), ("Peaks", "nPeaks")]
    if model_fit:
        chi2 = objective == "chi2"
        gof += [("weighted R²" if chi2 else "R²", "R2"), ("SSR", "ssr")]
        gof += [("χ²", "chi2")] if chi2 else []
    blocks: list[dict[str, Any]] = [
        table_block(cols, rows, caption=caption),
        _gof_table(result, gof),
    ]
    if has_err:
        blocks.append(text_block(_PEAK_ERR_NOTE))
    return ReportSheet(
        title=title,
        sections=(section("Peak fit", blocks),),
        source_refs=tuple(dict(r) for r in (source_refs or ())),
    )


# The objective each reflectivity weighting minimises, labelled for what it is:
# only dR weighting is a chi-square (calc/refl_fit.py). Same labels as the
# frontend's reflFitModel.objectiveSummary.
_REFL_OBJECTIVE: dict[str, tuple[str, str]] = {
    "dr": ("Reduced χ²", "reduced_chi2"),
    "log": ("Reduced Σ(Δlog₁₀R)²", "reduced_sum_sq_log"),
}
_NONE = "—"


def _finite(v: Any) -> float | None:
    """``v`` as a float when it is a finite number, else None."""
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    return float(v) if math.isfinite(v) else None


def _refl_status(p: Mapping[str, Any]) -> str:
    if p.get("tie"):
        return f"tied to {p['tie']}"
    if not p.get("vary"):
        return "fixed"
    return "at bound" if p.get("at_bound") else "free"


def from_refl_fit(
    result: Mapping[str, Any],
    *,
    title: str = "Reflectivity fit",
    source_refs: Sequence[Mapping[str, Any]] | None = None,
) -> ReportSheet:
    """Build a report from a ``calc.refl_fit.fit_reflectivity`` result dict.

    A parameter table (value and standard error, "—" where the fit reports
    none: a fixed or tied parameter, one that ended on a bound, or one the
    data do not determine), a stats line (the objective under its honest
    label, points, free parameters, convergence) and one line per warning.
    Fitted curves, if present, are ignored.

    With a DREAM posterior summary in ``result["posterior"]`` (the shape of
    ``calc.refl_dream.sample_reflectivity``'s parameters and convergence, as a
    saved fit record keeps it), the table gains 68% and 95% credible-interval
    columns ("—" for a parameter the posterior does not cover) and two notes
    give the draws, chains, burn-in and thinning, and the R-hat verdict,
    naming any parameter above the threshold (its interval is not trustworthy).
    """
    weighting = result.get("weighting")
    if weighting not in _REFL_OBJECTIVE:
        raise ValueError("from_refl_fit needs weighting 'dr' or 'log'")
    params = list(result.get("parameters") or [])
    if not params:
        raise ValueError("from_refl_fit needs a result with parameters")
    posterior = result.get("posterior")
    post = posterior if isinstance(posterior, Mapping) else None
    by_name = {str(q.get("name")): q for q in (post or {}).get("parameters") or []
               if isinstance(q, Mapping)}
    columns = ["Parameter", "Value", "± stderr"]
    if post is not None:
        columns += ["68% interval", "95% interval"]
    rows = []
    for p in params:
        err = _finite(p.get("stderr"))
        row = [p.get("name", ""), _finite(p.get("value")), _NONE if err is None else err]
        if post is not None:
            q = by_name.get(str(p.get("name")), {})
            row += [_interval_text(q.get("interval68")), _interval_text(q.get("interval95"))]
        rows.append([*row, _refl_status(p)])
    label, key = _REFL_OBJECTIVE[weighting]
    value = _finite(result.get(key))
    shown = _NONE if value is None else format(value, ".6g")
    converged = "yes" if result.get("success") else "no"
    stats = (
        f"{label} = {shown} · points = {result.get('n_points')} · "
        f"free parameters = {result.get('n_free')} · converged: {converged}"
    )
    blocks: list[dict[str, Any]] = [
        table_block([*columns, "Status"], rows, caption="Fitted parameters"),
        text_block(stats),
    ]
    if result.get("message"):
        blocks.append(text_block(f"Optimizer: {result['message']}"))
    blocks.extend(text_block(f"Warning: {w}") for w in result.get("warnings") or [])
    if post is not None:
        blocks.extend(_posterior_notes(post))
    return ReportSheet(
        title=title,
        sections=(section("Fit results", blocks),),
        source_refs=tuple(dict(r) for r in (source_refs or ())),
    )


# The mixed-shape peak model's objective under its honest label: chi-square only
# for a weighted fit (calc/peak_model_fit.py reports which in ``objective``).
_PEAK_OBJECTIVE: dict[str, tuple[tuple[str, str], ...]] = {
    "ssr": (("SSR", "ssr"), ("Reduced SSR", "reduced_ssr")),
    "chi2": (("χ²", "chi2"), ("Reduced χ²", "reduced_chi2")),
}


def _pm(value: Any, err: Any) -> list[Any]:
    """A value and its standard error as two cells, the dash where absent."""
    e = _finite(err)
    return [_finite(value), _NONE if e is None else e]


def _fmt6(v: Any) -> str:
    f = _finite(v)
    return _NONE if f is None else format(f, ".6g")


def from_peak_model_fit(
    result: Mapping[str, Any],
    *,
    title: str = "Peak model fit",
    source_refs: Sequence[Mapping[str, Any]] | None = None,
) -> ReportSheet:
    """Build a report from a ``calc.peak_model_fit.fit_peak_model`` result
    (audit P2.4; the Peak Analyzer sends it without its curves).

    A per-peak table (shape, then centre / FWHM / height / area, each with its
    standard error), the parameter table (value, standard error, status: free,
    fixed, tied, at bound), the metrics under the objective's honest label
    (SSR for an unweighted fit, chi-square only for a weighted one) and one
    line per warning. "—" marks every error the fit does not report.
    """
    metrics = result.get("metrics")
    m: Mapping[str, Any] = metrics if isinstance(metrics, Mapping) else {}
    objective = m.get("objective")
    if objective not in _PEAK_OBJECTIVE:
        raise ValueError("from_peak_model_fit needs metrics.objective 'ssr' or 'chi2'")
    params = list(result.get("parameters") or [])
    peaks = list(result.get("peaks") or [])
    if not params or not peaks:
        raise ValueError("from_peak_model_fit needs a result with parameters and peaks")
    peak_rows = [
        [i, pk.get("shape", ""),
         *_pm(pk.get("center"), pk.get("center_stderr")),
         *_pm(pk.get("fwhm"), pk.get("fwhm_stderr")),
         *_pm(pk.get("height"), pk.get("height_stderr")),
         *_pm(pk.get("area"), pk.get("area_stderr"))]
        for i, pk in enumerate(peaks, start=1)
    ]
    param_rows = [[p.get("name", ""), *_pm(p.get("value"), p.get("stderr")), _refl_status(p)]
                  for p in params]
    bg = result.get("background")
    bg_kind = bg.get("kind") if isinstance(bg, Mapping) else None
    stats = [f"{label} = {_fmt6(m.get(key))}" for label, key in _PEAK_OBJECTIVE[objective]]
    stats += [f"R² = {_fmt6(m.get('r_squared'))}", f"adj. R² = {_fmt6(m.get('adj_r_squared'))}",
              f"AIC = {_fmt6(m.get('aic'))}", f"BIC = {_fmt6(m.get('bic'))}",
              f"points = {m.get('n_points')}", f"free parameters = {m.get('n_free')}",
              f"converged: {'yes' if result.get('success') else 'no'}"]
    blocks: list[dict[str, Any]] = [
        text_block(f"Background: {bg_kind or _NONE}"),
        table_block(["Peak", "Shape", "Center", "± center", "FWHM", "± FWHM", "Height",
                     "± height", "Area", "± area"], peak_rows, caption=f"{len(peaks)} peak(s)"),
        table_block(["Parameter", "Value", "± stderr", "Status"], param_rows,
                    caption="Fitted parameters"),
        text_block(" · ".join(stats)),
    ]
    if result.get("message"):
        blocks.append(text_block(f"Optimizer: {result['message']}"))
    blocks.extend(text_block(f"Warning: {w}") for w in result.get("warnings") or [])
    return ReportSheet(
        title=title,
        sections=(section("Peak fit", blocks),),
        source_refs=tuple(dict(r) for r in (source_refs or ())),
    )


def _interval_text(v: Any) -> str:
    """``[lo, hi]`` as plain ASCII text (6 significant digits), or the dash."""
    if not isinstance(v, Sequence) or isinstance(v, str) or len(v) != 2:
        return _NONE
    lo, hi = _finite(v[0]), _finite(v[1])
    return _NONE if lo is None or hi is None else f"[{lo:.6g}, {hi:.6g}]"


def _posterior_notes(post: Mapping[str, Any]) -> list[dict[str, Any]]:
    """The DREAM run in one line, and the R-hat verdict in another."""
    c = post.get("convergence")
    conv: Mapping[str, Any] = c if isinstance(c, Mapping) else {}
    thr = _finite(conv.get("rhat_threshold")) or 1.2
    rmax = _finite(conv.get("rhat_max"))
    run = (
        f"Posterior (DREAM): {conv.get('n_draws', _NONE)} draws from "
        f"{conv.get('n_chains', _NONE)} chains after {conv.get('burn', _NONE)} burn-in "
        f"generations, thinned by {conv.get('thin', _NONE)}; the intervals are central "
        "credible intervals of the draws."
    )
    flagged = [str(n) for n in conv.get("flagged") or []]
    unmeasured = [str(n) for n in conv.get("unmeasured") or []]
    if flagged:
        verdict = (f"R-hat above {thr:g} for {', '.join(flagged)}: those chains have not "
                   "mixed, so their intervals are not trustworthy.")
    elif unmeasured:
        verdict = (f"R-hat could not be computed for {', '.join(unmeasured)} (too few "
                   "draws): those intervals are not trustworthy.")
    elif rmax is None:
        verdict = "R-hat: not available (too few draws); the intervals are not trustworthy."
    else:
        verdict = f"R-hat max = {rmax:.3g} (all at or below {thr:g}): the chains have mixed."
    if conv.get("stopped") in ("deadline", "cancelled"):
        verdict += f" Sampling stopped early ({conv['stopped']}): the intervals are provisional."
    return [text_block(run), text_block(verdict)]


# Human labels + display order for the common ANOVA-style row-dict keys.
_STATS_COLUMNS: dict[str, str] = {
    "source": "Source", "SS": "SS", "df": "df", "MS": "MS", "F": "F", "p": "p",
    "group": "Group", "diff": "Difference", "statistic": "Statistic",
    "ciLow": "CI low", "ciHigh": "CI high", "significant": "Significant",
    "i": "i", "j": "j",
}


def from_stats_table(
    records: Sequence[Mapping[str, Any]],
    *,
    title: str,
    section_title: str = "Results",
    columns: Sequence[str] | None = None,
    caption: str | None = None,
    source_refs: Sequence[Mapping[str, Any]] | None = None,
) -> ReportSheet:
    """Build a report from a list of uniform row-dicts (ANOVA, post-hoc, ...).

    ``columns`` selects/orders the dict keys to show; by default it uses the
    keys of the first record, relabeled via a small known-key map.
    """
    if not records:
        raise ValueError("from_stats_table needs at least one record")
    keys = list(columns) if columns is not None else list(records[0].keys())
    headers = [_STATS_COLUMNS.get(k, k) for k in keys]
    rows = [[rec.get(k) for k in keys] for rec in records]
    return ReportSheet(
        title=title,
        sections=(section(section_title, [table_block(headers, rows, caption=caption)]),),
        source_refs=tuple(dict(r) for r in (source_refs or ())),
    )


def from_anova(
    result: Mapping[str, Any],
    *,
    title: str = "ANOVA",
    source_refs: Sequence[Mapping[str, Any]] | None = None,
) -> ReportSheet:
    """Build a report from any ANOVA result dict carrying a ``table`` key."""
    table = result.get("table")
    if not table:
        raise ValueError("from_anova needs a result with a non-empty 'table'")
    return from_stats_table(
        table, title=title, section_title="ANOVA table",
        columns=["source", "SS", "df", "MS", "F", "p"],
        source_refs=source_refs,
    )


def from_integrate(
    result: Mapping[str, Any],
    *,
    title: str = "Peak integration",
    source_refs: Sequence[Mapping[str, Any]] | None = None,
) -> ReportSheet:
    """Build a report from a ``calc.peak_integrate.integrate_peaks`` result."""
    peaks = list(result.get("peaks", []))
    if not peaks:
        raise ValueError("from_integrate needs a result with peaks")
    cols = ["Region", "Area", "% area", "Centroid", "Height", "Position", "FWHM"]
    rows = []
    for i, pk in enumerate(peaks, start=1):
        region = pk.get("region")
        region_str = f"{region[0]:g}–{region[1]:g}" if isinstance(region, list) else i
        rows.append([
            region_str, pk.get("area"), pk.get("area_pct"), pk.get("centroid"),
            pk.get("height"), pk.get("position"), pk.get("fwhm"),
        ])
    caption = f"{len(peaks)} region(s), {result.get('baseline')} baseline"
    blocks = [
        table_block(cols, rows, caption=caption),
        text_block(f"Total net area: {result.get('total_area')}"),
    ]
    return ReportSheet(
        title=title,
        sections=(section("Integration", blocks),),
        source_refs=tuple(dict(r) for r in (source_refs or ())),
    )


def from_batch_integrate(
    result: Mapping[str, Any],
    *,
    title: str = "Batch peak integration",
    source_refs: Sequence[Mapping[str, Any]] | None = None,
) -> ReportSheet:
    """Build a report from a ``calc.peak_batch.batch_integrate_peaks`` result.

    The area matrix (spectrum x region) becomes a trend table — one row per
    spectrum, one column per region — plus per-spectrum alignment shift.
    """
    results = list(result.get("results", []))
    regions = list(result.get("regions", []))
    if not results or not regions:
        raise ValueError("from_batch_integrate needs results and regions")
    area_m = result.get("area_matrix", [])
    region_cols = [f"{r[0]:g}–{r[1]:g}" for r in regions]
    header = ["Spectrum", *(["Shift"] if result.get("aligned") else []), *region_cols]
    rows = []
    for i, row in enumerate(results):
        cells: list[Any] = [row.get("label", i)]
        if result.get("aligned"):
            cells.append(row.get("shift_samples"))
        cells.extend(area_m[i] if i < len(area_m) else [None] * len(regions))
        rows.append(cells)
    n_failed = result.get("n_failed", 0)
    caption = f"{len(results)} spectra × {len(regions)} region(s)"
    if n_failed:
        caption += f" ({n_failed} failed)"
    return ReportSheet(
        title=title,
        sections=(section("Area trends", [table_block(header, rows, caption=caption)]),),
        source_refs=tuple(dict(r) for r in (source_refs or ())),
    )

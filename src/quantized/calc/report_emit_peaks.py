"""Peak-table emitters: multi-peak and mixed-shape model fits -> :class:`ReportSheet`.

Split out of :mod:`quantized.calc.report_emit` (the 500-line module ceiling)
when the multi-peak emitter learned to print a published model-fit table's
errors (ported from PR #434). Same contract: no new math, pure re-shaping.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from quantized.calc.report import ReportSheet, section, table_block, text_block
from quantized.calc.report_emit import _NONE, _finite, _gof_table, _refl_status

__all__ = ["from_multipeak_fit", "from_peak_model_fit"]


# The derived per-peak quantities a model-fit peak table carries a 1σ for.
_PEAK_KEYS = ("center", "fwhm", "height", "area")
# A Voigt row's Gaussian / Lorentzian FWHM components, and their column label.
_VOIGT_WIDTHS = (("fwhmG", "FWHM (G)"), ("fwhmL", "FWHM (L)"))
_PEAK_ERR_NOTE = (
    "± is the 1σ standard error the fit reported; — marks a value it reports no "
    "error for (fixed, tied, on a bound, undetermined, or edited by hand)."
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
    A peak with ``excluded: true`` (the user unticked it; every downstream
    consumer omits it) gets an "Included" column saying so, and the caption
    counts it; only shown when there is one.
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
    n_excluded = sum(1 for pk in peaks if pk.get("excluded") is True)
    if n_excluded:
        cols.append("Included")
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
        if n_excluded:
            row.append("no (excluded)" if pk.get("excluded") is True else "yes")
        rows.append(row)
    caption = f"{len(peaks)} peak(s)" + (f", {n_edited} edited by hand" if n_edited else "")
    caption += f", {n_excluded} excluded" if n_excluded else ""
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

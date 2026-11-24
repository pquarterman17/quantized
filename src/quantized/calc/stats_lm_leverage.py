"""Fit Model: effect leverage plots (partial regression / added-variable plots).

For a term ``t`` with design columns ``X_t`` and the remaining columns
``X_-t`` (intercept included), let ``M = I - X_-t (X_-t' X_-t)^-1 X_-t'``.
Frisch-Waugh-Lovell: the OLS coefficients of ``M y`` on ``M X_t`` equal the
full model's ``b_t`` and the residuals are the full model's residuals. A
leverage plot (JMP Fit Least Squares, *Effect Leverage Plots*,
https://www.jmp.com/support/help/en/18.1/jmp/effect-leverage-plots.shtml;
Sall, "Leverage plots for general linear hypotheses", The American Statistician
44 (1990) 308-313) plots, for each row,

* ``x = (M X_t b_t)_i`` - the part of the row's fit that belongs to the term,
  with the other effects partialled out (for a one-column term this is
  ``b_t`` times the added-variable abscissa ``M x_t``);
* ``y = x + e_i`` - that plus the full-model residual, which is ``(M y)_i``.

So the points scatter about the fit line ``y = x`` (slope 1, the fitted
effect) and the hypothesis "the term has no effect" is the horizontal line
``y = 0``. The squared distance of the fit line from that hypothesis,
``sum(x^2)``, is exactly the term's effect-test sum of squares, and the
residual spread is the model's: a term whose points hug ``y = x`` more tightly
than ``y = 0`` is significant. (Provisional, owner to confirm: for one-column
terms JMP puts the added-variable ``M x_t`` on the x axis rather than
``b_t M x_t``; the points and the test are the same up to that rescale.)
Pure numpy; validated in ``tests/test_stats_lm_leverage.py`` against
statsmodels' added-variable residuals.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.calc.stats_lm_design import ModelSpec, term_label, term_slices


def _project_out(others: NDArray[np.float64], v: NDArray[np.float64]) -> NDArray[np.float64]:
    """``M v``: ``v`` with the column space of ``others`` removed (QR on
    column-normalised columns, so badly scaled polynomials stay stable)."""
    norms = np.linalg.norm(others, axis=0)
    norms[norms == 0] = 1.0
    q, _ = np.linalg.qr(others / norms)
    return np.asarray(v - q @ (q.T @ v), dtype=float)


def leverage_plots(
    spec: ModelSpec,
    x: NDArray[np.float64],
    beta: NDArray[np.float64],
    resid: NDArray[np.float64],
) -> list[dict[str, Any]]:
    """One ``{"effect", "x", "y"}`` per model term, over the fitted rows."""
    out: list[dict[str, Any]] = []
    for term, sl in zip(spec.terms, term_slices(spec), strict=True):
        cols = np.arange(sl.start, sl.stop)
        others = np.delete(x, cols, axis=1)
        u = _project_out(others, x[:, sl] @ beta[sl])
        out.append(
            {
                "effect": term_label(term),
                "x": u.tolist(),
                "y": (u + resid).tolist(),
            }
        )
    return out

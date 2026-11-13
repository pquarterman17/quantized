"""Uncertainty propagation through the LINEAR signal transforms.

Pure calc layer (worksheet audit #9). Smoothing (moving / Gaussian /
Savitzky-Golay), the finite-difference derivative and the cumulative
trapezoid integral are all linear in ``y`` for a fixed ``x``: the output is
``A @ y`` for a matrix ``A`` that depends only on ``x`` and the settings.
For INDEPENDENT input errors ``sigma`` the output variance is therefore

    var(out_i) = sum_j A_ij**2 * sigma_j**2

-- the squared weights, NOT the squared sum of weights. That is the one
assumption made here and it is stated on purpose: neighbouring points of a
measured curve are taken as uncorrelated. After a smoothing the OUTPUTS are
correlated, which is why a smoothing followed by a derivative or an integral
is propagated as ONE composed operator (``D @ S``) rather than as two
independent steps.

``A`` is never formed densely for the integral (it is lower-triangular and
full): its variance is accumulated as running sums of variances. The other
operators are banded and built as sparse matrices, so the cost is
``O(n * window)``.

Each operator is built to reproduce :mod:`quantized.calc.processing`
EXACTLY (reflect-padded convolution, Savitzky-Golay polynomial edge fits,
MATLAB ``gradient`` end rules, NaN-as-zero trapezoids), and the tests check
``A @ y`` against those functions before checking the variance against a
Monte Carlo simulation.
"""

from __future__ import annotations

from typing import Any, TypeAlias

import numpy as np
from numpy.typing import NDArray
from scipy import sparse

__all__ = [
    "compose",
    "cumulative_trapezoid_sigma",
    "gradient_operator",
    "linear_sigma",
    "smoothing_operator",
]

#: A ``scipy.sparse.csr_matrix`` (n x n). scipy ships no precise stubs for
#: sparse arithmetic, so the alias is ``Any`` -- as in ``baseline.py``.
Operator: TypeAlias = Any


def _reflect(index: NDArray[np.int64], n: int) -> NDArray[np.int64]:
    """``smooth_data``'s padding: index -k maps to k, n-1+k maps to n-1-k."""
    out = np.where(index < 0, -index, index)
    return np.where(out > n - 1, 2 * (n - 1) - out, out)


def _convolution_operator(n: int, kernel: NDArray[np.float64]) -> Operator:
    half = (kernel.size - 1) // 2
    rows = np.repeat(np.arange(n), kernel.size)
    offsets = np.tile(np.arange(-half, half + 1), n)
    cols = _reflect(rows + offsets, n)
    data = np.tile(kernel, n)
    # Duplicate (row, col) pairs SUM (a reflected edge reads one sample
    # twice), which is exactly the weight that sample carries.
    return sparse.csr_matrix((data, (rows, cols)), shape=(n, n))


def _savgol_operator(n: int, hwc: int, poly_ord: int) -> Operator:
    """Mirror ``processing._savgol_column`` row for row, overwrites included.

    Assembled as one COO triplet list: the interior band is ``w`` vectorised
    diagonals, and only the ``2 * hwc`` edge rows (a handful, whatever ``n``)
    are built one by one.
    """
    t = np.arange(-hwc, hwc + 1, dtype=float)
    vand = np.vander(t, poly_ord + 1, increasing=True)
    kernel = np.linalg.solve(vand.T @ vand, vand.T)[0, :]
    n_pts = min(2 * hwc + 1, n)
    vand_local = np.vander(np.arange(n_pts, dtype=float), poly_ord + 1, increasing=True)
    # lstsq's (minimum-norm) solution is the pseudoinverse applied to b.
    pinv = np.linalg.pinv(vand_local)
    # Edge rows, written in the SAME order as the source loop so a later write
    # to the same row wins exactly as it does there (short columns overlap).
    edges: dict[int, tuple[int, np.ndarray]] = {}
    for i in range(1, hwc + 1):
        left = np.vander([float(i - 1)], poly_ord + 1, increasing=True)[0] @ pinv
        right_t = float(n_pts - 1 - (i - 1))
        right = np.vander([right_t], poly_ord + 1, increasing=True)[0] @ pinv
        edges[i - 1] = (0, left)
        edges[n - i] = (n - n_pts, right)
    rows: list[np.ndarray] = []
    cols: list[np.ndarray] = []
    data: list[np.ndarray] = []
    if n > 2 * hwc:
        # np.convolve(col, kernel[::-1], "same"): out[i] = sum_q col[i+q-h] k[q].
        # Interior rows only -- every column index is in range there.
        inner = np.arange(hwc, n - hwc)
        for q, weight in enumerate(kernel):
            rows.append(inner)
            cols.append(inner + (q - hwc))
            data.append(np.full(inner.size, weight))
    else:
        # Too short for the convolution: the source keeps the column as is
        # (identity) wherever an edge fit does not overwrite it.
        keep = np.array([r for r in range(n) if r not in edges], dtype=int)
        rows.append(keep)
        cols.append(keep)
        data.append(np.ones(keep.size))
    for row, (start, weights) in edges.items():
        rows.append(np.full(weights.size, row))
        cols.append(start + np.arange(weights.size))
        data.append(np.asarray(weights, dtype=float))
    triplet = (np.concatenate(data), (np.concatenate(rows), np.concatenate(cols)))
    return sparse.csr_matrix(triplet, shape=(n, n))


def smoothing_operator(
    n: int, *, method: str, window: int, poly_order: int = 2
) -> Operator:
    """The matrix ``smooth_data(y, method=, window=, poly_order=)`` applies."""
    if method not in ("moving", "gaussian", "savitzky-golay"):
        raise ValueError("method must be moving/gaussian/savitzky-golay")
    hwc = min(window, n - 1)
    if hwc < 1:
        return sparse.identity(n, format="csr")
    if method == "savitzky-golay":
        return _savgol_operator(n, hwc, min(poly_order, 2 * hwc))
    w_len = 2 * hwc + 1
    if method == "moving":
        kernel = np.full(w_len, 1.0 / w_len)
    else:
        sigma = hwc / 2.0
        t = np.arange(-hwc, hwc + 1, dtype=float)
        kernel = np.exp(-(t**2) / (2.0 * sigma**2))
        kernel = kernel / kernel.sum()
    return _convolution_operator(n, kernel)


def gradient_operator(x: NDArray[np.float64]) -> Operator:
    """The matrix MATLAB ``gradient(F, X)`` applies (``processing._matlab_gradient``)."""
    xv = np.asarray(x, dtype=float).ravel()
    n = xv.size
    if n < 2:
        return sparse.csr_matrix((n, n))
    rows: list[int] = [0, 0, n - 1, n - 1]
    cols: list[int] = [0, 1, n - 2, n - 1]
    d0, d1 = 1.0 / (xv[1] - xv[0]), 1.0 / (xv[-1] - xv[-2])
    data: list[float] = [-d0, d0, -d1, d1]
    if n > 2:
        inner = np.arange(1, n - 1)
        inv = 1.0 / (xv[2:] - xv[:-2])
        rows += [*inner.tolist(), *inner.tolist()]
        cols += [*(inner - 1).tolist(), *(inner + 1).tolist()]
        data += [*(-inv).tolist(), *inv.tolist()]
    return sparse.csr_matrix((data, (rows, cols)), shape=(n, n))


def compose(outer: Operator | None, inner: Operator | None) -> Operator | None:
    """``outer @ inner``, with ``None`` standing for the identity."""
    if outer is None:
        return inner
    if inner is None:
        return outer
    return sparse.csr_matrix(outer @ inner)


def linear_sigma(op: Operator, sigma: NDArray[np.float64]) -> NDArray[np.float64]:
    """Standard deviation of ``op @ y`` for independent errors ``sigma``.

    A NaN ``sigma`` (an unknown uncertainty) makes every output that reads
    that sample NaN -- unknown in, unknown out.
    """
    s2 = np.square(np.abs(np.asarray(sigma, dtype=float)))
    squared = op.multiply(op)
    return np.asarray(np.sqrt(squared @ s2), dtype=float)


def cumulative_trapezoid_sigma(
    x: NDArray[np.float64],
    sigma: NDArray[np.float64],
    integrand: NDArray[np.float64],
    *,
    pre: Operator | None = None,
) -> NDArray[np.float64]:
    """Standard deviation of ``cumulative_integral(x, pre @ y)``.

    ``integrand`` is the series actually integrated (``pre @ y``): where it
    is NaN, ``cumulative_integral`` integrates a 0 and restores NaN on that
    row, so those samples carry no weight here and the row is NaN.

    With ``pre`` absent the output is a running sum of independent terms and
    the variance is a cumulative sum of variances. With a smoothing ``pre``
    the integrated samples are correlated; the composed row is
    ``r_i = Q_{i-1} + b_i S_i`` (``Q_m = sum_{k<=m} a_k S_k``). Its squared
    norm follows from the banded Gram matrix ``M = S diag(sigma**2) S^T`` and
    one cumulative sum (no Python loop over rows), so this stays
    ``O(n * window)`` without forming the dense ``C @ S``.
    """
    xv = np.asarray(x, dtype=float).ravel()
    s2 = np.square(np.abs(np.asarray(sigma, dtype=float)))
    z = np.asarray(integrand, dtype=float).ravel()
    n = xv.size
    out = np.zeros(n)
    if n == 0:
        return out
    live = ~np.isnan(z)
    dx = np.diff(xv)
    # Trapezoid weights: a_k is sample k's weight in every LATER row's sum,
    # b_i its weight in its own row (the right end of the last panel).
    a = np.empty(n)
    a[0] = dx[0] / 2.0 if n > 1 else 0.0
    if n > 1:
        a[1:-1] = (dx[:-1] + dx[1:]) / 2.0
        a[-1] = dx[-1] / 2.0  # unused (no row after the last)
    b = np.zeros(n)
    b[1:] = dx / 2.0
    a = np.where(live, a, 0.0)
    b = np.where(live, b, 0.0)
    if pre is None:
        terms = np.where(live, s2, 0.0)
        prefix = np.concatenate([[0.0], np.cumsum(a[:-1] ** 2 * terms[:-1])])
        out = prefix + b**2 * terms
    else:
        # Rows of S whose integrand is NaN carry no weight (a = b = 0 there);
        # dropping them keeps their NaNs out of every product below.
        s_live = sparse.csr_matrix(sparse.diags(live.astype(float)) @ sparse.csr_matrix(pre))
        s_live.eliminate_zeros()
        # M[k, l] = <S_k, S_l>_sigma -- banded (twice the smoothing band).
        gram = sparse.csr_matrix(s_live @ sparse.diags(s2) @ s_live.T)
        diag = np.asarray(gram.diagonal(), dtype=float)
        a_tail = a.copy()
        a_tail[-1] = 0.0  # no row comes after the last
        # g[i] = <Q_{i-1}, S_i>_sigma = sum_{k<i} a_k M[k, i].
        g = np.asarray(sparse.tril(gram, k=-1) @ a_tail, dtype=float)
        # N(Q_m) = N(Q_{m-1}) + 2 a_m g_m + a_m^2 M[m, m].
        norm_q = np.cumsum(2.0 * a_tail * g + a_tail**2 * diag)
        before = np.concatenate([[0.0], norm_q[:-1]])
        out = before + 2.0 * b * g + b**2 * diag
    result = np.sqrt(out)
    result[~live] = np.nan
    return np.asarray(result, dtype=float)

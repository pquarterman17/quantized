"""PLS1 / PLS2 regression for multivariate calibration (GAP_AUDIT_9 G12).

Pure numpy. Each component is extracted by NIPALS: the weight vector is the
dominant left singular vector of the deflated ``X'Y`` (the fixed point of the
NIPALS inner loop, obtained exactly by an SVD instead of by iteration), the
score is ``t = X w``, the loadings are ``p = X't/(t't)`` and ``q = Y't/(t't)``,
and both blocks are deflated by regression on ``t``. For one response (PLS1)
this is the classical algorithm of Wold, Sjostrom and Eriksson (Chemom. Intell.
Lab. Syst. 58, 2001, 109-130, doi:10.1016/S0169-7439(01)00155-1); for several
responses it is the PLS2 "regression" deflation used by scikit-learn's
``PLSRegression``, which is the test oracle (``tests/test_calc_stats_pls.py``).

Preprocessing (``preprocess``): ``"center"`` subtracts column means (default,
provisional, owner to confirm), ``"autoscale"`` also divides by the sample
standard deviation (ddof = 1), ``"none"`` uses the raw data. Scaling is always
estimated on the training rows only, including inside every CV fold.

Cross-validation is k-fold with a seeded shuffle (``numpy.random.default_rng
(seed)``), so a given ``(seed, folds)`` always yields the same folds.
``Q2 = 1 - PRESS/SST`` (SST about the full-data mean); with several responses
the number of components is chosen by the smallest mean of ``PRESS_m/SST_m``.

VIP follows Wold (1994) / Chong and Jun (Chemom. Intell. Lab. Syst. 78, 2005,
103-112, doi:10.1016/j.chemolab.2004.12.011): sum of VIP^2 over the variables
equals the number of variables.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

import numpy as np
from numpy.typing import NDArray

Preprocess = Literal["none", "center", "autoscale"]
PREPROCESS: tuple[str, ...] = ("none", "center", "autoscale")
MAX_FOLDS_DEFAULT = 10


@dataclass(frozen=True)
class PlsModel:
    """A fitted PLS model in the scaled space plus the preprocessing."""

    mx: NDArray[np.float64]
    sx: NDArray[np.float64]
    my: NDArray[np.float64]
    sy: NDArray[np.float64]
    weights: NDArray[np.float64]  # W, p x A (unit columns)
    x_loadings: NDArray[np.float64]  # P, p x A
    y_loadings: NDArray[np.float64]  # Q, m x A
    scores: NDArray[np.float64]  # T, n x A
    x_ss: float  # total sum of squares of the preprocessed X
    rotations: NDArray[np.float64]  # R = W (P'W)^-1, p x A

    @property
    def n_components(self) -> int:
        return int(self.weights.shape[1])

    def coef_scaled(self, a: int | None = None) -> NDArray[np.float64]:
        """Coefficients on the preprocessed scale using the first ``a`` components."""
        k = self.n_components if a is None else a
        return np.asarray(self.rotations[:, :k] @ self.y_loadings[:, :k].T, dtype=float)

    def coef(self, a: int | None = None) -> NDArray[np.float64]:
        """Regression coefficients in the ORIGINAL units (p x m)."""
        b = self.coef_scaled(a) / self.sx[:, None] * self.sy[None, :]
        return np.asarray(b, dtype=float)

    def intercept(self, a: int | None = None) -> NDArray[np.float64]:
        return np.asarray(self.my - self.mx @ self.coef(a), dtype=float)

    def predict(self, x: NDArray[np.float64], a: int | None = None) -> NDArray[np.float64]:
        return np.asarray(x @ self.coef(a) + self.intercept(a), dtype=float)


def max_components(n: int, p: int) -> int:
    """Largest extractable number of components: the rank bound of centred X."""
    return max(0, min(n - 1, p))


def _as_xy(x: Any, y: Any) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    xa = np.asarray(x, dtype=float)
    ya = np.asarray(y, dtype=float)
    if xa.ndim != 2:
        raise ValueError("X must be a 2-D matrix (observations x variables)")
    if ya.ndim == 1:
        ya = ya[:, None]
    if ya.ndim != 2:
        raise ValueError("Y must be a vector or a 2-D matrix (observations x responses)")
    if xa.shape[0] != ya.shape[0]:
        raise ValueError(f"X has {xa.shape[0]} rows but Y has {ya.shape[0]}")
    if xa.shape[0] < 3:
        raise ValueError(f"PLS needs at least 3 observations, got {xa.shape[0]}")
    if xa.shape[1] < 1 or ya.shape[1] < 1:
        raise ValueError("X and Y each need at least one column")
    if not (np.all(np.isfinite(xa)) and np.all(np.isfinite(ya))):
        raise ValueError("X and Y must contain only finite values (found NaN or Inf)")
    return xa, ya


def _prep(
    a: NDArray[np.float64], mode: str, what: str
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    if mode not in PREPROCESS:
        raise ValueError(f"preprocess must be one of {PREPROCESS}, got {mode!r}")
    mu = a.mean(axis=0) if mode != "none" else np.zeros(a.shape[1])
    if mode != "autoscale":
        return mu, np.ones(a.shape[1])
    sd = a.std(axis=0, ddof=1)
    flat = np.flatnonzero(sd <= 1e-12 * np.maximum(1.0, np.abs(mu)))
    if flat.size:
        cols = ", ".join(str(int(i) + 1) for i in flat[:8])
        raise ValueError(
            f"autoscale cannot scale {what} column(s) {cols} (zero variance); "
            "remove them or use centre-only preprocessing"
        )
    return mu, sd


def pls_fit(x: Any, y: Any, n_components: int, *, preprocess: Preprocess = "center") -> PlsModel:
    """Fit PLS1/PLS2 with ``n_components`` components (NIPALS, regression deflation)."""
    xa, ya = _as_xy(x, y)
    n, p = xa.shape
    amax = max_components(n, p)
    if not 1 <= n_components <= amax:
        raise ValueError(
            f"n_components must be between 1 and {amax} (n={n}, p={p}), got {n_components}"
        )
    mx, sx = _prep(xa, preprocess, "X")
    my, sy = _prep(ya, preprocess, "Y")
    xk = (xa - mx) / sx
    yk = (ya - my) / sy
    x_ss = float(np.sum(xk * xk))
    if x_ss == 0.0:
        raise ValueError("X has no variance after preprocessing")
    w_l: list[NDArray[np.float64]] = []
    p_l: list[NDArray[np.float64]] = []
    q_l: list[NDArray[np.float64]] = []
    t_l: list[NDArray[np.float64]] = []
    s0 = 0.0
    for k in range(n_components):
        u, s, _ = np.linalg.svd(xk.T @ yk, full_matrices=False)
        if k == 0:
            s0 = float(s[0])
        if s0 == 0.0 or s[0] <= 1e-10 * s0:
            raise ValueError(
                f"only {k} component(s) can be extracted: the remaining X is uncorrelated with Y"
            )
        w = u[:, 0]
        # Deterministic sign: largest-magnitude weight positive.
        if w[int(np.argmax(np.abs(w)))] < 0:
            w = -w
        t = xk @ w
        tt = float(t @ t)
        if tt <= 0.0:
            raise ValueError(f"component {k + 1} has a zero score vector")
        pl = xk.T @ t / tt
        ql = yk.T @ t / tt
        xk = xk - np.outer(t, pl)
        yk = yk - np.outer(t, ql)
        w_l.append(w)
        p_l.append(pl)
        q_l.append(ql)
        t_l.append(t)
    w_m = np.column_stack(w_l)
    p_m = np.column_stack(p_l)
    rot = w_m @ np.linalg.inv(p_m.T @ w_m)
    return PlsModel(
        mx=mx,
        sx=sx,
        my=my,
        sy=sy,
        weights=w_m,
        x_loadings=p_m,
        y_loadings=np.column_stack(q_l),
        scores=np.column_stack(t_l),
        x_ss=x_ss,
        rotations=np.asarray(rot, dtype=float),
    )


def vip_scores(model: PlsModel) -> NDArray[np.float64]:
    """Variable importance in projection (mean VIP^2 equals 1)."""
    t_ss = np.sum(model.scores**2, axis=0)
    ssy = np.sum(model.y_loadings**2, axis=0) * t_ss  # per component
    p = model.weights.shape[0]
    tot = float(ssy.sum())
    if tot == 0.0:
        return np.full(p, np.nan)
    return np.asarray(np.sqrt(p * (model.weights**2 @ ssy) / tot), dtype=float)


def fold_indices(n: int, folds: int, seed: int) -> list[NDArray[np.intp]]:
    """Deterministic k-fold test-index sets: a seeded shuffle split into ``folds``."""
    if folds < 2 or folds > n:
        raise ValueError(
            f"folds must be between 2 and the number of observations ({n}), got {folds}"
        )
    perm = np.random.default_rng(seed).permutation(n)
    return [np.sort(f) for f in np.array_split(perm, folds)]


def pls_cross_validate(
    x: Any,
    y: Any,
    max_comp: int,
    *,
    folds: int = 7,
    seed: int = 0,
    preprocess: Preprocess = "center",
) -> dict[str, Any]:
    """k-fold CV of PLS for 1..A components; PRESS, RMSECV and Q2 per component.

    ``A`` is capped by what every training fold can extract. Arrays are
    ``A x m`` (component by response); ``cv_pred`` is ``A x n x m``.
    """
    xa, ya = _as_xy(x, y)
    n, p = xa.shape
    m = ya.shape[1]
    test_sets = fold_indices(n, folds, seed)
    n_train_min = n - max(len(t) for t in test_sets)
    cap = min(max_comp, max_components(n_train_min, p))
    if cap < 1:
        raise ValueError(f"too few training rows per fold ({n_train_min}) for cross-validation")
    pred = np.zeros((cap, n, m))
    for test in test_sets:
        train = np.setdiff1d(np.arange(n), test)
        model = pls_fit(xa[train], ya[train], cap, preprocess=preprocess)
        for a in range(1, cap + 1):
            pred[a - 1, test] = model.predict(xa[test], a)
    sst = np.sum((ya - ya.mean(axis=0)) ** 2, axis=0)
    press = np.sum((ya[None] - pred) ** 2, axis=1)  # A x m
    with np.errstate(divide="ignore", invalid="ignore"):
        q2 = 1.0 - press / sst[None, :]
        rel = np.where(sst > 0, press / np.where(sst > 0, sst, 1.0), np.nan)
    score = np.nanmean(rel, axis=1) if np.any(np.isfinite(rel)) else press.sum(axis=1)
    return {
        "folds": folds,
        "seed": seed,
        "max_components": cap,
        "press": press,
        "rmsecv": np.sqrt(press / n),
        "q2": q2,
        "q2_mean": np.nanmean(q2, axis=1),
        "best": int(np.argmin(score)) + 1,
        "cv_pred": pred,
    }


def pls_analysis(
    x: Any,
    y: Any,
    *,
    n_components: int | None = None,
    max_comp: int = 10,
    folds: int = 7,
    seed: int = 0,
    preprocess: Preprocess = "center",
) -> dict[str, Any]:
    """Cross-validate, choose the components (unless fixed) and report everything.

    ``n_components=None`` picks the component count with the smallest PRESS
    (provisional rule, owner to confirm); a fixed count is honoured as given.
    """
    xa, ya = _as_xy(x, y)
    n, p = xa.shape
    m = ya.shape[1]
    amax = max_components(n, p)
    cv = pls_cross_validate(
        xa, ya, min(max_comp, amax), folds=folds, seed=seed, preprocess=preprocess
    )
    auto = n_components is None
    a = cv["best"] if n_components is None else n_components
    if not 1 <= a <= amax:
        raise ValueError(f"n_components must be between 1 and {amax}, got {a}")
    if a > cv["max_components"]:
        raise ValueError(
            f"n_components {a} exceeds the {cv['max_components']} that cross-validation "
            "could assess; lower it or use fewer folds"
        )
    model = pls_fit(xa, ya, a, preprocess=preprocess)
    fitted = model.predict(xa)
    sst = np.sum((ya - ya.mean(axis=0)) ** 2, axis=0)
    sse = np.sum((ya - fitted) ** 2, axis=0)
    with np.errstate(divide="ignore", invalid="ignore"):
        r2y = np.where(sst > 0, 1.0 - sse / np.where(sst > 0, sst, 1.0), np.nan)
    r2y_cum = []
    for k in range(1, a + 1):
        sse_k = np.sum((ya - model.predict(xa, k)) ** 2, axis=0)
        r2y_cum.append(np.where(sst > 0, 1.0 - sse_k / np.where(sst > 0, sst, 1.0), np.nan))
    r2x = np.sum(model.scores**2, axis=0) * np.sum(model.x_loadings**2, axis=0) / model.x_ss
    cv_pred = cv["cv_pred"][a - 1]
    return {
        "n": n,
        "p": p,
        "m": m,
        "n_components": a,
        "auto_components": auto,
        "preprocess": preprocess,
        "components_max": amax,
        "cv": {k: v for k, v in cv.items() if k != "cv_pred"},
        "scores": model.scores,
        "x_weights": model.weights,
        "x_loadings": model.x_loadings,
        "y_loadings": model.y_loadings,
        "x_rotations": model.rotations,
        "coef": model.coef(),
        "intercept": model.intercept(),
        "vip": vip_scores(model),
        "r2y": r2y,
        "r2y_mean": float(np.nanmean(r2y)),
        "r2y_cumulative": np.asarray(r2y_cum),
        "r2x": r2x,
        "q2": cv["q2"][a - 1],
        "q2_mean": float(cv["q2_mean"][a - 1]),
        "rmsec": np.sqrt(sse / n),
        "rmsecv": cv["rmsecv"][a - 1],
        "measured": ya,
        "predicted": fitted,
        "cv_predicted": cv_pred,
        "residuals": ya - fitted,
        "x_mean": model.mx,
        "x_scale": model.sx,
        "y_mean": model.my,
        "y_scale": model.sy,
    }

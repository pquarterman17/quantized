"""Linear discriminant analysis (GAP_AUDIT_9 G12). Pure numpy.

Classical Fisher / Gaussian LDA with a pooled within-class covariance
(denominator ``n - K``): decision function
``d_k(x) = x' S^-1 mu_k - mu_k' S^-1 mu_k / 2 + ln pi_k``, discriminant
directions from the generalised eigenproblem ``Sb w = lambda Sw w`` (whitening
by ``Sw``), scaled so ``w' Sw w = 1``. The oracle is scikit-learn's
``LinearDiscriminantAnalysis(solver="svd")`` (``tests/test_calc_stats_lda.py``).

Convention note: the pooled covariance divides by ``n - K`` (unbiased). scikit-learn
divides by ``n``, so its decision function / scores differ from ours by the exact
factors ``n/(n-K)`` and ``sqrt(n/(n-K))``; the test applies them. It also centres the
decision function on the grand mean (a class-independent offset).

Fail closed: fewer than two classes, a class with a single member, a singular
pooled covariance (for example more variables than ``n - K``, as with raw
spectra: reduce with PCA or PLS scores first) and unsupported fold counts are
refused with a reason. Cross-validation is stratified k-fold with a seeded
shuffle, so a given seed always gives the same folds.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import NDArray

_COND_LIMIT = 1e12


def _class_names(classes: NDArray[Any]) -> list[str]:
    out = []
    for c in classes.tolist():
        out.append(str(int(c)) if isinstance(c, float) and c.is_integer() else str(c))
    return out


def _fit(
    x: NDArray[np.float64], idx: NDArray[np.intp], k: int, priors: NDArray[np.float64] | None
) -> dict[str, Any]:
    n, p = x.shape
    counts = np.bincount(idx, minlength=k).astype(float)
    if np.any(counts == 0):
        raise ValueError("a class has no training rows")
    if n - k < 1:
        raise ValueError(f"need more observations than classes (n={n}, K={k})")
    pri = counts / n if priors is None else priors
    means = np.vstack([x[idx == c].mean(axis=0) for c in range(k)])
    xc = x - means[idx]
    sw = xc.T @ xc / (n - k)
    lam, vec = np.linalg.eigh(sw)
    if lam[-1] <= 0 or lam[0] <= lam[-1] / _COND_LIMIT:
        raise ValueError(
            f"the pooled within-class covariance is singular (p={p} variables, n-K={n - k}, "
            "or collinear/constant variables): drop variables or reduce them with PCA or PLS first"
        )
    whiten = vec / np.sqrt(lam)
    sinv_mu = np.asarray(vec @ ((vec.T @ means.T) / lam[:, None]), dtype=float)  # p x K
    coef = sinv_mu.T
    intercept = -0.5 * np.sum(means * coef, axis=1) + np.log(pri)
    xbar = pri @ means
    z = (means - xbar) * np.sqrt(n * pri)[:, None] @ whiten
    _, s, vt = np.linalg.svd(z, full_matrices=False)
    d = min(k - 1, p)
    scal = whiten @ vt[:d].T
    for j in range(d):  # deterministic sign: largest-magnitude entry positive
        if scal[int(np.argmax(np.abs(scal[:, j]))), j] < 0:
            scal[:, j] = -scal[:, j]
    ev = s**2
    return {
        "means": means,
        "priors": pri,
        "coef": coef,
        "intercept": intercept,
        "xbar": xbar,
        "scalings": scal,
        "explained": ev[:d] / ev.sum() if ev.sum() > 0 else np.zeros(d),
        "pooled_cov": sw,
        "counts": counts,
    }


def _decide(model: dict[str, Any], x: NDArray[np.float64]) -> NDArray[np.float64]:
    return np.asarray(x @ model["coef"].T + model["intercept"], dtype=float)


def _softmax(dec: NDArray[np.float64]) -> NDArray[np.float64]:
    e = np.exp(dec - dec.max(axis=1, keepdims=True))
    return np.asarray(e / e.sum(axis=1, keepdims=True), dtype=float)


def _stratified_folds(idx: NDArray[np.intp], k: int, folds: int, seed: int) -> NDArray[np.intp]:
    rng = np.random.default_rng(seed)
    fold = np.zeros(idx.size, dtype=np.intp)
    offset = 0
    for c in range(k):
        rows = rng.permutation(np.flatnonzero(idx == c))
        fold[rows] = (np.arange(rows.size) + offset) % folds
        offset += rows.size
    return fold


def lda_analysis(
    x: Any, labels: Any, *, priors: str = "empirical", cv_folds: int = 0, seed: int = 0
) -> dict[str, Any]:
    """Fit LDA; report scores, decision function, confusion matrix and optional CV accuracy."""
    xa = np.asarray(x, dtype=float)
    if xa.ndim != 2:
        raise ValueError("X must be a 2-D matrix (observations x variables)")
    if not np.all(np.isfinite(xa)):
        raise ValueError("X must contain only finite values (found NaN or Inf)")
    lab = np.asarray(labels)
    if lab.ndim != 1 or lab.shape[0] != xa.shape[0]:
        raise ValueError(f"need one class label per row ({xa.shape[0]}), got {lab.shape}")
    if lab.dtype.kind == "f" and not np.all(np.isfinite(lab)):
        raise ValueError("class labels must be finite")
    if priors not in ("empirical", "equal"):
        raise ValueError("priors must be 'empirical' or 'equal'")
    classes, idx = np.unique(lab, return_inverse=True)
    idx = idx.astype(np.intp)
    n, p = xa.shape
    k = classes.size
    if k < 2:
        raise ValueError("LDA needs at least two classes")
    counts = np.bincount(idx, minlength=k)
    if counts.min() < 2:
        small = _class_names(classes)[int(np.argmin(counts))]
        raise ValueError(
            f"every class needs at least 2 observations (class {small!r} has {counts.min()})"
        )
    pri = np.full(k, 1.0 / k) if priors == "equal" else None
    model = _fit(xa, idx, k, pri)
    dec = _decide(model, xa)
    pred = np.argmax(dec, axis=1)
    conf = np.zeros((k, k), dtype=int)
    np.add.at(conf, (idx, pred), 1)
    out: dict[str, Any] = {
        "n": n,
        "p": p,
        "classes": _class_names(classes),
        "n_discriminants": model["scalings"].shape[1],
        "priors": model["priors"],
        "priors_mode": priors,
        "means": model["means"],
        "coef": model["coef"],
        "intercept": model["intercept"],
        "scalings": model["scalings"],
        "explained_variance_ratio": model["explained"],
        "pooled_cov": model["pooled_cov"],
        "scores": (xa - model["xbar"]) @ model["scalings"],
        "decision": dec,
        "posterior": _softmax(dec),
        "actual": idx,
        "predicted": pred,
        "confusion": conf,
        "accuracy": float(np.mean(pred == idx)),
        "cv": None,
    }
    out["class_means_scores"] = (model["means"] - model["xbar"]) @ model["scalings"]
    if cv_folds:
        if cv_folds < 2 or cv_folds > int(counts.min()):
            raise ValueError(
                f"folds must be between 2 and the smallest class size ({int(counts.min())})"
            )
        fold = _stratified_folds(idx, k, cv_folds, seed)
        cvp = np.zeros(n, dtype=np.intp)
        for f in range(cv_folds):
            tr, te = fold != f, fold == f
            m = _fit(xa[tr], idx[tr], k, pri)
            cvp[te] = np.argmax(_decide(m, xa[te]), axis=1)
        cconf = np.zeros((k, k), dtype=int)
        np.add.at(cconf, (idx, cvp), 1)
        out["cv"] = {
            "folds": cv_folds,
            "seed": seed,
            "predicted": cvp,
            "confusion": cconf,
            "accuracy": float(np.mean(cvp == idx)),
        }
    return out

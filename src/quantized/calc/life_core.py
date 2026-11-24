"""Censored life-distribution maximum likelihood (GAP_AUDIT_9 G8): the core.

One location-scale engine serves the plain life-distribution fit (intercept
only) and Fit Life by X (one regressor): ``y = g(t)`` with ``g = ln`` for the
log families and the identity for the smallest-extreme-value family, and
``z = (y - X b) / sigma`` has the standard distribution ``G``.

- weibull     : ``G`` = smallest extreme value on ln t   (eta = e^mu, beta = 1/sigma)
- lognormal   : ``G`` = normal on ln t
- loglogistic : ``G`` = logistic on ln t
- exponential : Weibull with sigma fixed at 1 (one parameter)
- sev         : smallest extreme value on t itself

Log-likelihood is in the *t* scale (the ``-ln t`` Jacobian is kept for log
families), so log-likelihood, AICc and BIC are comparable across all five
families. Right-censoring only; ``censor`` follows JMP: 1 = censored (the unit
had not failed by its time), 0 = failed. Standard errors come from the
observed information (finite-difference Jacobian of the analytic gradient);
confidence intervals are Wald, on a log scale for positive quantities.

References: Meeker & Escobar, *Statistical Methods for Reliability Data*
(Wiley, 1998), ch. 2, 4, 5 and 7; Lawless, *Statistical Models and Methods for
Lifetime Data*, 2nd ed. (Wiley, 2003), ch. 2 and 6; NIST/SEMATECH
e-Handbook of Statistical Methods, section 8.4.1.3 (Weibull MLE example).
Provisional, owner to confirm: Wald (not likelihood-ratio) intervals.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
from numpy.typing import NDArray
from scipy import optimize
from scipy import stats as sps
from scipy.special import expit, log_expit

__all__ = [
    "DISTRIBUTIONS",
    "LIFE_DISTS",
    "LifeData",
    "MLFit",
    "check_life_data",
    "fit_ml",
    "std_quantile",
    "std_cdf",
]

LIFE_DISTS = ("weibull", "lognormal", "exponential", "loglogistic", "sev")
# family -> (standard dist, log-time?, fixed sigma?)
DISTRIBUTIONS: dict[str, tuple[str, bool, bool]] = {
    "weibull": ("sev", True, False),
    "lognormal": ("norm", True, False),
    "exponential": ("sev", True, True),
    "loglogistic": ("logis", True, False),
    "sev": ("sev", False, False),
}


def _sev(z: NDArray[np.float64]) -> tuple[Any, Any, Any, Any]:
    ez = np.exp(np.minimum(z, 700.0))
    return z - ez, 1.0 - ez, -ez, -ez  # logf, dlogf, logS, dlogS


def _norm(z: NDArray[np.float64]) -> tuple[Any, Any, Any, Any]:
    logs = sps.norm.logsf(z)
    return sps.norm.logpdf(z), -z, logs, -np.exp(sps.norm.logpdf(z) - logs)


def _logis(z: NDArray[np.float64]) -> tuple[Any, Any, Any, Any]:
    return -z + 2.0 * log_expit(z), -np.tanh(z / 2.0), log_expit(-z), -expit(z)


_STD = {"sev": _sev, "norm": _norm, "logis": _logis}


def std_cdf(std: str, z: NDArray[np.float64] | float) -> NDArray[np.float64]:
    """CDF of the standard member (``sev`` / ``norm`` / ``logis``)."""
    z = np.asarray(z, dtype=float)
    if std == "sev":
        return np.asarray(-np.expm1(-np.exp(np.minimum(z, 700.0))), dtype=float)
    if std == "norm":
        return np.asarray(sps.norm.cdf(z), dtype=float)
    return np.asarray(expit(z), dtype=float)


def std_quantile(std: str, p: NDArray[np.float64] | float) -> NDArray[np.float64]:
    """Quantile function of the standard member (the linearised probability axis)."""
    p = np.asarray(p, dtype=float)
    if std == "sev":
        return np.asarray(np.log(-np.log1p(-p)), dtype=float)
    if std == "norm":
        return np.asarray(sps.norm.ppf(p), dtype=float)
    return np.asarray(np.log(p) - np.log1p(-p), dtype=float)


@dataclass(frozen=True)
class LifeData:
    time: NDArray[np.float64]
    failed: NDArray[np.bool_]  # True = observed failure

    @property
    def n(self) -> int:
        return int(self.time.size)

    @property
    def r(self) -> int:
        return int(self.failed.sum())


def check_life_data(time: Any, censor: Any, *, log_time: bool = True) -> LifeData:
    """Validate and pack; refuses (ValueError) rather than guessing."""
    t = np.asarray(time, dtype=float).ravel()
    c = np.asarray(censor, dtype=float).ravel()
    if t.size != c.size:
        raise ValueError(f"time length {t.size} != censor length {c.size}")
    if not (np.all(np.isfinite(t)) and np.all(np.isfinite(c))):
        raise ValueError("time and censor must be finite (drop incomplete rows first)")
    if not np.all((c == 0.0) | (c == 1.0)):
        raise ValueError("censor must be 0 (failed) or 1 (censored)")
    if np.any(t < 0.0):
        raise ValueError("times must be non-negative")
    if log_time and np.any(t <= 0.0):
        raise ValueError(
            "this distribution works on ln(time), so every time must be greater than 0"
        )
    failed = c == 0.0
    if int(failed.sum()) < 2:
        raise ValueError("need at least 2 failures (censor = 0) to fit a life distribution")
    return LifeData(t, failed)


@dataclass(frozen=True)
class MLFit:
    dist: str
    beta: NDArray[np.float64]  # regression coefficients (intercept first)
    log_sigma: float
    cov: NDArray[np.float64]  # over (beta..., log_sigma); sigma row/col zero if fixed
    loglik: float
    n: int
    n_fail: int
    n_params: int
    converged: bool

    @property
    def sigma(self) -> float:
        return float(np.exp(self.log_sigma))


def _y(data: LifeData, log_time: bool) -> NDArray[np.float64]:
    return np.log(data.time) if log_time else data.time


def _nll_grad(
    theta: NDArray[np.float64],
    X: NDArray[np.float64],
    y: NDArray[np.float64],
    failed: NDArray[np.bool_],
    std: str,
    fixed_sigma: bool,
    jac: float,
) -> tuple[float, NDArray[np.float64]]:
    p = X.shape[1]
    s = 0.0 if fixed_sigma else min(max(float(theta[p]), -40.0), 40.0)
    sigma = np.exp(s)
    z = (y - X @ theta[:p]) / sigma
    logf, dlogf, logs, dlogs = _STD[std](z)
    ll = float(np.sum(np.where(failed, logf - s, logs)) - jac)
    a = np.where(failed, dlogf, dlogs)
    g = [-(X.T @ a) / sigma]
    if not fixed_sigma:
        g.append(np.array([np.sum(-z * a) - failed.sum()]))
    return -ll, -np.concatenate(g)


def fit_ml(data: LifeData, dist: str, X: NDArray[np.float64] | None = None) -> MLFit:
    """Maximum-likelihood location-scale fit; ``X`` defaults to an intercept."""
    std, log_time, fixed = DISTRIBUTIONS[dist]
    y = _y(data, log_time)
    X = np.ones((data.n, 1)) if X is None else np.asarray(X, dtype=float)
    p = X.shape[1]
    jac = float(np.sum(np.log(data.time[data.failed]))) if log_time else 0.0
    b0 = np.linalg.lstsq(X, y, rcond=None)[0]
    s0 = float(np.log(max(float(np.std(y - X @ b0)), 1e-6 * max(float(np.std(y)), 1e-12), 1e-12)))
    x0 = b0 if fixed else np.append(b0, s0)
    args = (X, y, data.failed, std, fixed, jac)

    def fun(th: NDArray[np.float64]) -> float:
        return _nll_grad(th, *args)[0]

    def grad(th: NDArray[np.float64]) -> NDArray[np.float64]:
        return _nll_grad(th, *args)[1]

    with np.errstate(all="ignore"):
        res = optimize.minimize(
            fun, x0, jac=grad, method="BFGS", options={"gtol": 1e-9, "maxiter": 500}
        )
        if not res.success or np.max(np.abs(grad(res.x))) > 1e-5 * max(1.0, data.n):
            nm = optimize.minimize(
                fun,
                res.x,
                method="Nelder-Mead",
                options={"xatol": 1e-10, "fatol": 1e-12, "maxiter": 4000},
            )
            res = optimize.minimize(
                fun, nm.x, jac=grad, method="BFGS", options={"gtol": 1e-9, "maxiter": 500}
            )
    theta = np.asarray(res.x, dtype=float)
    scaled_g = np.max(np.abs(grad(theta))) / max(1.0, data.n)
    if not np.isfinite(res.fun) or scaled_g > 1e-5:
        raise ValueError(
            f"the {dist} likelihood did not converge; the data may not support this distribution"
        )
    k = theta.size
    hess = np.empty((k, k))
    for j in range(k):
        h = 1e-5 * max(1.0, abs(theta[j]))
        up, dn = theta.copy(), theta.copy()
        up[j] += h
        dn[j] -= h
        hess[:, j] = (grad(up) - grad(dn)) / (2.0 * h)
    hess = (hess + hess.T) / 2.0
    try:
        cov_free = np.linalg.inv(hess)
        if np.any(np.diag(cov_free) <= 0) or np.any(np.linalg.eigvalsh(hess) <= 0):
            raise np.linalg.LinAlgError
    except np.linalg.LinAlgError as exc:
        raise ValueError(
            f"the {dist} information matrix is singular (degenerate data, e.g. identical "
            "failure times or a regressor with one level)"
        ) from exc
    cov = np.zeros((p + 1, p + 1))
    cov[:k, :k] = cov_free
    return MLFit(
        dist,
        theta[:p].copy(),
        0.0 if fixed else float(theta[p]),
        cov,
        float(-res.fun),
        data.n,
        data.r,
        k,
        True,
    )

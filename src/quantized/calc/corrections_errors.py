"""Bound-uncertainty handling for the correction pipeline (``corrections``).

Pure calc layer. Split out of :mod:`quantized.calc.corrections` (module
ceiling) when worksheet audit #9 taught the pipeline to PROPAGATE bound Y
errors through its linear transforms -- smoothing, the finite-difference
derivatives and the cumulative integral -- instead of refusing them. QD
imports bind the moment's error column automatically, so the refusal used to
block those operations on every magnetometry dataset.

The propagation itself lives in :mod:`quantized.calc.linear_uncertainty`
(independent input errors, squared weights; see its header). This module
owns the pipeline bookkeeping: validating the bindings, the "drop the
uncertainty for this output" option, and applying the composed operator to
each bound error column once every scale has been applied.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import numpy as np

from .linear_uncertainty import (
    Operator,
    compose,
    cumulative_trapezoid_sigma,
    gradient_operator,
    linear_sigma,
)

__all__ = [
    "CORRELATED_KEY",
    "LINEAR_DERIVATIVE_MODES",
    "correlated_mark",
    "drop_bound_y_errors",
    "parse_error_bindings",
    "propagate_linear_errors",
]

#: ``derivativeMode`` values that are linear in y (``dlog/dlog`` is not).
LINEAR_DERIVATIVE_MODES = ("dY/dX", "d²Y/dX²", "∫Y dx")

ErrorRoles = dict[int, tuple[int, str, str]]

#: ``metadata`` key: labels of the Y-error columns whose values came out of a
#: non-diagonal linear step (smoothing, a derivative, the integral). Such a
#: sigma is the DIAGONAL of the output covariance only -- neighbouring points
#: are correlated -- so a later linear step must not propagate it as
#: independent. Keyed by label because the mark travels in the dataset's
#: metadata, which every correction (and the workspace file) carries along;
#: scalar steps (normalization, unit conversion) keep it, since they keep
#: the correlation.
CORRELATED_KEY = "correlated_y_errors"


def _marked(metadata: Mapping[str, Any]) -> set[str]:
    raw = metadata.get(CORRELATED_KEY)
    return {str(x) for x in raw} if isinstance(raw, (list, tuple)) else set()


def correlated_mark(
    metadata: Mapping[str, Any],
    labels: list[str],
    *,
    propagated: list[int],
    dropped: list[int],
) -> dict[str, Any]:
    """``metadata`` with the correlated-errors mark updated for this run."""
    marked = (_marked(metadata) - {labels[c] for c in dropped}) | {labels[c] for c in propagated}
    out = {k: v for k, v in metadata.items() if k != CORRELATED_KEY}
    if marked:
        out[CORRELATED_KEY] = sorted(marked)
    return out


def parse_error_bindings(
    error_bindings: list[dict[str, Any]] | None, n_channels: int
) -> ErrorRoles:
    """``{error channel: (target, axis, side)}``, validated."""
    error_roles: ErrorRoles = {}
    for binding in error_bindings or ():
        try:
            channel = int(binding["channel"])
            target = int(binding["target"])
            axis = str(binding["axis"])
            side = str(binding["side"])
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError("invalid error binding") from exc
        if channel < 0 or channel >= n_channels:
            raise ValueError(f"error channel {channel} is out of range")
        if target < -1 or target >= n_channels or target == channel:
            raise ValueError(f"error target {target} is invalid")
        if axis not in ("x", "y"):
            raise ValueError(f"error axis must be x or y, got {axis!r}")
        if side not in ("both", "+", "-"):
            raise ValueError(f"error side must be both, +, or -, got {side!r}")
        prior = error_roles.get(channel)
        role = (target, axis, side)
        if prior is not None and prior != role:
            raise ValueError(f"error channel {channel} has conflicting bindings")
        error_roles[channel] = role
    return error_roles


def _bound_y(error_roles: ErrorRoles, signal: list[int]) -> list[tuple[int, int, str]]:
    chosen = set(signal)
    return [
        (channel, target, side)
        for channel, (target, axis, side) in error_roles.items()
        if axis == "y" and target in chosen
    ]


def drop_bound_y_errors(
    values: np.ndarray, error_roles: ErrorRoles, signal: list[int]
) -> list[int]:
    """The "drop uncertainty for this output" option: blank (NaN) every Y-error
    column bound to a transformed channel, in place; returns those channels.
    The binding is kept, so the output says "no uncertainty" rather than
    offering a stale column as a measured value."""
    dropped = [channel for channel, _, _ in _bound_y(error_roles, signal)]
    for channel in dropped:
        values[:, channel] = np.nan
    return dropped


def propagate_linear_errors(
    values: np.ndarray,
    error_roles: ErrorRoles,
    signal: list[int],
    *,
    time: np.ndarray,
    smooth_op: Operator | None,
    derivative_mode: str,
    integrand: np.ndarray | None,
    labels: list[str],
    correlated: Mapping[str, Any] | None = None,
) -> list[int]:
    """Replace each bound Y-error column by its propagated standard deviation;
    returns the error channels it rewrote (their outputs are now correlated).

    ``correlated`` is the INPUT's metadata: an error column it marks
    (:data:`CORRELATED_KEY`) already came out of a smoothing / derivative /
    integral, so its points are not independent and this step refuses rather
    than report a sigma that is wrong by a large factor (measured: an integral
    after a moving average understated to 0.30x, a derivative overstated
    2.33x). The correct route composes the steps into one operator -- one
    call with both enabled.

    Called once, after the last linear step, on error columns that already
    carry every SCALAR factor the pipeline applied (unit conversion,
    normalization): those commute with the linear operator, so applying
    ``D @ S`` at the end is exact. ``integrand`` is the signal block the
    cumulative integral consumed (only for ``"∫Y dx"``). An asymmetric (+/-)
    pair is refused: a linear operator with negative weights mixes the two
    halves, so there is no honest per-side answer.
    """
    bound = _bound_y(error_roles, signal)
    if not bound:
        return []
    already = sorted(_marked(correlated or {}) & {labels[channel] for channel, _, _ in bound})
    if already:
        raise ValueError(
            f"the uncertainty in {', '.join(already)} came out of an earlier smoothing, "
            "derivative or integral, so neighbouring points are correlated and it cannot "
            "be propagated again as independent; apply the steps in one pass from the "
            "original data, or drop the uncertainty for this output"
        )
    asymmetric = [channel for channel, _, side in bound if side != "both"]
    if asymmetric:
        raise ValueError(
            "asymmetric (+/-) Y uncertainty cannot be propagated through smoothing, "
            "a derivative or an integral; drop the uncertainty for this output"
        )
    if derivative_mode == "dY/dX":
        op = compose(gradient_operator(time), smooth_op)
    elif derivative_mode == "d²Y/dX²":
        grad = gradient_operator(time)
        op = compose(compose(grad, grad), smooth_op)
    else:
        op = smooth_op
    done: list[int] = []
    for channel, target, _ in bound:
        sigma = values[:, channel]
        if derivative_mode == "∫Y dx" and integrand is not None:
            column = integrand[:, signal.index(target)]
            out = cumulative_trapezoid_sigma(time, sigma, column, pre=smooth_op)
        elif op is not None:
            out = linear_sigma(op, sigma)
        else:
            continue
        # A missing value has no uncertainty to report.
        out[np.isnan(values[:, target])] = np.nan
        values[:, channel] = out
        done.append(channel)
    return done

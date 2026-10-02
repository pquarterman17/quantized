"""Plotting roles for refl1d/NCNR reflectivity column layouts.

Shared by :func:`quantized.io.ncnr_polarized.import_ncnr_dat` (``.datA``-``.datD``),
:func:`quantized.io.refl1d.import_refl1d_dat` (``*-refl.dat``) and
:func:`quantized.io.ncnr_polarized.import_ncnr_pnr` (``.pnr``). Without these
hints every column -- ``dQ``, ``dR``, the spin asymmetry -- opened as its own
curve on the log-R axis, and the Q resolution was never an x error bar.

Keys match :func:`quantized.io.ncnr._refl_role_metadata`: value-channel indices
(x excluded); an x-axis binding has ``target: -1``.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

__all__ = ["pnr_role_metadata", "refl_fit_role_metadata"]


def _x_binding(channel: int) -> dict[str, Any]:
    return {"channel": channel, "target": -1, "axis": "x", "side": "both"}


def _y_binding(channel: int, target: int) -> dict[str, Any]:
    return {"channel": channel, "target": target, "axis": "y", "side": "both"}


def refl_fit_role_metadata(labels: Sequence[str]) -> dict[str, Any]:
    """The refl1d ``Q dQ R dR theory fresnel`` layout: plot R and the fit
    ``theory``, R's error is dR, dQ is the x resolution. ``{}`` without an
    ``R`` column."""
    idx = {lab: j for j, lab in enumerate(labels)}
    if "R" not in idx:
        return {}
    curves = [idx[name] for name in ("R", "theory") if name in idx]
    meta: dict[str, Any] = {"default_value_channels": curves}
    roles: list[dict[str, Any]] = []
    if "dR" in idx:
        meta["error_channels"] = {idx["R"]: idx["dR"]}
        roles.append(_y_binding(idx["dR"], idx["R"]))
    if "dQ" in idx:
        roles.append(_x_binding(idx["dQ"]))
    if roles:
        meta["error_roles"] = roles
    return meta


def pnr_role_metadata(
    labels: Sequence[str], units: Sequence[str], x_unit: str
) -> dict[str, Any]:
    """The NCNR ``.pnr`` layout (labels already spin-cleaned: ``Rpp``,
    ``dRpp``, ``Tpp``, ``SA``, ``dSA``, ...).

    Curves: every measured ``R<state>`` and its theory ``T<state>``. Errors: a
    ``d<name>`` column whose unit matches ``<name>``'s. ``dQ`` in the x unit is
    the x resolution. The spin asymmetry stays off by default (signed, so it
    does not belong on the log-R axis) but keeps its error binding."""
    idx = {lab: j for j, lab in enumerate(labels)}
    measured = [j for j, lab in enumerate(labels) if lab.startswith("R") and len(lab) > 1]
    if not measured:
        return {}
    curves: list[int] = list(measured)
    curves += [idx["T" + labels[j][1:]] for j in measured if "T" + labels[j][1:] in idx]
    error_channels: dict[int, int] = {}
    roles: list[dict[str, Any]] = []
    for j, lab in enumerate(labels):
        target = idx.get(lab[1:]) if lab.startswith("d") else None
        if target is None or lab == "dQ" or units[j] != units[target]:
            continue
        error_channels[target] = j
        roles.append(_y_binding(j, target))
    if "dQ" in idx and x_unit and units[idx["dQ"]] == x_unit:
        roles.append(_x_binding(idx["dQ"]))
    meta: dict[str, Any] = {"default_value_channels": curves}
    if error_channels:
        meta["error_channels"] = error_channels
    if roles:
        meta["error_roles"] = roles
    return meta

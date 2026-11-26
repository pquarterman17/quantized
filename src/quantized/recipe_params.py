"""Validation of a saved template's recorded step params, as the app validates
them before a replay -- the headless side of ``lib/transformResample.ts``
``resampleParamsOf`` and ``lib/transformSigop.ts`` ``sigopParamsOf`` -- plus
the input checks ``qz run`` reports as warnings (``recipe_run.py``).

A template is user-editable JSON, so nothing in it is trusted: each function
returns the normalized params the app would send, or raises ``ValueError``
with the app's message. Pure.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Any

from quantized.datastruct import DataStruct

__all__ = ["expectation_warnings", "resample_params", "sigop_params"]

_RESAMPLE_METHODS = ("linear", "pchip", "spline", "makima")
_SIGOP_METHODS = (
    "median", "despike", "lowess", "convolve", "deconvolve", "hilbert", "ifft",
    "reduce-bin", "reduce-duplicates", "reduce-nth",
    "unwrap", "percentile", "binomial", "envelope-extrema", "coherence", "decimate-aa", "zoom-fft",
)  # fmt: skip


def _finite(v: Any) -> bool:
    return isinstance(v, int | float) and not isinstance(v, bool) and math.isfinite(v)


def _whole(v: Any) -> bool:
    return _finite(v) and float(v).is_integer()


def resample_params(raw: Mapping[str, Any]) -> dict[str, Any]:
    """The ``align_resample`` keyword arguments a recorded ``resample`` step
    asks for (``n_points``/``step``/``range`` grids; ``match`` is refused --
    it needs another dataset)."""
    mode = str(raw.get("mode", ""))
    if mode == "match":
        raise ValueError("a resample onto another dataset's x has no headless equivalent")
    if mode not in ("n_points", "step", "range"):
        raise ValueError(f'unknown resample grid "{mode}"')
    method = str(raw.get("method", "linear"))
    if method not in _RESAMPLE_METHODS:
        raise ValueError(f'unknown resample method "{method}"')
    out_of_range = str(raw.get("outOfRange", "nan"))
    if out_of_range not in ("nan", "clip"):
        raise ValueError(f'unknown out-of-range rule "{out_of_range}"')

    def need(key: str) -> float:
        if not _finite(raw.get(key)):
            raise ValueError(f'resample "{mode}" needs a number "{key}"')
        return float(raw[key])

    kw: dict[str, Any] = {
        "mode": mode,
        "method": method,
        "out_of_range": out_of_range,
        "unsorted": "sort" if raw.get("sortUnsorted") is True else "refuse",
    }
    if mode == "n_points":
        n = need("nPoints")
        if not float(n).is_integer() or n < 2:
            raise ValueError('resample "nPoints" must be an integer >= 2')
        kw["n_points"] = int(n)
    elif mode == "step":
        kw["step"] = need("step")
    else:
        kw.update(start=need("start"), stop=need("stop"), step=need("step"))
    return kw


def sigop_params(raw: Mapping[str, Any]) -> tuple[str, list[int], dict[str, Any]]:
    """``(method, channels, args)`` of a recorded ``sigop`` step."""
    method = str(raw.get("method", ""))
    if method not in _SIGOP_METHODS:
        raise ValueError(f'unknown signal operation "{method}"')
    channels = raw.get("channels", [])
    if channels is None:
        channels = []
    if not isinstance(channels, list) or not all(_whole(c) for c in channels):
        raise ValueError(f'"{method}" needs integer "channels"')
    args = raw.get("args", {})
    if args is None:
        args = {}
    if not isinstance(args, Mapping):
        raise ValueError(f'"{method}" arguments must be an object')
    for k, v in args.items():
        if not isinstance(v, int | float | str | bool):
            raise ValueError(f'"{method}" argument "{k}" must be a number, text or yes/no')
    if method == "ifft":
        m: Any = args.get("magnitudeChannel")
        p: Any = args.get("phaseChannel")
        if not (_whole(m) and _whole(p) and m >= 0 and p >= 0 and m != p):
            raise ValueError(
                '"ifft" needs two different whole-number column indices '
                "(magnitudeChannel, phaseChannel)"
            )
    return method, [int(c) for c in channels], dict(args)


def expectation_warnings(expects: Any, data: DataStruct) -> list[str]:
    """What differs between the input and the recipe's recorded ``expects``
    (``lib/recipeExpect.ts``): a required column whose name or unit is not the
    one at that position. Headless replay reads columns BY POSITION, as the
    recording did, so these are reported, never rebound."""
    if not isinstance(expects, Mapping) or not isinstance(expects.get("columns"), list):
        return []
    out: list[str] = []
    for i, col in enumerate(expects["columns"]):
        if not isinstance(col, Mapping) or col.get("required") is not True:
            continue
        name, unit = str(col.get("name", "")), str(col.get("unit", ""))
        if i >= data.n_channels:
            out.append(f'column {i + 1} ("{name}") is missing: the input has {data.n_channels}')
            continue
        got, got_unit = data.labels[i], data.units[i]
        if got != name or (unit and got_unit and unit != got_unit):
            out.append(
                f'column {i + 1} is "{got}" [{got_unit}], the recipe was recorded on '
                f'"{name}" [{unit}]; it is read by position'
            )
    return out

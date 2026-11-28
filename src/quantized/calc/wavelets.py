"""Wavelet transforms on plain arrays (Origin gap plan item 6), over PyWavelets.

Pure numerics, no DataStruct: ``wavelet_ops`` wraps these for the Signal
Processing dispatch. PyWavelets (MIT) is an OPTIONAL dependency
(``pip install quantized-lab[wavelets]``): ``pywt`` is imported only inside
``heavy_imports("pywt")``, and when it is missing every entry point refuses with
:data:`WAVELETS_MISSING` (a ``ValueError``, so a route answers 422 and the UI
shows the message). Nothing here falls back to a different algorithm.

Conventions, so the numbers can be compared with another package:

* **DWT** is ``pywt.wavedec``; coefficients run ``[cA_n, cD_n, ..., cD_1]``
  (``cD_1`` is the finest detail). Reconstruction is ``pywt.waverec`` trimmed to
  the input length.
* **Noise estimate** ``sigma = median(|cD_1|) / 0.6745`` (Donoho-Johnstone MAD
  rule, the same as MATLAB's ``wnoisest``), from the finest detail level.
* **Universal / VisuShrink** threshold ``sigma * sqrt(2 ln N)`` with ``N`` the
  signal length. **SURE** picks, per detail level, the threshold minimising
  Stein's unbiased risk estimate on that level's coefficients scaled to unit
  noise, with Donoho-Johnstone's hybrid fallback to the universal threshold
  (``sqrt(2 ln n_j)`` for the level's ``n_j`` coefficients) when the level is
  too sparse for SURE to be reliable (SureShrink).
* **CWT** is ``pywt.cwt(..., method="fft")``: ``W[s, n] = s**-0.5 * sum_k y[k] *
  conj(psi((k - n + 0.5) / s))``. The scale ``s`` is in SAMPLES (``dt`` never enters
  the coefficients, only the frequency), the wavelet is L2-normalised
  (``1/sqrt(s)``, not the L1 ``1/s``), the record is zero beyond its ends, and the
  integral-difference sampling puts the wavelet half a sample off the grid.
  Pinned by hand in ``tests/test_wavelets_origin.py``; OriginPro's ``mexhat`` has the
  same normalisation (best-fit scale 1.00 +- 0.5 percent). A wavelet whose centre
  frequency is ``fc`` at scale ``s`` sits at frequency ``fc / (s * dt)``. Morlet is
  the COMPLEX Morlet ``cmorB-C`` (``B`` bandwidth,
  ``C`` centre frequency), so ``|W|`` is smooth across a tone's cycles. The
  frequency of a scale is PyWavelets' *pseudo*-frequency (``central_frequency``).
  Broad real wavelets (Gaussian derivatives, to a lesser degree the Mexican hat)
  have wide frequency response, so a pure tone's ridge can sit well off its true
  frequency (gaus2 peaks near 6 for an 8-unit tone). Use Morlet when the
  frequency axis must be accurate.
"""

from __future__ import annotations

import math
from types import ModuleType
from typing import Any, cast

import numpy as np
from numpy.typing import NDArray

from quantized.calc import wavelet_origin as wo
from quantized.heavy_import import heavy_imports

__all__ = [
    "DISCRETE_MODES",
    "WAVELETS_MISSING",
    "WAVELET_FAMILIES",
    "check_discrete",
    "component_names",
    "continuous_wavelet_name",
    "cwt_scalogram",
    "denoise",
    "max_level",
    "noise_sigma",
    "parse_levels",
    "pywt_module",
    "reconstruct",
    "smooth_cutoff",
    "sure_threshold",
    "universal_threshold",
    "wavedec",
    "wavelets_available",
]

Vec = NDArray[np.float64]

WAVELETS_MISSING = (
    "Wavelet transforms need PyWavelets, which is not installed. "
    "Install it with: pip install quantized-lab[wavelets]"
)

#: The continuous wavelets offered, and the discrete extension modes.
WAVELET_FAMILIES = ("morlet", "mexican-hat", "gaussian")
DISCRETE_MODES = (
    "symmetric", "periodization", "zero", "constant", "smooth",
    "reflect", "antisymmetric", "antireflect", "periodic", wo.ORIGIN_PERIODIC,
)  # fmt: skip
#: Donoho-Johnstone: median(|Gaussian|) = 0.6745 sigma.
_MAD_TO_SIGMA = 0.6745


def pywt_module() -> ModuleType:
    """``pywt``, or a ``ValueError`` carrying the install instruction."""
    try:
        with heavy_imports("pywt"):
            import pywt
    except ImportError as exc:
        raise ValueError(WAVELETS_MISSING) from exc
    return cast(ModuleType, pywt)


def wavelets_available() -> bool:
    try:
        pywt_module()
    except ValueError:
        return False
    return True


def check_discrete(name: str, mode: str) -> None:
    """Refuse an unknown discrete wavelet or extension mode (never guess one)."""
    pywt = pywt_module()
    if name not in pywt.wavelist(kind="discrete"):
        raise ValueError(
            f"unknown discrete wavelet {name!r}; "
            "use a name such as haar, db4, sym8, coif3 or bior3.5"
        )
    if mode not in DISCRETE_MODES:
        raise ValueError(
            f"unknown extension mode {mode!r}; choose from {', '.join(DISCRETE_MODES)}"
        )


def max_level(n: int, wavelet: str) -> int:
    pywt = pywt_module()
    return int(pywt.dwt_max_level(n, pywt.Wavelet(wavelet).dec_len))


def component_names(level: int) -> list[str]:
    """``["A5", "D5", "D4", "D3", "D2", "D1"]``: the order of the coefficient list."""
    return [f"A{level}"] + [f"D{j}" for j in range(level, 0, -1)]


def _finite_record(y: Vec, what: str) -> Vec:
    arr = np.asarray(y, dtype=float).ravel()
    if arr.size < 4 or not np.isfinite(arr).all():
        raise ValueError(
            f"{what} needs at least 4 rows and no blank or non-finite values "
            "(a wavelet transform runs on an unbroken record); fill or exclude those rows first"
        )
    return arr


def _origin_top_level(n: int, wavelet: str) -> int:
    """Deepest level the Origin periodic scheme accepts for ``n`` rows (0: none)."""
    top = 0
    while n % (1 << (top + 1)) == 0:
        try:
            wo.check_origin_level(pywt_module(), n, wavelet, top + 1)
        except ValueError:
            break
        top += 1
    return top


def _checked_level(
    n: int, wavelet: str, level: int | None, default: int = 5, mode: str = "symmetric"
) -> int:
    top = _origin_top_level(n, wavelet) if mode == wo.ORIGIN_PERIODIC else max_level(n, wavelet)
    if top < 1:
        raise ValueError(f"{n} rows are too few for a {wavelet} decomposition")
    if level is None:
        return min(default, top)
    if level < 1 or level > top:
        raise ValueError(f"level must be 1 to {top} for {n} rows and {wavelet} (got {level})")
    return level


def wavedec(
    y: Vec, wavelet: str, level: int | None, mode: str = "symmetric"
) -> tuple[list[Vec], int]:
    """Multilevel DWT: ``([cA_n, cD_n, ..., cD_1], level)``."""
    check_discrete(wavelet, mode)
    arr = _finite_record(y, "the wavelet transform")
    lev = _checked_level(arr.size, wavelet, level, mode=mode)
    pywt = pywt_module()
    if mode == wo.ORIGIN_PERIODIC:
        return wo.origin_wavedec(pywt, arr, wavelet, lev), lev
    coeffs = pywt.wavedec(arr, wavelet, mode=mode, level=lev)
    return [np.asarray(c, dtype=float) for c in coeffs], lev


def _waverec(coeffs: list[Vec], wavelet: str, mode: str, n: int) -> Vec:
    """Rebuild a signal of ``n`` rows from ``[cA_n, cD_n, ..., cD_1]``."""
    pywt = pywt_module()
    if mode == wo.ORIGIN_PERIODIC:
        return wo.origin_waverec(pywt, coeffs, wavelet)[:n]
    return np.asarray(pywt.waverec(coeffs, wavelet, mode=mode), dtype=float)[:n]


def parse_levels(text: object, level: int, *, allow_approx: bool) -> set[str]:
    """Components named by a comma list such as ``"A,3,4"`` or ``"1,2"``.

    Returns names from :func:`component_names` (``A<level>``, ``D<j>``). A detail
    level outside 1..level, a duplicate-free typo or an empty list is refused.
    """
    if not isinstance(text, str) or not text.strip():
        raise ValueError("choose at least one level")
    out: set[str] = set()
    for tok in (t.strip() for t in text.split(",")):
        if not tok:
            continue
        if tok.upper() in ("A", f"A{level}"):
            if not allow_approx:
                raise ValueError("only detail levels can be zeroed; the approximation is kept")
            out.add(f"A{level}")
            continue
        try:
            j = int(tok.upper().removeprefix("D"))
        except ValueError:
            raise ValueError(
                f"cannot read {tok!r} as a level (use A or a number 1 to {level})"
            ) from None
        if not 1 <= j <= level:
            raise ValueError(f"detail level {j} is outside 1 to {level}")
        out.add(f"D{j}")
    if not out:
        raise ValueError("choose at least one level")
    return out


def reconstruct(y: Vec, wavelet: str, level: int | None, mode: str, keep: set[str]) -> Vec:
    """Rebuild ``y`` from only the components in ``keep`` (the rest set to zero).

    With every component kept this is the identity to rounding (perfect
    reconstruction); ``keep = {A}`` is the trend, ``keep = {D1..}`` the details."""
    coeffs, lev = wavedec(y, wavelet, level, mode)
    names = component_names(lev)
    unknown = keep - set(names)
    if unknown:
        raise ValueError(f"no such component for level {lev}: {', '.join(sorted(unknown))}")
    kept = [c if n in keep else np.zeros_like(c) for n, c in zip(names, coeffs, strict=True)]
    return _waverec(kept, wavelet, mode, int(np.asarray(y).size))


# --- denoising -------------------------------------------------------------


def noise_sigma(detail: Vec) -> float:
    """``median(|d|) / 0.6745`` of a detail level (finest level for the global estimate)."""
    d = np.asarray(detail, dtype=float)
    return float(np.median(np.abs(d)) / _MAD_TO_SIGMA) if d.size else 0.0


def universal_threshold(sigma: float, n: int) -> float:
    """VisuShrink: ``sigma * sqrt(2 ln n)``."""
    return float(sigma * math.sqrt(2.0 * math.log(max(n, 2))))


def sure_threshold(x: Vec) -> float:
    """The threshold minimising Stein's unbiased risk for unit-noise ``x``
    (soft thresholding; the same risk MATLAB's ``rigrsure`` minimises)."""
    a = np.sort(np.abs(np.asarray(x, dtype=float))) ** 2
    n = a.size
    if n == 0:
        return 0.0
    k = np.arange(1, n + 1)
    risk = (n - 2 * k + np.cumsum(a) + (n - k) * a) / n
    return float(math.sqrt(a[int(np.argmin(risk))]))


def _sure_level_threshold(d: Vec, sigma: float) -> float:
    """SureShrink for one level: SURE, or the universal threshold when sparse."""
    n = d.size
    if sigma <= 0.0 or n < 2:
        return 0.0
    x = d / sigma
    eta = float((np.sum(x**2) - n) / n)
    crit = (math.log2(n) ** 1.5) / math.sqrt(n)
    if eta <= crit:  # not enough signal energy for SURE: fall back (Donoho & Johnstone 1995)
        return universal_threshold(sigma, n)
    return sigma * sure_threshold(x)


def denoise(
    y: Vec,
    wavelet: str,
    level: int | None,
    mode: str = "symmetric",
    *,
    rule: str = "universal",
    threshold_mode: str = "soft",
    per_level: bool = False,
    percent: float | None = None,
) -> tuple[Vec, dict[str, Any]]:
    """Wavelet shrinkage: threshold the detail levels, keep the approximation.

    ``rule`` is ``"universal"`` or ``"sure"``; ``threshold_mode`` ``"soft"`` or
    ``"hard"``; ``per_level`` takes sigma from each level's own coefficients
    (coloured noise) instead of the finest level only. Returns the cleaned
    signal and ``{"sigma": {...}, "threshold": {...}, "level": n}`` keyed by
    component name.

    ``rule="percent"`` is OriginPro's custom threshold (``percent`` of the largest
    detail coefficient, one HARD threshold for every level): see ``wavelet_origin``."""
    if rule not in ("universal", "sure", "percent"):
        raise ValueError("threshold rule must be universal, sure or percent")
    if threshold_mode not in ("soft", "hard"):
        raise ValueError("threshold mode must be soft or hard")
    coeffs, lev = wavedec(y, wavelet, level, mode)
    n = int(np.asarray(y).size)
    names = component_names(lev)
    if rule == "percent":
        if percent is None:
            raise ValueError("the percent rule needs a percentage")
        if threshold_mode != "hard":
            raise ValueError("Origin's custom threshold is hard; choose hard")
        kept, t = wo.percent_threshold(coeffs, percent)
        info = {"level": lev, "sigma": {}, "threshold": dict.fromkeys(names[1:], t)}
        return _waverec(kept, wavelet, mode, n), info
    pywt = pywt_module()
    sigma_global = noise_sigma(coeffs[-1])
    out = [coeffs[0]]
    sigmas: dict[str, float] = {}
    thresholds: dict[str, float] = {}
    for name, d in zip(names[1:], coeffs[1:], strict=True):
        sigma = noise_sigma(d) if per_level else sigma_global
        if rule == "universal":
            t = universal_threshold(sigma, n)
        else:
            t = _sure_level_threshold(d, sigma)
        sigmas[name], thresholds[name] = sigma, t
        out.append(np.asarray(pywt.threshold(d, t, mode=threshold_mode), dtype=float))
    rec = _waverec(out, wavelet, mode, n)
    return rec, {"level": lev, "sigma": sigmas, "threshold": thresholds}


def smooth_cutoff(
    y: Vec, wavelet: str, level: int | None, mode: str, cutoff: float
) -> tuple[Vec, int, int]:
    """OriginPro's ``wtsmooth`` cutoff: ``(smoothed, level, coefficients zeroed)``."""
    coeffs, lev = wavedec(y, wavelet, level, mode)
    kept, zeroed = wo.smooth_cutoff(coeffs, cutoff)
    return _waverec(kept, wavelet, mode, int(np.asarray(y).size)), lev, zeroed


# --- continuous transform ---------------------------------------------------


def continuous_wavelet_name(
    family: str, *, bandwidth: float = 1.5, center: float = 1.0, order: int = 2
) -> str:
    """The pywt name of a continuous wavelet from the app's family and shape."""
    if family == "morlet":
        if not (
            math.isfinite(bandwidth) and bandwidth > 0 and math.isfinite(center) and center > 0
        ):
            raise ValueError("Morlet bandwidth and centre frequency must be positive")
        return f"cmor{bandwidth!r}-{center!r}"
    if family == "mexican-hat":
        return "mexh"
    if family == "gaussian":
        if not 1 <= order <= 8:
            raise ValueError("Gaussian-derivative order must be 1 to 8")
        return f"gaus{order}"
    raise ValueError(f"unknown wavelet {family!r}; choose from {', '.join(WAVELET_FAMILIES)}")


def cwt_scalogram(
    y: Vec, dt: float, wavelet: str, scales: Vec
) -> tuple[NDArray[np.float64], Vec, float]:
    """``(|W| (nscales, N), frequencies per scale, centre frequency)`` of ``y``.

    ``dt`` is the (positive) sampling period; ``frequencies`` are
    ``centre / (scale * dt)`` as PyWavelets reports them."""
    arr = _finite_record(y, "the continuous wavelet transform")
    pywt = pywt_module()
    w = pywt.ContinuousWavelet(wavelet)
    coefs, freqs = pywt.cwt(
        arr, np.asarray(scales, dtype=float), w, sampling_period=dt, method="fft"
    )
    return np.abs(coefs), np.asarray(freqs, dtype=float), float(pywt.central_frequency(w))

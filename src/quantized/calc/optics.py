r"""Optics calculators (DiraCulator ``buildOpticsTab`` + ``+calc/+optics``).

Pure calc layer — closed-form scalars in, result dicts out. No fastapi /
pydantic imports. Ports the seven MATLAB ``calc.optics`` functions verbatim:

.. math::

    r_s = \frac{n_1\cos\theta_i - n_2\cos\theta_t}
               {n_1\cos\theta_i + n_2\cos\theta_t} \qquad R_s = |r_s|^2 \\
    \theta_c = \arcsin(n_2/n_1) \qquad \theta_B = \arctan(n_2/n_1) \\
    \delta_{\text{pen}} = \frac{\lambda}{4\pi k} \qquad
    \delta_{\text{skin}} = \sqrt{\frac{2\rho}{\omega\mu_0}} \\
    \varepsilon_1 = n^2 - k^2 \qquad \varepsilon_2 = 2 n k

Conventions follow the MATLAB toolbox (the behavioural reference): angles in
degrees, penetration-depth wavelength in any consistent length unit (output in
the same unit), skin-depth resistivity in Ω·m (SI) and frequency in Hz.

Reference values (from the MATLAB docstrings / closed form):
  - ``fresnel_coefficients(1.0, 1.5, 0) -> Rs = Rp = 0.04`` (air/glass)
  - ``critical_angle(1.5, 1.0) -> theta_c ≈ 41.81`` deg (glass/air)
  - ``brewster_angle(1.0, 1.5) -> theta_b ≈ 56.31`` deg (air/glass)
  - ``penetration_depth(5.6, 0.39, 400) -> depth ≈ 81.6`` nm (Si @ 400 nm)
  - ``skin_depth(1.68e-8, 1e9) -> delta ≈ 2.06`` µm (Cu @ 1 GHz)
  - ``refractive_to_dielectric(3.5, 0) -> eps1 = 12.25, eps2 = 0`` (Si, IR)
"""

from __future__ import annotations

import cmath
import math

from quantized.calc.constants import constants

__all__ = [
    "brewster_angle",
    "critical_angle",
    "dielectric_to_refractive",
    "fresnel_coefficients",
    "penetration_depth",
    "refractive_to_dielectric",
    "skin_depth",
]


def fresnel_coefficients(n1: float, n2: float, theta: float) -> dict[str, float]:
    """Fresnel reflectance/transmittance at an interface (``fresnelCoefficients.m``).

    Generalised Snell's law ``cos θ_t = √(1 − (n₁/n₂·sin θᵢ)²)`` (principal
    branch) gives evanescent waves above the critical angle. Amplitude
    coefficients are computed with complex arithmetic; only the real-valued
    intensity coefficients are returned (complex amplitudes can't serialize).

    Args:
        n1: refractive index of the incident medium, > 0.
        n2: refractive index of the transmitted medium, > 0.
        theta: angle of incidence (degrees from normal), >= 0.

    Returns ``Rs``/``Rp`` reflectances |r|² and ``Ts``/``Tp`` transmittances
    (energy-conserving form).

    >>> r = fresnel_coefficients(1.0, 1.5, 0.0)
    >>> round(r["Rs"], 4)
    0.04
    >>> round(r["Ts"], 4)
    0.96
    """
    if n1 <= 0 or n2 <= 0:
        raise ValueError("n1 and n2 must be positive")
    if theta < 0:
        raise ValueError("theta must be non-negative")

    th = math.radians(theta)
    cos_i = complex(math.cos(th))
    sin_i = complex(math.sin(th))

    sin_t = (n1 / n2) * sin_i
    cos_t = cmath.sqrt(1 - sin_t**2)  # principal sqrt; evanescent if TIR

    rs = (n1 * cos_i - n2 * cos_t) / (n1 * cos_i + n2 * cos_t)
    rp = (n2 * cos_i - n1 * cos_t) / (n2 * cos_i + n1 * cos_t)
    ts = (2 * n1 * cos_i) / (n1 * cos_i + n2 * cos_t)
    tp = (2 * n1 * cos_i) / (n2 * cos_i + n1 * cos_t)

    r_s = abs(rs) ** 2
    r_p = abs(rp) ** 2
    factor = (n2 * cos_t.conjugate()).real / (n1 * cos_i.conjugate()).real
    t_s = factor * abs(ts) ** 2
    t_p = factor * abs(tp) ** 2

    return {"Rs": r_s, "Rp": r_p, "Ts": t_s, "Tp": t_p, "theta": theta}


def critical_angle(n1: float, n2: float) -> dict[str, float]:
    """Critical angle for total internal reflection (``criticalAngle.m``).

    ``θ_c = arcsin(n₂/n₁)`` (degrees). TIR requires ``n₁ > n₂``; when
    ``n₂ >= n₁`` returns ``theta_c = NaN`` (no error) so callers can use it in
    vectorised workflows without branching.

    >>> round(critical_angle(1.5, 1.0)["theta_c"], 2)
    41.81
    >>> import math
    >>> math.isnan(critical_angle(1.0, 1.5)["theta_c"])
    True
    """
    if n1 <= 0 or n2 <= 0:
        raise ValueError("n1 and n2 must be positive")
    theta_c = float("nan") if n2 >= n1 else math.degrees(math.asin(n2 / n1))
    return {"theta_c": theta_c, "n1": n1, "n2": n2}


def brewster_angle(n1: float, n2: float) -> dict[str, float]:
    """Brewster angle for p-polarised light (``brewsterAngle.m``).

    ``θ_B = arctan(n₂/n₁)`` (degrees). At this angle the reflected beam is
    purely s-polarised (``R_p = 0``). Exact for real, lossless media.

    >>> round(brewster_angle(1.0, 1.5)["theta_b"], 2)
    56.31
    """
    if n1 <= 0 or n2 <= 0:
        raise ValueError("n1 and n2 must be positive")
    return {"theta_b": math.degrees(math.atan(n2 / n1)), "n1": n1, "n2": n2}


def penetration_depth(n: float, k: float, wavelength: float) -> dict[str, float]:
    """Optical penetration depth for an absorbing medium (``penetrationDepth.m``).

    1/e intensity depth ``δ = λ / (4π k) = 1/α``. When ``k = 0`` the medium is
    lossless: ``depth`` and ``abs_length`` are +inf and ``abs_coeff`` is 0.
    Output length unit matches the wavelength unit.

    Args:
        n: real part of refractive index, > 0.
        k: extinction coefficient, >= 0.
        wavelength: wavelength (any length unit), > 0.

    >>> round(penetration_depth(5.6, 0.39, 400.0)["depth"], 1)
    81.6
    >>> penetration_depth(1.5, 0.0, 500.0)["depth"]
    inf
    """
    if n <= 0:
        raise ValueError("n must be positive")
    if k < 0:
        raise ValueError("k must be non-negative")
    if wavelength <= 0:
        raise ValueError("wavelength must be positive")

    if k == 0:
        abs_coeff = 0.0
        depth = float("inf")
        abs_length = float("inf")
    else:
        abs_coeff = 4 * math.pi * k / wavelength
        depth = 1.0 / abs_coeff  # = lambda / (4*pi*k)
        abs_length = 1.0 / (2 * abs_coeff)
    return {
        "depth": depth,
        "abs_coeff": abs_coeff,
        "abs_length": abs_length,
        "wavelength": wavelength,
        "n": n,
        "k": k,
    }


def skin_depth(rho: float, f: float) -> dict[str, float]:
    """Electromagnetic skin depth of a conductor (``skinDepth.m``).

    Good-conductor approximation ``δ = √(2ρ / (ω μ₀))`` with ``ω = 2π f`` and
    ``μ₀`` the vacuum permeability. Assumes relative permeability μ_r = 1.

    Args:
        rho: electrical resistivity (Ω·m, SI), > 0.
        f: field frequency (Hz), > 0.

    Returns ``delta`` (m) plus ``delta_um`` (µm) and ``delta_nm`` (nm).

    >>> round(skin_depth(1.68e-8, 1e9)["delta_um"], 2)
    2.06
    """
    if rho <= 0:
        raise ValueError("rho must be positive")
    if f <= 0:
        raise ValueError("f must be positive")
    mu0 = constants()["mu0"]
    omega = 2 * math.pi * f
    delta = math.sqrt(2 * rho / (omega * mu0))
    return {
        "delta": delta,
        "delta_um": delta * 1e6,
        "delta_nm": delta * 1e9,
        "rho": rho,
        "f": f,
    }


def refractive_to_dielectric(n: float, k: float = 0.0) -> dict[str, float]:
    """Complex refractive index (n, k) → dielectric function (``refractiveToDielectric.m``).

    ``ε = (n + ik)²``  →  ``ε₁ = n² − k²``, ``ε₂ = 2 n k``.

    >>> r = refractive_to_dielectric(3.5, 0.0)
    >>> round(r["eps1"], 4), round(r["eps2"], 4)
    (12.25, 0.0)
    """
    if k < 0:
        raise ValueError("k must be non-negative")
    return {"eps1": n**2 - k**2, "eps2": 2.0 * n * k, "n": n, "k": k}


def dielectric_to_refractive(eps1: float, eps2: float = 0.0) -> dict[str, float]:
    """Dielectric function (ε₁, ε₂) → complex refractive index (``dielectricToRefractive.m``).

    Physical square root (``n >= 0``, ``k >= 0``):
    ``n = √((|ε| + ε₁)/2)``, ``k = √((|ε| − ε₁)/2)`` with ``|ε| = √(ε₁² + ε₂²)``.
    For metals with ``ε₁ < 0`` and ``ε₂ = 0``: ``n = 0``, ``k = √(−ε₁)``.

    >>> r = dielectric_to_refractive(12.25, 0.0)
    >>> round(r["n"], 4), round(r["k"], 4)
    (3.5, 0.0)
    """
    mod_eps = math.sqrt(eps1**2 + eps2**2)
    n = math.sqrt((mod_eps + eps1) / 2)
    k = math.sqrt((mod_eps - eps1) / 2)
    return {"n": n, "k": k, "eps1": eps1, "eps2": eps2}

r"""Miller-Bravais 4-index <-> 3-index conversions (hexagonal/trigonal).

Pure calc layer, split out of :mod:`quantized.calc.crystallography` to keep
that module under the repo's 500-line god-module ceiling (this file is a
cohesive unit: hexagonal/trigonal index notation, distinct from d-spacing /
cell-volume / density).

Hexagonal/trigonal planes and directions are conventionally expressed on 4
axes (a1, a2, a3, c) with the redundant third axis ``a3 = -(a1+a2)``. This
gives two INDEX FAMILIES, each with a 3-index and a 4-index form — and,
importantly, the two families convert differently:

- **Planes** ``(hkl) <-> (hkil)`` (:func:`hkl_to_hkil` / :func:`hkil_to_hkl`):
  a plane's intercepts on a1, a2 are unchanged by adding the third axis, so
  ``i = -(h+k)`` and ``h, k, l`` pass through unchanged — NO rescaling.
- **Directions** ``[UVW] <-> [uvtw]`` (:func:`direction_uvw_to_uvtw` /
  :func:`direction_uvtw_to_uvw`): direction components are NOT simple
  intercepts, so ``U = 2u+v, V = u+2v, W = w`` (with ``t = -(u+v)``) picks up
  an overall scale factor of 3 between the two representations.

Convention: e.g. Cullity, B.D. & Stock, S.R., *Elements of X-Ray
Diffraction*, 3rd ed. (Prentice Hall, 2001), Appendix 3 (planes); Kelly, A. &
Knowles, K.M., *Crystallography and Crystal Defects*, 2nd ed. (Wiley, 2012),
Sec. 1.4, and De Graef, M. & McHargue, C.J., *Introduction to Conventional
Transmission Electron Microscopy* (Cambridge, 2003), Sec. 1.2 (directions).

Reference: (100) -> (10-10); (110) -> (11-20); [100] -> [2,-1,-1,0];
[110] -> [1,1,-2,0].
"""

from __future__ import annotations

import math

__all__ = [
    "direction_uvtw_to_uvw",
    "direction_uvw_to_uvtw",
    "hkil_to_hkl",
    "hkl_to_hkil",
]


def hkl_to_hkil(h: int, k: int, l: int) -> tuple[int, int, int, int]:
    r"""Convert a 3-index hexagonal Miller plane ``(hkl)`` to 4-index Miller-Bravais
    ``(hkil)``.

    Hexagonal/trigonal planes are conventionally indexed on 4 axes
    (a1, a2, a3, c) with the redundant third axis ``a3 = -(a1+a2)``. A plane's
    intercepts on a1 and a2 are unchanged by adding the third axis, so the
    extra index is exactly the linear-dependency identity — NO rescaling
    (contrast :func:`direction_uvw_to_uvtw`, where direction components pick
    up an overall factor of 3):

    .. math::

        i = -(h + k)

    Convention: e.g. Cullity, B.D. & Stock, S.R., *Elements of X-Ray
    Diffraction*, 3rd ed. (Prentice Hall, 2001), Appendix 3.

    Inputs
    ------
    h, k, l : int
        3-index Miller plane indices (dimensionless).

    Outputs
    -------
    (h, k, i, l) : tuple[int, int, int, int]
        4-index Miller-Bravais plane indices.

    Example
    -------
    >>> hkl_to_hkil(1, 0, 0)   # (100) -> (10-10)
    (1, 0, -1, 0)
    >>> hkl_to_hkil(1, 1, 0)   # (110) -> (11-20)
    (1, 1, -2, 0)
    """
    return (h, k, -(h + k), l)


def hkil_to_hkl(h: int, k: int, i: int, l: int) -> tuple[int, int, int]:
    r"""Convert a 4-index Miller-Bravais plane ``(hkil)`` to 3-index ``(hkl)``.

    Inverse of :func:`hkl_to_hkil`. Validates the Miller-Bravais closure rule
    ``i = -(h+k)``; ``h, k, l`` pass through unchanged (no rescaling).

    Inputs
    ------
    h, k, i, l : int
        4-index Miller-Bravais plane indices (dimensionless).

    Outputs
    -------
    (h, k, l) : tuple[int, int, int]
        3-index Miller plane indices.

    Raises
    ------
    ValueError
        If ``i != -(h+k)`` — the message names the offending values and the
        expected ``i``.

    Example
    -------
    >>> hkil_to_hkl(1, 1, -2, 0)   # (11-20) -> (110)
    (1, 1, 0)
    """
    expected_i = -(h + k)
    if i != expected_i:
        raise ValueError(
            "invalid Miller-Bravais plane index: i must equal -(h+k); "
            f"got i={i} but h={h}, k={k} requires i={expected_i}"
        )
    return (h, k, l)


def _gcd_reduce3(a: int, b: int, c: int) -> tuple[int, int, int]:
    """Divide 3 integers by their GCD (sign-preserving); rejects the all-zero case."""
    g = math.gcd(a, b, c)
    if g == 0:
        raise ValueError("direction indices must not all be zero")
    return (a // g, b // g, c // g)


def _gcd_reduce4(a: int, b: int, c: int, d: int) -> tuple[int, int, int, int]:
    """Divide 4 integers by their GCD (sign-preserving); rejects the all-zero case."""
    g = math.gcd(a, b, c, d)
    if g == 0:
        raise ValueError("direction indices must not all be zero")
    return (a // g, b // g, c // g, d // g)


def direction_uvw_to_uvtw(U: int, V: int, W: int) -> tuple[int, int, int, int]:
    r"""Convert a 3-index hexagonal direction ``[UVW]`` to 4-index Miller-Bravais
    (Weber) ``[uvtw]``.

    Hexagonal/trigonal directions are expressed on the linearly-dependent
    basis (a1, a2, a3, c) with ``a3 = -(a1+a2)``, so — unlike planes
    (:func:`hkl_to_hkil`), where ``h, k`` pass through unchanged — each
    direction has two integer representations that differ by an overall
    scale. The raw (rational) Weber components, with ``t = -(u+v)``:

    .. math::

        u = \frac{2U - V}{3}, \qquad v = \frac{2V - U}{3}, \qquad
        t = -(u+v) = -\frac{U+V}{3}, \qquad w = W

    To return the conventional smallest-integer ``[uvtw]``, this scales the
    raw components by 3 (``u' = 2U-V, v' = 2V-U, t' = -(U+V), w' = 3W``) and
    reduces by their GCD.

    Convention: e.g. Kelly, A. & Knowles, K.M., *Crystallography and Crystal
    Defects*, 2nd ed. (Wiley, 2012), Sec. 1.4; De Graef, M. & McHargue, C.J.,
    *Introduction to Conventional Transmission Electron Microscopy*
    (Cambridge, 2003), Sec. 1.2.

    Inputs
    ------
    U, V, W : int
        3-index crystallographic direction (dimensionless).

    Outputs
    -------
    (u, v, t, w) : tuple[int, int, int, int]
        4-index Weber direction indices, in lowest integer terms.

    Raises
    ------
    ValueError
        If ``U = V = W = 0`` (not a direction).

    Example
    -------
    >>> direction_uvw_to_uvtw(1, 0, 0)   # [100] -> [2,-1,-1,0]
    (2, -1, -1, 0)
    >>> direction_uvw_to_uvtw(1, 1, 0)   # [110] -> [1,1,-2,0]
    (1, 1, -2, 0)
    """
    return _gcd_reduce4(2 * U - V, 2 * V - U, -(U + V), 3 * W)


def direction_uvtw_to_uvw(u: int, v: int, t: int, w: int) -> tuple[int, int, int]:
    r"""Convert a 4-index Miller-Bravais (Weber) direction ``[uvtw]`` to 3-index
    ``[UVW]``.

    Inverse of :func:`direction_uvw_to_uvtw`. Validates the Weber closure
    rule ``t = -(u+v)`` (the direction analogue of the plane rule in
    :func:`hkil_to_hkl` — but note the two transforms are NOT the same
    operation; see :func:`direction_uvw_to_uvtw` for why directions rescale
    and planes don't). Applying ``U = 2u+v, V = u+2v, W = w`` directly to
    integer ``[uvtw]`` and then GCD-reducing undoes the x3 scale from the
    forward transform.

    Inputs
    ------
    u, v, t, w : int
        4-index Weber direction indices (dimensionless).

    Outputs
    -------
    (U, V, W) : tuple[int, int, int]
        3-index crystallographic direction, in lowest integer terms.

    Raises
    ------
    ValueError
        If ``t != -(u+v)`` (states the expected value), or if the result
        would be the zero direction.

    Example
    -------
    >>> direction_uvtw_to_uvw(2, -1, -1, 0)   # [2,-1,-1,0] -> [100]
    (1, 0, 0)
    >>> direction_uvtw_to_uvw(1, 1, -2, 0)    # [1,1,-2,0] -> [110]
    (1, 1, 0)
    """
    expected_t = -(u + v)
    if t != expected_t:
        raise ValueError(
            "invalid Miller-Bravais direction index: t must equal -(u+v); "
            f"got t={t} but u={u}, v={v} requires t={expected_t}"
        )
    return _gcd_reduce3(2 * u + v, u + 2 * v, w)

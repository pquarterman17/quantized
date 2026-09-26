"""Atomic bond geometry in a periodic crystallographic unit cell.

Coordinates are fractional.  The optional minimum-image convention chooses
the nearest periodic image of each neighbour independently of the central
atom, including for skew (triclinic) cells.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from typing import Any

import numpy as np
from numpy.typing import NDArray

#: Search-box cap (integer lattice-shift candidates per neighbour). With the
#: tight per-axis bound below this is essentially never approached by a
#: physically sane cell; it exists only to fail fast on a genuinely
#: degenerate metric instead of hanging.
_MAX_CANDIDATES = 1_000_000

#: Relative tolerance for flagging two periodic images as a genuine tie
#: (equidistant from the vertex) rather than one merely being the winner of
#: floating-point noise. Wide enough to catch exact half-lattice ties (the
#: 45 deg/135 deg ambiguity at a cell-boundary midpoint) while never firing
#: on ordinary, well-separated candidates.
_TIE_RELATIVE_TOLERANCE = 1e-9


def _fractional_coordinate(value: Sequence[float], name: str) -> NDArray[np.float64]:
    """Parse ``value`` as exactly three finite fractional coordinates.

    ``np.asarray(...).shape == (3,)`` -- not merely ``len(value) == 3`` --
    so a nested/malformed input (e.g. three 3-tuples, ``[[1,2,3],[4,5,6],
    [7,8,9]]``, which used to slip past the old ``len`` check and go on to
    silently broadcast against the other coordinates) is rejected here with
    a clear message instead of producing a wrong-shaped, hard-to-diagnose
    result downstream.
    """
    try:
        coordinate = np.asarray(value, dtype=float)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} must contain exactly three fractional coordinates") from exc
    if coordinate.shape != (3,):
        raise ValueError(f"{name} must contain exactly three fractional coordinates")
    if not np.all(np.isfinite(coordinate)):
        raise ValueError(f"{name} coordinates must be finite")
    return coordinate


def _direct_basis(
    a: float,
    b: float,
    c: float,
    alpha: float,
    beta: float,
    gamma: float,
) -> NDArray[np.float64]:
    values = (a, b, c, alpha, beta, gamma)
    if not all(math.isfinite(value) for value in values):
        raise ValueError("cell parameters must be finite")
    if min(a, b, c) <= 0:
        raise ValueError("cell lengths must be positive")
    if not all(0.0 < angle < 180.0 for angle in (alpha, beta, gamma)):
        raise ValueError("cell angles must be between 0 and 180 degrees")

    # Local import: quantized.calc.crystallography imports `bond_angle` FROM
    # this module (a documented backward-compatible re-export -- see its
    # module docstring / __all__), so importing crystallography back at this
    # module's TOP level would cycle. A function-body import is safe: by the
    # time `_direct_basis` is actually called, Python has already finished
    # initializing whichever of the two modules got imported first. This
    # replaces a local copy of the triclinic volume radicand + its own
    # threshold/message with the one `crystallography.cell_volume` uses (PR
    # review finding: duplicated cell-volume radicand and validation).
    from quantized.calc.crystallography import _cell_volume_radicand

    gamma_r = math.radians(gamma)
    cos_alpha, cos_beta, cos_gamma, volume_factor_sq = _cell_volume_radicand(alpha, beta, gamma)
    sin_gamma = math.sin(gamma_r)
    if volume_factor_sq <= 1e-14 or abs(sin_gamma) <= 1e-14:
        raise ValueError("cell geometry is degenerate")

    basis = np.array(
        [
            [a, 0.0, 0.0],
            [b * cos_gamma, b * sin_gamma, 0.0],
            [
                c * cos_beta,
                c * (cos_alpha - cos_beta * cos_gamma) / sin_gamma,
                c * math.sqrt(volume_factor_sq) / sin_gamma,
            ],
        ],
        dtype=float,
    )
    if not np.all(np.isfinite(basis)):
        raise ValueError("cell parameters are outside the supported numeric range")
    return basis


def _axis_bounds(
    canonical_delta: NDArray[np.float64], metric: NDArray[np.float64], best_norm_sq: float
) -> list[range]:
    """Per-axis integer lattice-shift search range for the minimum-image search.

    ``|n_i| <= ceil(sqrt(best_norm_sq * inv(G)_ii))`` where ``G`` is the
    (rescaled) metric tensor: a Cauchy-Schwarz bound on each *individual*
    component of any vector whose quadratic form is at most ``best_norm_sq``,
    using the metric's OWN inverse diagonal rather than one shared radius
    derived from its smallest eigenvalue. The old shared-radius bound applies
    the same (necessarily large, to cover the worst-conditioned axis) radius
    to every axis, so a strongly anisotropic-but-perfectly-valid cell (e.g. a
    thin slab with a large ``c``) blew the candidate-count cap and was
    rejected as "too close to degenerate" even though each axis individually
    needs only a tiny range.
    """
    try:
        inv_metric = np.linalg.inv(metric)
    except np.linalg.LinAlgError as exc:
        raise ValueError("cell geometry is degenerate") from exc
    diag = np.asarray(np.diag(inv_metric), dtype=float)
    if not np.all(np.isfinite(diag)) or np.any(diag <= 0.0):
        raise ValueError("cell geometry is degenerate")

    # A small relative + absolute pad so a candidate sitting exactly on the
    # boundary (as an exact half-lattice tie does) is never excluded by
    # floating-point rounding of the bound itself.
    radii = np.sqrt(max(best_norm_sq, 0.0) * diag) * (1.0 + 1e-9) + 1e-9
    return [
        range(
            math.ceil(-float(component) - float(radius)),
            math.floor(-float(component) + float(radius)) + 1,
        )
        for component, radius in zip(canonical_delta, radii, strict=True)
    ]


def _minimum_image(
    delta: NDArray[np.float64], basis: NDArray[np.float64]
) -> tuple[NDArray[np.float64], NDArray[np.int64], bool, list[list[int]]]:
    """Return the exact shortest lattice image, not component-wise rounding.

    ``delta`` is first canonicalized to its ``[0, 1)`` representative on
    every axis (``delta - floor(delta)``), so the search only ever sees a
    translation-invariant seed: two callers who write the SAME physical
    displacement using different periodic copies of a coordinate (e.g.
    ``atom1 = (0.5, 0, 0)`` vs. ``atom1 = (1.5, 0, 0)`` against the same
    vertex) get an IDENTICAL search, and therefore an identical chosen image
    and angle -- not one that flips depending on how the input happened to
    be written (PR review finding: ambiguous ties resolved inconsistently
    across equivalent inputs). The integer shift returned is measured against
    the ORIGINAL, uncanonicalized ``delta``.

    A uniform basis rescale leaves the shortest image unchanged and avoids
    overflowing the metric tensor for large-but-finite cell lengths. The
    candidate grid (bounded per axis by :func:`_axis_bounds`) is evaluated in
    one vectorized quadratic form rather than a per-candidate Python loop.

    Returns ``(best_delta, image_shift, ambiguous, alternate_shifts)``:
    ``ambiguous`` is true when another, geometrically distinct integer shift
    ties the winner within ``_TIE_RELATIVE_TOLERANCE`` -- a genuine
    equidistant-image tie (e.g. a neighbour sitting exactly on a cell
    boundary) that the caller must surface rather than silently pick a side
    of. ``alternate_shifts`` lists those tied shifts (same frame as
    ``image_shift``), capped to a handful.
    """
    scaled_basis = basis / float(np.max(np.abs(basis)))
    metric = scaled_basis @ scaled_basis.T
    if np.any(np.abs(delta) > np.iinfo(np.int64).max // 2):
        raise ValueError("fractional coordinate difference is outside the supported numeric range")

    canonical_offset = np.floor(delta).astype(np.int64)
    canonical_delta = np.asarray(delta - canonical_offset, dtype=float)

    seed = -np.rint(canonical_delta).astype(np.int64)
    best_shift = seed
    best_delta = canonical_delta + seed
    best_norm_sq = float(best_delta @ metric @ best_delta)

    bounds = _axis_bounds(canonical_delta, metric, best_norm_sq)
    candidate_count = math.prod(len(bound) for bound in bounds)
    if candidate_count > _MAX_CANDIDATES:
        raise ValueError("cell is too close to degenerate for minimum-image search")

    axes = [np.array(bound, dtype=np.int64) for bound in bounds]
    grids = np.meshgrid(*axes, indexing="ij")
    candidates = np.stack([grid.reshape(-1) for grid in grids], axis=-1)
    candidate_deltas = canonical_delta[np.newaxis, :] + candidates
    norm_sq = np.asarray(
        np.einsum("ij,jk,ik->i", candidate_deltas, metric, candidate_deltas), dtype=float
    )

    best_index = int(np.argmin(norm_sq))
    if norm_sq[best_index] < best_norm_sq - 1e-14:
        best_norm_sq = float(norm_sq[best_index])
        best_shift = candidates[best_index]
        best_delta = candidate_deltas[best_index]

    tie_tolerance = _TIE_RELATIVE_TOLERANCE * max(best_norm_sq, 1e-300)
    is_tied = (norm_sq <= best_norm_sq + tie_tolerance) & np.any(candidates != best_shift, axis=1)
    alternates = [[int(v) for v in (row - canonical_offset)] for row in candidates[is_tied][:8]]

    image_shift = (best_shift - canonical_offset).astype(np.int64)
    return best_delta, image_shift, len(alternates) > 0, alternates


def _ambiguous_warning(label: str, alternates: list[list[int]]) -> str:
    shifts = "; ".join(f"({', '.join(str(v) for v in shift)})" for shift in alternates)
    plural = "s" if len(alternates) != 1 else ""
    return (
        f"{label}: another periodic image is equidistant from the vertex within "
        f"numerical tolerance (alternate lattice shift{plural}: {shifts}); the nearest "
        "image was chosen deterministically, but the tie is genuine -- treat the angle "
        "as ambiguous."
    )


def bond_angle(
    a: float,
    b: float,
    c: float,
    alpha: float,
    beta: float,
    gamma: float,
    atom1: Sequence[float],
    vertex: Sequence[float],
    atom3: Sequence[float],
    *,
    minimum_image: bool = True,
) -> dict[str, Any]:
    """Return the atom1-vertex-atom3 bond angle and the two bond lengths.

    ``image1`` and ``image3`` are the integer lattice translations applied to
    the two neighbours.  They are zero when ``minimum_image`` is false.
    ``ambiguous`` is true, and ``warnings`` names the tied alternative(s),
    when a neighbour sits exactly (within tolerance) on a periodic-image
    boundary -- the reported angle is still deterministic, but a genuinely
    different periodic image would give an equally valid, different answer.
    """
    basis = _direct_basis(a, b, c, alpha, beta, gamma)
    first = _fractional_coordinate(atom1, "atom1")
    centre = _fractional_coordinate(vertex, "vertex")
    third = _fractional_coordinate(atom3, "atom3")

    with np.errstate(over="ignore", invalid="ignore"):
        delta1 = first - centre
        delta3 = third - centre
    if not np.all(np.isfinite(delta1)) or not np.all(np.isfinite(delta3)):
        raise ValueError("fractional coordinate difference is outside the supported numeric range")
    image1 = np.zeros(3, dtype=np.int64)
    image3 = np.zeros(3, dtype=np.int64)
    warnings: list[str] = []
    if minimum_image:
        delta1, image1, ambiguous1, alternates1 = _minimum_image(delta1, basis)
        delta3, image3, ambiguous3, alternates3 = _minimum_image(delta3, basis)
        if ambiguous1:
            warnings.append(_ambiguous_warning("atom1", alternates1))
        if ambiguous3:
            warnings.append(_ambiguous_warning("atom3", alternates3))

    vector1 = delta1 @ basis
    vector3 = delta3 @ basis
    distance1 = math.hypot(*(float(value) for value in vector1))
    distance3 = math.hypot(*(float(value) for value in vector3))
    if not math.isfinite(distance1) or not math.isfinite(distance3):
        raise ValueError("cell and coordinates produce non-finite bond geometry")
    if distance1 <= 1e-14 or distance3 <= 1e-14:
        raise ValueError("each neighbour must be distinct from the vertex")

    cosine = float(np.dot(vector1 / distance1, vector3 / distance3))
    angle_deg = math.degrees(math.acos(min(1.0, max(-1.0, cosine))))
    return {
        "angle_deg": angle_deg,
        "distance1": distance1,
        "distance3": distance3,
        "image1": [int(value) for value in image1],
        "image3": [int(value) for value in image3],
        "ambiguous": bool(warnings),
        "warnings": warnings,
    }

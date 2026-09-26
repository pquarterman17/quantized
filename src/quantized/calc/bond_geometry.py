"""Atomic bond geometry in a periodic crystallographic unit cell.

Coordinates are fractional.  The optional minimum-image convention chooses
the nearest periodic image of each neighbour independently of the central
atom, including for skew (triclinic) cells.
"""

from __future__ import annotations

import itertools
import math
from collections.abc import Sequence
from typing import Any

import numpy as np
from numpy.typing import NDArray


def _fractional_coordinate(value: Sequence[float], name: str) -> NDArray[np.float64]:
    if len(value) != 3:
        raise ValueError(f"{name} must contain exactly three fractional coordinates")
    coordinate = np.asarray(value, dtype=float)
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

    alpha_r, beta_r, gamma_r = map(math.radians, (alpha, beta, gamma))
    cos_alpha, cos_beta, cos_gamma = map(math.cos, (alpha_r, beta_r, gamma_r))
    sin_gamma = math.sin(gamma_r)
    volume_factor_sq = (
        1.0
        - cos_alpha * cos_alpha
        - cos_beta * cos_beta
        - cos_gamma * cos_gamma
        + 2.0 * cos_alpha * cos_beta * cos_gamma
    )
    if volume_factor_sq <= 1e-14 or abs(sin_gamma) <= 1e-14:
        raise ValueError("cell geometry is degenerate")

    return np.array(
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


def _minimum_image(
    delta: NDArray[np.float64], basis: NDArray[np.float64]
) -> tuple[NDArray[np.float64], NDArray[np.int64]]:
    """Return the exact shortest lattice image, not component-wise rounding."""
    metric = basis @ basis.T
    seed = -np.rint(delta).astype(np.int64)
    best_shift = seed
    best_delta = delta + seed
    best_norm_sq = float(best_delta @ metric @ best_delta)

    smallest_eigenvalue = float(np.linalg.eigvalsh(metric)[0])
    if smallest_eigenvalue <= 0.0:
        raise ValueError("cell geometry is degenerate")
    radius = math.sqrt(max(best_norm_sq, 0.0) / smallest_eigenvalue) + 1e-12
    bounds = [
        range(math.ceil(-float(component) - radius), math.floor(-float(component) + radius) + 1)
        for component in delta
    ]
    candidate_count = math.prod(len(bound) for bound in bounds)
    if candidate_count > 1_000_000:
        raise ValueError("cell is too close to degenerate for minimum-image search")

    for candidate_tuple in itertools.product(*bounds):
        candidate = np.asarray(candidate_tuple, dtype=np.int64)
        candidate_delta = delta + candidate
        norm_sq = float(candidate_delta @ metric @ candidate_delta)
        if norm_sq < best_norm_sq - 1e-14:
            best_norm_sq = norm_sq
            best_shift = candidate
            best_delta = candidate_delta
    return best_delta, best_shift


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
    """
    basis = _direct_basis(a, b, c, alpha, beta, gamma)
    first = _fractional_coordinate(atom1, "atom1")
    centre = _fractional_coordinate(vertex, "vertex")
    third = _fractional_coordinate(atom3, "atom3")

    delta1 = first - centre
    delta3 = third - centre
    image1 = np.zeros(3, dtype=np.int64)
    image3 = np.zeros(3, dtype=np.int64)
    if minimum_image:
        delta1, image1 = _minimum_image(delta1, basis)
        delta3, image3 = _minimum_image(delta3, basis)

    vector1 = delta1 @ basis
    vector3 = delta3 @ basis
    distance1 = float(np.linalg.norm(vector1))
    distance3 = float(np.linalg.norm(vector3))
    if distance1 <= 1e-14 or distance3 <= 1e-14:
        raise ValueError("each neighbour must be distinct from the vertex")

    cosine = float(np.dot(vector1, vector3) / (distance1 * distance3))
    angle_deg = math.degrees(math.acos(min(1.0, max(-1.0, cosine))))
    return {
        "angle_deg": angle_deg,
        "distance1": distance1,
        "distance3": distance3,
        "image1": [int(value) for value in image1],
        "image3": [int(value) for value in image3],
    }

"""2-D map data contract + builder: scattered (x, y, z) -> regular grid.

``DataStruct`` is the 1-D contract (``time`` ``N``, ``values`` ``N×M``); a 2-D
map (a ``Z`` field over an ``X×Y`` grid — e.g. an XRD reciprocal-space map) is a
*sibling* structure, not a forced fit. ``MapData`` holds the regular grid
produced by :func:`quantized.calc.interp2d.regrid2d`, ready for a Canvas2D
heatmap render.

Storage is the compact regular-grid form: 1-D ``x_axis`` (``nx``) and ``y_axis``
(``ny``) plus a 2-D ``z_grid`` (``ny × nx``) — cell ``z_grid[j, i]`` sits at
``(x_axis[i], y_axis[j])``. This is ``nx + ny`` axis floats instead of the
``2·nx·ny`` of full meshgrids, and is exactly what a heatmap consumes.

Pure calc layer — ndarrays in, ``MapData`` out. No fastapi/pydantic imports
(enforced by ``test_repo_integrity``). The instance is frozen and its arrays are
read-only, honouring the "raw data is preserved, never mutated in place" rule.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray

from quantized.calc.interp2d import regrid2d
from quantized.datastruct import DataStruct

__all__ = ["MapData", "MapState", "build_map", "map_from_datastruct"]


@dataclass(frozen=True, slots=True)
class MapState:
    """Gridding config for :func:`build_map` (the 2-D analogue of ``PlotState``).

    Mirrors :func:`quantized.calc.interp2d.regrid2d`'s parameters. ``method``
    defaults to ``"natural"`` (MATLAB ``scatteredInterpolant``'s default; here
    Clough-Tocher C1 cubic — not bit-for-bit MATLAB-equal, see ``interp2d``).
    """

    method: str = "natural"
    nx: int = 200
    ny: int = 200
    xlim: tuple[float, float] | None = None
    ylim: tuple[float, float] | None = None
    extrapolation: str = "none"
    smoothing: float = 0.0
    idw_power: float = 2.0


@dataclass(frozen=True, slots=True)
class MapData:
    """Immutable regular-grid 2-D map. Build via :func:`build_map`.

    ``z_grid`` is ``(ny, nx)``; ``x_axis`` is ``(nx,)`` and ``y_axis`` is
    ``(ny,)``. Outside the data convex hull ``z_grid`` is ``NaN`` (gaps), so use
    the nan-aware :attr:`z_min` / :attr:`z_max` for colour scaling.
    """

    x_axis: NDArray[np.float64]
    y_axis: NDArray[np.float64]
    z_grid: NDArray[np.float64]
    x_label: str = "x"
    x_unit: str = ""
    y_label: str = "y"
    y_unit: str = ""
    z_label: str = "z"
    z_unit: str = ""
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        x_axis = np.asarray(self.x_axis, dtype=float).ravel()
        y_axis = np.asarray(self.y_axis, dtype=float).ravel()
        z_grid = np.asarray(self.z_grid, dtype=float)
        if z_grid.ndim != 2:
            raise ValueError(f"z_grid must be 2-D, got {z_grid.ndim}-D")
        ny, nx = z_grid.shape
        if x_axis.shape[0] != nx:
            raise ValueError(
                f"x_axis length ({x_axis.shape[0]}) must equal z_grid columns ({nx})"
            )
        if y_axis.shape[0] != ny:
            raise ValueError(
                f"y_axis length ({y_axis.shape[0]}) must equal z_grid rows ({ny})"
            )

        x_axis.flags.writeable = False
        y_axis.flags.writeable = False
        z_grid.flags.writeable = False

        object.__setattr__(self, "x_axis", x_axis)
        object.__setattr__(self, "y_axis", y_axis)
        object.__setattr__(self, "z_grid", z_grid)
        object.__setattr__(self, "metadata", MappingProxyType(dict(self.metadata)))

    # ── Shape helpers ─────────────────────────────────────────────────────
    @property
    def nx(self) -> int:
        return int(self.x_axis.shape[0])

    @property
    def ny(self) -> int:
        return int(self.y_axis.shape[0])

    @property
    def z_min(self) -> float:
        """Finite minimum of ``z_grid`` (``nan`` if the grid is all-NaN/empty)."""
        return _finite_extreme(self.z_grid, np.nanmin)

    @property
    def z_max(self) -> float:
        """Finite maximum of ``z_grid`` (``nan`` if the grid is all-NaN/empty)."""
        return _finite_extreme(self.z_grid, np.nanmax)

    # ── Serialization (route boundary) ────────────────────────────────────
    # Raw lists keep NaN (Python-round-trippable, like DataStruct.to_dict). The
    # HTTP boundary maps non-finite floats to null — a routes concern (jsonify).
    def to_dict(self) -> dict[str, Any]:
        return {
            "x_axis": self.x_axis.tolist(),
            "y_axis": self.y_axis.tolist(),
            "z_grid": self.z_grid.tolist(),
            "x": {"label": self.x_label, "unit": self.x_unit},
            "y": {"label": self.y_label, "unit": self.y_unit},
            "z": {
                "label": self.z_label,
                "unit": self.z_unit,
                "min": self.z_min,
                "max": self.z_max,
            },
            "metadata": dict(self.metadata),
        }


def _finite_extreme(grid: NDArray[np.float64], reducer: Any) -> float:
    """``nanmin``/``nanmax`` that returns ``nan`` (not a RuntimeWarning) when empty."""
    if grid.size == 0 or not np.isfinite(grid).any():
        return float("nan")
    return float(reducer(grid))


def build_map(
    x: ArrayLike,
    y: ArrayLike,
    z: ArrayLike,
    state: MapState | None = None,
    *,
    x_label: str = "x",
    x_unit: str = "",
    y_label: str = "y",
    y_unit: str = "",
    z_label: str = "z",
    z_unit: str = "",
    metadata: Mapping[str, Any] | None = None,
) -> MapData:
    """Regrid scattered ``(x, y, z)`` onto a regular grid and wrap as ``MapData``.

    Delegates the interpolation to :func:`quantized.calc.interp2d.regrid2d`; see
    that function for per-method parity caveats. Raises ``ValueError`` for fewer
    than 3 points or a degenerate axis range (propagated from ``regrid2d``).
    """
    state = state or MapState()
    xq, yq, zq = regrid2d(
        x,
        y,
        z,
        nx=state.nx,
        ny=state.ny,
        method=state.method,
        xlim=state.xlim,
        ylim=state.ylim,
        extrapolation=state.extrapolation,
        smoothing=state.smoothing,
        idw_power=state.idw_power,
    )
    # regrid2d builds the grid via meshgrid(linspace, linspace), so the axes are
    # the first row / column of the returned meshgrids.
    return MapData(
        x_axis=xq[0, :],
        y_axis=yq[:, 0],
        z_grid=zq,
        x_label=x_label,
        x_unit=x_unit,
        y_label=y_label,
        y_unit=y_unit,
        z_label=z_label,
        z_unit=z_unit,
        metadata=dict(metadata) if metadata is not None else {},
    )


def map_from_datastruct(
    ds: DataStruct,
    x_key: int | str,
    y_key: int | str,
    z_key: int | str,
    state: MapState | None = None,
) -> MapData:
    """Build a ``MapData`` from three channels of a (scattered) ``DataStruct``.

    The 3-column ``(x, y, z)`` form is how RSM/contour ASCII exports arrive
    before a 2-D area-detector parser exists, so any such dataset can be mapped
    today. Labels/units are carried from the chosen channels.
    """
    xi = _resolve(ds, x_key)
    yi = _resolve(ds, y_key)
    zi = _resolve(ds, z_key)
    return build_map(
        ds.values[:, xi],
        ds.values[:, yi],
        ds.values[:, zi],
        state,
        x_label=ds.labels[xi],
        x_unit=ds.units[xi],
        y_label=ds.labels[yi],
        y_unit=ds.units[yi],
        z_label=ds.labels[zi],
        z_unit=ds.units[zi],
        metadata={"source": ds.metadata.get("source", "")},
    )


def _resolve(ds: DataStruct, key: int | str) -> int:
    """Channel index from an int index or a label string (mirrors plotting._resolve)."""
    return key if isinstance(key, int) else ds.labels.index(key)

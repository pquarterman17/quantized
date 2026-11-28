"""Drop the 3-D bar faces that cannot be seen, so a vector export stays small.

``Axes3D.bar3d`` draws all six faces of every box. From any camera three of a
convex box's faces face away, and under an ORTHOGRAPHIC projection (the export's
camera, ``figure_map3d.set_view``) a face turned away from the camera is wholly
covered by the box's own faces turned towards it. Leaving them out changes no
visible pixel but halves the number of paths in an SVG / PDF / EPS (10,000 bars:
60,000 faces to 30,000).

* The faces are rebuilt from the bars' own numbers with ``bar3d``'s cuboid and
  ordering; the new ``Poly3DCollection`` shades from the polygons it is given,
  so each kept face has the colour ``bar3d`` gave it.
* A face is kept unless its projected outline is wound against the box's own
  orientation (an outward, counter-clockwise outline faces the camera). Edge-on
  faces (zero area) are kept.
* Fail closed: a bar with no height (its top and bottom coincide), any
  translucent face, an inverted or non-linear axis, or a matplotlib whose
  collection no longer matches what was drawn leaves every face in place.

Pure (arrays in, matplotlib calls out).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
from matplotlib.colors import to_rgba_array
from mpl_toolkits.mplot3d import proj3d
from mpl_toolkits.mplot3d.art3d import Poly3DCollection
from numpy.typing import NDArray

__all__ = ["BarFaces", "cull_hidden_faces", "make_bar_faces"]

# bar3d's unit cuboid: [face, vertex, xyz]. Every face is counter-clockwise seen
# from outside when the box's dx, dy and dz are positive.
SEAM_PT = 0.3
_CUBOID = np.array(
    [
        ((0, 0, 0), (0, 1, 0), (1, 1, 0), (1, 0, 0)),  # -z
        ((0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)),  # +z
        ((0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)),  # -y
        ((0, 1, 0), (0, 1, 1), (1, 1, 1), (1, 1, 0)),  # +y
        ((0, 0, 0), (0, 0, 1), (0, 1, 1), (0, 1, 0)),  # -x
        ((1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1)),  # +x
    ],
    dtype=float,
)


@dataclass(frozen=True)
class BarFaces:
    """What ``draw_bars`` drew: the collection, and the polygons (n_bars, 6, 4, 3),
    colours (n_bars, 6, 4) and height signs (n_bars) it was made from."""

    collection: Any
    polys: NDArray[np.float64]
    colours: NDArray[np.float64]
    height_sign: NDArray[np.float64]


def make_bar_faces(
    collection: Any,
    x0: NDArray[np.float64],
    y0: NDArray[np.float64],
    z0: NDArray[np.float64],
    dx: float,
    dy: float,
    dz: NDArray[np.float64],
    face: Any,
) -> BarFaces:
    """``bar3d``'s polygons and per-face colours for the bars just drawn."""
    n = x0.size
    polys = np.empty((n, 6, 4, 3))
    for i, (p, dp) in enumerate(((x0, dx), (y0, dy), (z0, dz))):
        polys[..., i] = (
            np.asarray(p)[:, None, None] + np.asarray(dp)[..., None, None] * _CUBOID[..., i]
        )
    rgba = to_rgba_array(face)
    if len(rgba) == n:
        colours = np.repeat(rgba[:, None, :], 6, axis=1)
    else:
        colours = np.broadcast_to(rgba[:1], (n, 6, 4)).copy()
    return BarFaces(collection, polys, colours, np.sign(np.asarray(dz, dtype=float)))


def _screen_area(ax: Any, polys: NDArray[np.float64]) -> NDArray[np.float64]:
    """Signed area of every face's projected outline, shape (n_bars, 6)."""
    flat = polys.reshape(-1, 4, 3)
    sx, sy, _ = proj3d.proj_transform(
        flat[..., 0].ravel(), flat[..., 1].ravel(), flat[..., 2].ravel(), ax.get_proj()
    )
    px = np.asarray(sx).reshape(-1, 4)
    py = np.asarray(sy).reshape(-1, 4)
    area = 0.5 * np.sum(px * np.roll(py, -1, axis=1) - np.roll(px, -1, axis=1) * py, axis=1)
    return np.asarray(area).reshape(polys.shape[0], 6)


def cull_hidden_faces(ax: Any, faces: BarFaces, seam_pt: float = SEAM_PT) -> int:
    """Replace ``faces.collection`` by one holding only the faces that face the
    camera (call after the view and the limits are final). Returns the number of
    faces dropped; 0 when nothing was safe to drop."""
    colours = faces.colours
    if (
        bool(np.any(colours[..., 3] < 1.0))
        or bool(np.any(faces.height_sign == 0))
        or faces.collection not in ax.collections
        or any(getattr(ax, f"get_{a}scale")() != "linear" for a in "xyz")
        or any(lo >= hi for lo, hi in (ax.get_xlim(), ax.get_ylim(), ax.get_zlim()))
    ):
        return 0
    area = _screen_area(ax, faces.polys) * faces.height_sign[:, None]
    keep = area >= -1e-12 * max(1.0, float(np.max(np.abs(area), initial=0.0)))
    dropped = int(keep.size - np.count_nonzero(keep))
    if dropped == 0:
        return 0
    faces.collection.remove()
    kept = Poly3DCollection(
        list(faces.polys[keep]),
        facecolors=colours[keep],
        edgecolors=colours[keep],
        linewidths=seam_pt,
        shade=True,
        zsort="average",
    )
    ax.add_collection(kept, autolim=False)
    return dropped

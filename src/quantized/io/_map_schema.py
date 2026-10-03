"""The shared 2-D map DataStruct: one constructor for every map importer.

XRDML RSMs and pole figures (``io/xrdml.py``, ``io/_xrdml_scan.py``) and
Bruker multi-scan ``.brml`` RSMs (``io/bruker_brml_map.py``) all return the
same scattered point cloud -- one row per detector pixel per scan, the map
axes as value columns, ``metadata.is2D`` / ``map_shape`` for the grid. The
map viewer, cuts and RSM analysis read those columns, never ``.time``.

``.time`` is still the dataset's default plot x everywhere else (the Plot
tab, ``/api/plot/series``, the SVG/PDF export, the data grid, Library
thumbnails), titled by ``metadata.x_column_name``. It is therefore the
column that title names (``x_channel``: 2Theta, or Phi for a pole figure),
not a row index: an index under a "2-Theta (deg)" title drew every channel
against 0..N-1 (plot audit, the .brml RSM import). MATLAB's importXRDML
returns the map as a grid, not a point cloud, so no frozen golden pins the
old index.

Two existing parser plot hints make that default plot useful, and the
frontend already honours both on screen and in export
(``lib/plotdata.ts``'s ``defaultDenseChannels``, ``store/windowDefaults.ts``):

- ``default_value_channels = [Intensity]``: the axes and Qx/Qz are the map's
  coordinates, not signals to overlay on an intensity plot.
- ``default_trace = "Scatter"``: markers, no joining line. Rows run scan by
  scan, so a line would add a fly-back stroke from each scan's last pixel to
  the next scan's first, across the full x range; for coupled and pole maps
  no single channel orders the points into a curve at all. Points are the
  layout-independent honest view (the 2theta projection of the whole map).

Pure layer: ndarray in -> DataStruct out.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.datastruct import DataStruct

__all__ = ["map_datastruct"]


def map_datastruct(
    values: NDArray[np.float64],
    labels: Sequence[str],
    units: Sequence[str],
    metadata: dict[str, Any],
    *,
    x_channel: str,
) -> DataStruct:
    """The map DataStruct with ``.time`` = column ``x_channel`` + plot hints."""
    labels = list(labels)
    meta = {
        **metadata,
        "default_value_channels": [labels.index("Intensity")],
        "default_trace": "Scatter",
    }
    return DataStruct.create(
        np.asarray(values[:, labels.index(x_channel)], dtype=float),
        values,
        labels=labels,
        units=list(units),
        metadata=meta,
    )

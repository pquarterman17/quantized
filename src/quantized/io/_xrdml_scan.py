"""XRDML per-scan model + generalized (cloud) 2-D assembly.

Split out of ``io/xrdml.py`` (500-line module ceiling). ``_Scan`` is the
per-scan record collected during the parse; ``_classify_cloud`` /
``_build_2d_cloud`` implement the snapshot/coupled RSM layouts that go
beyond the MATLAB-compatible mesh (see the ``io/xrdml`` module docstring);
``_classify_pole`` / ``_build_pole`` implement the pole-figure layout
(gap #46 residual).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.calc.qspace import compute_qspace
from quantized.datastruct import DataStruct

_SECONDARY_AXES = ("Omega", "Chi", "Phi")
# Tilt-axis element names PANalytical schemas use for pole-figure cradles:
# "Psi" on texture-goniometer (Eulerian/chi-less) cradles, "Chi" on older
# Eulerian cradles. Checked in this order; either satisfies _classify_pole.
_TILT_AXES = ("Psi", "Chi")

class _Scan:
    """Per-scan data collected during the parse (1D concat + 2D classification)."""

    __slots__ = ("tt_range", "tt_list", "counts", "sec_value", "sec_ranges")

    def __init__(
        self,
        tt_range: tuple[float, float],
        tt_list: NDArray[np.float64] | None,
        counts: NDArray[np.float64],
        sec_value: float,
        sec_ranges: dict[str, tuple[float, float]],
    ) -> None:
        self.tt_range = tt_range
        self.tt_list = tt_list
        self.counts = counts
        self.sec_value = sec_value
        # (start, end) per present secondary axis — start == end means the
        # axis was held fixed for this scan.
        self.sec_ranges = sec_ranges

    def two_theta(self) -> NDArray[np.float64]:
        """This scan's per-pixel 2theta vector (listPositions or linspace)."""
        if self.tt_list is not None and self.tt_list.size == self.counts.size:
            return self.tt_list
        return np.linspace(self.tt_range[0], self.tt_range[1], self.counts.size)

    def axis_vector(self, axis: str) -> NDArray[np.float64]:
        """The secondary axis as a per-pixel vector: constant when fixed,
        linspace(start, end) when the axis moved during the scan (coupled)."""
        start, end = self.sec_ranges[axis]
        if start == end:
            return np.full(self.counts.size, start)
        return np.linspace(start, end, self.counts.size)


def _classify_cloud(scans: list[_Scan]) -> tuple[str, str] | None:
    """Generalized 2-D detection BEYOND the MATLAB-compatible mesh (`_is_2d`).

    Returns ``(axis, kind)`` or ``None``. Tried only after `_is_2d` fails, so
    reaching the snapshot branch implies the per-scan 2theta windows differ.
    Requires >= 3 scans (a 2-range 1-D file must never classify as a map).

    - ``snapshot``: an axis held fixed within EVERY scan whose value varies
      across scans (PIXcel3D "Scanning snapshot": omega fixed per frame while
      both omega and the 2theta window step frame-to-frame).
    - ``coupled``: all scans share one 2theta window while an axis sweeps
      WITHIN each scan (start != end) at a stepped offset across scans
      (schema-1.0 Omega-2Theta RSMs — a sheared mesh).
    """
    if len(scans) < 3:
        return None
    for axis in _SECONDARY_AXES:
        ranges = [s.sec_ranges.get(axis) for s in scans]
        if any(r is None for r in ranges):
            continue
        rr = [r for r in ranges if r is not None]  # narrow for the type checker
        if all(r[0] == r[1] for r in rr):
            vals = [r[0] for r in rr]
            if max(vals) - min(vals) > 1e-6:
                return axis, "snapshot"
    s0, e0 = scans[0].tt_range
    tt_same = all(
        abs(s.tt_range[0] - s0) < 1e-4 and abs(s.tt_range[1] - e0) < 1e-4 for s in scans
    )
    if tt_same:
        for axis in _SECONDARY_AXES:
            ranges = [s.sec_ranges.get(axis) for s in scans]
            if any(r is None for r in ranges):
                continue
            rr = [r for r in ranges if r is not None]
            if all(r[0] != r[1] for r in rr):
                mids = [0.5 * (r[0] + r[1]) for r in rr]
                if max(mids) - min(mids) > 1e-6:
                    return axis, "coupled"
    return None


def _classify_pole(scans: list[_Scan]) -> tuple[str, float] | None:
    """Detect a PANalytical pole-figure layout.

    A pole figure holds 2Theta fixed at the Bragg condition for one
    reflection, sweeps Phi (azimuthal, typically ~360 deg) WITHIN every
    scan, and steps a tilt axis -- "Psi" (texture cradles) or "Chi" (older
    Eulerian cradles) -- fixed within each scan but varying ACROSS scans.

    Returns ``(tilt_axis, two_theta_deg)`` or ``None``. Must run BEFORE
    ``_is_2d``/``_classify_cloud``: a Chi-named tilt axis alone already
    satisfies the generic ``snapshot`` cloud pattern (fixed-per-scan,
    varying across scans) and would silently classify as a mesh/snapshot
    RSM while dropping the Phi sweep entirely; a Psi-named one is invisible
    to both classifiers (Psi is not one of the axes they inspect), so it
    would otherwise fall through to the flat 1-D path.
    """
    if len(scans) < 2:
        return None
    s0, e0 = scans[0].tt_range
    if abs(s0 - e0) > 1e-6:
        return None  # 2Theta itself sweeps -> not a fixed-reflection pole figure
    tt_same = all(
        abs(s.tt_range[0] - s0) < 1e-4 and abs(s.tt_range[1] - e0) < 1e-4 for s in scans
    )
    if not tt_same:
        return None

    phi_ranges = [s.sec_ranges.get("Phi") for s in scans]
    if any(r is None for r in phi_ranges):
        return None
    phi_rr = [r for r in phi_ranges if r is not None]
    if not all(r[0] != r[1] for r in phi_rr):
        return None  # Phi must sweep WITHIN every scan

    for tilt_axis in _TILT_AXES:
        ranges = [s.sec_ranges.get(tilt_axis) for s in scans]
        if any(r is None for r in ranges):
            continue
        rr = [r for r in ranges if r is not None]
        if not all(r[0] == r[1] for r in rr):
            continue  # tilt axis must be fixed WITHIN every scan
        vals = [r[0] for r in rr]
        if max(vals) - min(vals) > 1e-6:  # and step ACROSS scans
            return tilt_axis, s0
    return None


def _build_pole(
    scans: list[_Scan],
    tilt_axis: str,
    two_theta_deg: float,
    path: Path,
    intensity: str,
    counting_time: float,
    intensity_tag: str,
    att: dict[str, Any],
) -> DataStruct:
    """Assemble a pole-figure point cloud: per-point (Phi, Psi, Intensity).

    Every scan is an azimuthal Phi sweep at one fixed tilt. Unlike the RSM
    mesh/cloud kinds, 2Theta does not vary point-to-point here -- it is the
    single Bragg condition for the whole measurement, so it is recorded as
    scalar metadata (``two_theta_deg``) rather than a column. The tilt axis
    is normalized to the "Psi" label in the output regardless of whether
    the source XML called it "Psi" or "Chi" (``tilt_axis_source`` keeps the
    original element name), so downstream code has one consistent name.
    Stereographic/polar projection is a later view (ORIGIN_GAP_PLAN #46) --
    this is the flat psi x phi map that feeds it.
    """
    order = sorted(range(len(scans)), key=lambda i: scans[i].sec_ranges[tilt_axis][0])
    phi = np.concatenate([scans[i].axis_vector("Phi") for i in order])
    psi = np.concatenate(
        [np.full(scans[i].counts.size, scans[i].sec_ranges[tilt_axis][0]) for i in order]
    )
    counts = np.concatenate([scans[i].counts for i in order])

    vals, unit = _apply_intensity(counts, intensity, counting_time)
    values = np.column_stack([phi, psi, np.asarray(vals, dtype=float)])
    labels = ["Phi", "Psi", "Intensity"]
    units = ["deg", "deg", unit]

    pix_counts = {s.counts.size for s in scans}
    n_pix = pix_counts.pop() if len(pix_counts) == 1 else None
    metadata: dict[str, Any] = {
        "source": str(path),
        "parser_name": "import_xrdml",
        "x_column_name": "Phi",
        "x_column_unit": "deg",
        "num_points": int(values.shape[0]),
        "counting_time": counting_time,
        "intensity_tag": intensity_tag,
        "is2D": True,
        "mesh_kind": "pole",
        # Index grid (frames x pixels) only when every scan has the same
        # Phi-sample count; None = ragged (rare, but no reason to require it).
        "map_shape": [len(scans), int(n_pix)] if n_pix is not None else None,
        "axis1_name": "Psi",
        "axis2_name": "Phi",
        "two_theta_deg": float(two_theta_deg),
        "tilt_axis_source": tilt_axis,
    }
    metadata.update(att)
    return DataStruct.create(
        np.arange(values.shape[0], dtype=float),
        values,
        labels=labels,
        units=units,
        metadata=metadata,
    )


def _build_2d_cloud(
    scans: list[_Scan],
    sec_name: str,
    mesh_kind: str,
    path: Path,
    intensity: str,
    counting_time: float,
    wavelength: float,
    intensity_tag: str,
    att: dict[str, Any],
) -> DataStruct:
    """Assemble a generalized RSM point cloud (snapshot / coupled layouts).

    Unlike `_build_2d` there is no shared 2theta vector: every scan contributes
    its own per-pixel 2theta (and, for coupled scans, per-pixel omega), so the
    output is a true scattered cloud. Same column schema as the mesh path.
    """

    def _mid(s: _Scan) -> float:
        r = s.sec_ranges[sec_name]
        return 0.5 * (r[0] + r[1])

    order = sorted(range(len(scans)), key=lambda i: _mid(scans[i]))
    tt = np.concatenate([scans[i].two_theta() for i in order])
    sec = np.concatenate([scans[i].axis_vector(sec_name) for i in order])
    counts = np.concatenate([scans[i].counts for i in order])

    vals, unit = _apply_intensity(counts, intensity, counting_time)
    columns = [tt, sec, np.asarray(vals, dtype=float)]
    labels = ["2Theta", sec_name, "Intensity"]
    units = ["deg", "deg", unit]
    if sec_name == "Omega" and np.isfinite(wavelength) and wavelength > 0:
        qx, qz = compute_qspace(tt, sec, wavelength)
        columns += [np.asarray(qx, dtype=float).ravel(), np.asarray(qz, dtype=float).ravel()]
        labels += ["Qx", "Qz"]
        units += ["Ang^-1", "Ang^-1"]

    pix_counts = {s.counts.size for s in scans}
    n_pix = pix_counts.pop() if len(pix_counts) == 1 else None
    values = np.column_stack(columns)
    metadata: dict[str, Any] = {
        "source": str(path),
        "parser_name": "import_xrdml",
        "x_column_name": "2-Theta",
        "x_column_unit": "deg",
        "num_points": int(values.shape[0]),
        "counting_time": counting_time,
        "intensity_tag": intensity_tag,
        "is2D": True,
        "mesh_kind": mesh_kind,
        # Index grid (frames x pixels) only when every frame has the same
        # pixel count; None = ragged cloud (grid cuts unavailable, scattered
        # rendering + segment cuts still work).
        "map_shape": [len(scans), int(n_pix)] if n_pix is not None else None,
        "axis1_name": sec_name,
        "axis2_name": "2Theta",
        "wavelength_a": float(wavelength) if np.isfinite(wavelength) else None,
    }
    metadata.update(att)
    return DataStruct.create(
        np.arange(values.shape[0], dtype=float),
        values,
        labels=labels,
        units=units,
        metadata=metadata,
    )


def _apply_intensity(
    counts: NDArray[np.float64], intensity: str, counting_time: float
) -> tuple[NDArray[np.float64], str]:
    """counts -> (cps or counts, unit). cps needs a positive counting time."""
    if intensity == "cps" and not np.isnan(counting_time) and counting_time > 0:
        return np.asarray(counts / counting_time, dtype=float), "cps"
    return counts, "counts"

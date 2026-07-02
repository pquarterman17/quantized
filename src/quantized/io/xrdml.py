"""PANalytical XRDML parser. Port of MATLAB parser.importXRDML.

**1D scans** (the common case): x = 2theta reconstructed by
``linspace(start, end, N)``; intensity = counts, optionally divided by
``commonCountingTime`` to cps (the default). Multi-scan files concatenate
Completed scans in appendNumber order. Returns ``[Intensity]`` vs 2theta.

**2D area-detector (RSM)** — three layouts, detected automatically and all
returned as a *scattered* multi-column DataStruct (``[2Theta, <axis1>,
Intensity]`` + ``[Qx, Qz]`` when the secondary axis is Omega and a wavelength
is present) so the 2-D map viewer (``calc/map``) can render any of them.
``metadata.is2D`` / ``map_shape`` record the ``(N_frames, M_pixels)`` index
grid; ``metadata.mesh_kind`` records the layout:

- ``"mesh"`` — the classic scanning-line RSM (schema 1.3): every scan shares
  one 2theta range while a secondary motor (Omega / Chi / Phi) is fixed per
  scan and steps between scans. (This is the only layout the MATLAB reference
  detects; its output is byte-compatible here.)
- ``"snapshot"`` — PIXcel3D-style area snapshots (schema 2.x, e.g. "Scanning
  snapshot equatorial"): the secondary motor is fixed per scan, but the
  2theta window ALSO moves scan-to-scan, so there is no shared 2theta vector
  — each frame contributes its own 2theta pixels at its omega.
- ``"coupled"`` — schema-1.0-era RSMs: each scan is a coupled Omega-2Theta
  sweep (omega varies WITHIN the scan) at a stepped omega offset; the point
  cloud is a sheared mesh.
"""

from __future__ import annotations

import warnings
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.calc.qspace import compute_qspace
from quantized.datastruct import DataStruct

__all__ = ["import_xrdml"]

_SECONDARY_AXES = ("Omega", "Chi", "Phi")


def _local(tag: str) -> str:
    """Strip the XML namespace: '{uri}counts' -> 'counts'."""
    return tag.rsplit("}", 1)[-1]


def _find_all(elem: ET.Element, name: str) -> list[ET.Element]:
    return [e for e in elem.iter() if _local(e.tag) == name]


def _find_first(elem: ET.Element, name: str) -> ET.Element | None:
    for e in elem.iter():
        if _local(e.tag) == name:
            return e
    return None


def _text_float(elem: ET.Element | None) -> float:
    if elem is None or elem.text is None:
        return float("nan")
    return float(elem.text.strip())


def _wavelength(root: ET.Element) -> float:
    """K-Alpha1 wavelength in Angstrom (NaN when absent)."""
    return _text_float(_find_first(root, "kAlpha1"))


def _axis_positions(
    dp: ET.Element, axis: str
) -> tuple[tuple[float, float] | None, NDArray[np.float64] | None]:
    """For ``<positions axis="...">`` return ``(range, list)``.

    ``range`` is ``(start, end)`` from start/end positions, ``(c, c)`` from a
    commonPosition, or ``(first, last)`` from listPositions; ``None`` if the axis
    is absent. ``list`` is the explicit listPositions array (or ``None``). Mirrors
    MATLAB ``rxPositions``.
    """
    for pos in _find_all(dp, "positions"):
        if pos.get("axis") != axis:
            continue
        lp = _find_first(pos, "listPositions")
        if lp is not None and lp.text:
            arr = np.asarray([float(v) for v in lp.text.split()], dtype=float)
            return (float(arr[0]), float(arr[-1])), arr
        sp = _find_first(pos, "startPosition")
        ep = _find_first(pos, "endPosition")
        if sp is not None and ep is not None:
            return (_text_float(sp), _text_float(ep)), None
        cp = _find_first(pos, "commonPosition")
        if cp is not None:
            c = _text_float(cp)
            return (c, c), None
    return None, None


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


def import_xrdml(filepath: str | Path, *, intensity: str = "cps") -> DataStruct:
    """Import a PANalytical ``.xrdml`` (1D scan or 2D RSM mesh). Default = cps."""
    if intensity not in ("cps", "counts"):
        raise ValueError(f'intensity must be "cps" or "counts", got "{intensity}"')
    path = Path(filepath)
    text = path.read_text(encoding="latin-1")
    # Strip a UTF-8 BOM: Windows instrument software emits one, and decoded
    # as latin-1 it becomes "ï»¿" — an invalid token to the XML parser.
    if text.startswith("\xef\xbb\xbf"):
        text = text[3:]
    root = ET.fromstring(text)

    scans_xml = _find_all(root, "scan")
    if not scans_xml:
        raise ValueError(f"no <scan> element in {path.name}")
    # appendNumber is usually an int but some exporters write "1.0"; float()
    # accepts both and preserves ordering (int() raised on float strings).
    scans_xml.sort(key=lambda s: float(s.get("appendNumber", "1")))

    wavelength = _wavelength(root)
    counting_time = float("nan")
    counting_times_all: list[float] = []
    intensity_tag = "counts"
    sec_name: str | None = None
    collected: list[_Scan] = []

    for scan in scans_xml:
        status = scan.get("status")
        if status is not None and status.lower() != "completed":
            continue
        dp = _find_first(scan, "dataPoints")
        if dp is None:
            continue

        ct = _text_float(_find_first(dp, "commonCountingTime"))
        if not np.isnan(ct):
            counting_times_all.append(ct)
            if np.isnan(counting_time):
                counting_time = ct

        counts_elem = _find_first(dp, "counts")
        if counts_elem is None:
            counts_elem = _find_first(dp, "intensities")
            if counts_elem is not None:
                intensity_tag = "intensities"
        if counts_elem is None or counts_elem.text is None:
            continue
        counts = np.asarray([float(x) for x in counts_elem.text.split()], dtype=float)
        if counts.size < 1:
            continue

        tt_range, tt_list = _axis_positions(dp, "2Theta")
        if tt_range is None:
            continue

        # Secondary axes: record every present Omega/Chi/Phi range for the 2-D
        # classification. sec_name keeps the MATLAB-compatible behaviour
        # (first axis found fixed within a scan) for the classic-mesh path.
        sec_ranges: dict[str, tuple[float, float]] = {}
        for axis in _SECONDARY_AXES:
            rng, _ = _axis_positions(dp, axis)
            if rng is not None:
                sec_ranges[axis] = rng
        if sec_name is None:
            for axis in _SECONDARY_AXES:
                rng2 = sec_ranges.get(axis)
                if rng2 is not None and rng2[0] == rng2[1]:
                    sec_name = axis
                    break
        sec_value = float("nan")
        if sec_name is not None:
            rng3 = sec_ranges.get(sec_name)
            if rng3 is not None and rng3[0] == rng3[1]:
                sec_value = rng3[0]

        collected.append(_Scan(tt_range, tt_list, counts, sec_value, sec_ranges))

    if not collected:
        raise ValueError(f"no Completed scan data in {path.name}")

    # Mixed counting times: cps uses the first scan's value (matches MATLAB), so
    # frames measured at other counting times are scaled incorrectly. Warn, as
    # MATLAB's parser:importXRDML:mixedCountingTimes does.
    if intensity == "cps":
        unique_ct = sorted({round(c, 12) for c in counting_times_all})
        if len(unique_ct) > 1:
            ct_str = ", ".join(f"{c:g}" for c in unique_ct)
            warnings.warn(
                f"Multi-range file has inconsistent counting times across scans "
                f"({ct_str} s). cps normalisation uses the first value "
                f"({counting_time:g} s); intensities from other ranges will be "
                f"incorrectly scaled.",
                stacklevel=2,
            )

    if _is_2d(collected, sec_name):
        assert sec_name is not None  # guaranteed by _is_2d
        return _build_2d(collected, sec_name, path, intensity, counting_time,
                         wavelength, intensity_tag)
    cloud = _classify_cloud(collected)
    if cloud is not None:
        cloud_axis, mesh_kind = cloud
        return _build_2d_cloud(collected, cloud_axis, mesh_kind, path, intensity,
                               counting_time, wavelength, intensity_tag)
    return _build_1d(collected, path, intensity, counting_time, intensity_tag)


def _is_2d(scans: list[_Scan], sec_name: str | None) -> bool:
    """True for an RSM mesh: shared 2theta range + a varying secondary motor."""
    if len(scans) <= 1 or sec_name is None:
        return False
    s0, e0 = scans[0].tt_range
    tt_same = all(
        abs(s.tt_range[0] - s0) < 1e-4 and abs(s.tt_range[1] - e0) < 1e-4 for s in scans
    )
    sec_vals = [s.sec_value for s in scans]
    if any(np.isnan(v) for v in sec_vals):
        return False
    sec_varies = (max(sec_vals) - min(sec_vals)) > 1e-6
    return tt_same and sec_varies


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


def _build_2d_cloud(
    scans: list[_Scan],
    sec_name: str,
    mesh_kind: str,
    path: Path,
    intensity: str,
    counting_time: float,
    wavelength: float,
    intensity_tag: str,
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
    return DataStruct.create(
        np.arange(values.shape[0], dtype=float),
        values,
        labels=labels,
        units=units,
        metadata=metadata,
    )


def _build_1d(
    scans: list[_Scan],
    path: Path,
    intensity: str,
    counting_time: float,
    intensity_tag: str,
) -> DataStruct:
    """Concatenate Completed scans into a single 2theta/Intensity trace (unchanged
    behaviour; golden-frozen)."""
    two_theta_parts: list[NDArray[np.float64]] = []
    counts_parts: list[NDArray[np.float64]] = []
    for s in scans:
        start, end = s.tt_range
        two_theta_parts.append(np.linspace(start, end, s.counts.size))
        counts_parts.append(s.counts)
    two_theta = np.concatenate(two_theta_parts)
    counts = np.concatenate(counts_parts)

    values, unit = _apply_intensity(counts, intensity, counting_time)
    metadata: dict[str, Any] = {
        "source": str(path),
        "parser_name": "import_xrdml",
        "x_column_name": "2-Theta",
        "x_column_unit": "deg",
        "num_points": int(two_theta.size),
        "counting_time": counting_time,
        "intensity_tag": intensity_tag,
        "is2D": False,
    }
    return DataStruct.create(
        two_theta, values, labels=["Intensity"], units=[unit], metadata=metadata
    )


def _build_2d(
    scans: list[_Scan],
    sec_name: str,
    path: Path,
    intensity: str,
    counting_time: float,
    wavelength: float,
    intensity_tag: str,
) -> DataStruct:
    """Assemble an RSM mesh and flatten to a scattered multi-column DataStruct."""
    order = sorted(range(len(scans)), key=lambda i: scans[i].sec_value)
    sec_sorted = np.asarray([scans[i].sec_value for i in order], dtype=float)
    n_pix = scans[order[0]].counts.size

    first = scans[order[0]]
    if first.tt_list is not None and first.tt_list.size == n_pix:
        two_theta_vec = first.tt_list
    else:
        two_theta_vec = np.linspace(first.tt_range[0], first.tt_range[1], n_pix)

    intensity_map = np.zeros((len(scans), n_pix), dtype=float)
    for row, i in enumerate(order):
        vals = scans[i].counts
        m = min(vals.size, n_pix)
        intensity_map[row, :m] = vals[:m]

    map_values, unit = _apply_intensity(intensity_map, intensity, counting_time)

    # Scattered flatten: row-major over (frame, pixel) -> N*M rows.
    omega_grid, tt_grid = np.meshgrid(sec_sorted, two_theta_vec, indexing="ij")
    columns = [tt_grid.ravel(), omega_grid.ravel(), map_values.ravel()]
    labels = ["2Theta", sec_name, "Intensity"]
    units = ["deg", "deg", unit]

    # Reciprocal space: only meaningful (coplanar) when the secondary axis is Omega.
    if sec_name == "Omega" and np.isfinite(wavelength) and wavelength > 0:
        qx, qz = compute_qspace(two_theta_vec[None, :], sec_sorted[:, None], wavelength)
        columns += [qx.ravel(), qz.ravel()]
        labels += ["Qx", "Qz"]
        units += ["Ang^-1", "Ang^-1"]

    values = np.column_stack(columns)
    n_frames, n_pixels = intensity_map.shape
    metadata: dict[str, Any] = {
        "source": str(path),
        "parser_name": "import_xrdml",
        "x_column_name": "2-Theta",
        "x_column_unit": "deg",
        "num_points": int(values.shape[0]),
        "counting_time": counting_time,
        "intensity_tag": intensity_tag,
        "is2D": True,
        "mesh_kind": "mesh",
        "map_shape": [int(n_frames), int(n_pixels)],
        "axis1_name": sec_name,
        "axis2_name": "2Theta",
        "wavelength_a": float(wavelength) if np.isfinite(wavelength) else None,
    }
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

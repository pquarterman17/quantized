"""Bruker multi-scan ``.brml`` -> 2-D reciprocal-space map.

A DIFFRAC.MEASUREMENT RSM stores one ``Experiment<i>/RawData<j>.xml`` per
scan line. Two layouts are read, both into the scattered multi-column
DataStruct that ``io/xrdml.py`` produces for its RSMs (``[2Theta, Omega,
Intensity]`` + ``[Qx, Qz]`` when a wavelength is known, ``metadata.is2D`` /
``map_shape`` / ``mesh_kind``), so the map viewer, cuts and RSM analysis
treat a BRML map exactly like an XRDML one:

- **PSD frames** ("PSD fixed" still scans with a 1-D detector such as a
  Mythen): each document holds ONE ``<Datum>`` whose recorded counter is the
  whole detector line (``RecordedRawDataView Start/Length``). The detector
  2theta of pixel ``i`` is ``Reference + Start + i * Increment`` from the
  TwoTheta ``ScanAxisInfo`` (motor frame), and omega is the ``Theta`` drive's
  ``Position`` for that frame. Both deliberately stay in the MOTOR frame:
  the Datum's own 2theta and the drive's ``VirtualPosition`` carry the
  alignment offsets, and mixing frames would shear the map. Verified on the
  FAIRmat RSM: the brightest pixel lands on the specular rod (Qx ~ 0) at the
  substrate's Bragg |Q| to 2e-4. Counts are multiplied by the frame's
  ``AbsorptionFactor`` (an engaged attenuator), like XRDML's attenuation
  correction. ``mesh_kind = "mesh"``.
- **Point scans**: each document is a line scan (one Datum per point, last
  column = counter, as in the 1-D parser), at a stepped omega. All scans
  must share one 2theta window and the omega must step between scans (>= 3
  scans, the XRDML cloud rule) -- otherwise the file is repeated or
  multi-range line scans, not a map, and is refused. ``mesh_kind`` is
  ``"coupled"`` when omega also moves within each scan, else ``"mesh"``.

Anything else (mixed layouts, differing detector windows, a PSD frame with
several steps) is refused with a reason: fail closed rather than guess a
geometry.

Pure layer: XML roots in -> DataStruct out. Zip handling and size limits stay
in ``io/bruker_brml.py``.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET  # noqa: S405 (types only; parsing via _safe_xml)
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.calc.qspace import compute_qspace
from quantized.datastruct import DataStruct
from quantized.io._map_schema import map_datastruct

__all__ = ["BrmlFrame", "assemble_map", "measured_route", "read_frame"]

FloatArray = NDArray[np.float64]


@dataclass(frozen=True)
class BrmlFrame:
    """One scan document: per-point 2theta, omega and intensity."""

    kind: str  # "psd" (one detector line) or "point" (a line scan)
    two_theta: FloatArray
    omega: FloatArray
    counts: FloatArray
    attenuated: bool = False
    counting_time: float = float("nan")


def measured_route(root: ET.Element) -> ET.Element | None:
    """The ``RouteFlag="Measured"`` DataRoute (else the first one)."""
    routes = root.findall(".//DataRoute")
    route = next((r for r in routes if r.get("RouteFlag") == "Measured"), None)
    return route if route is not None else (routes[0] if routes else None)


def _num(elem: ET.Element | None, default: float = float("nan")) -> float:
    if elem is None or elem.text is None or not elem.text.strip():
        return default
    try:
        return float(elem.text)
    except ValueError:
        return default


def _axis(route: ET.Element, axis_id: str) -> ET.Element | None:
    for axis in route.findall("ScanInformation/ScanAxes/ScanAxisInfo"):
        if axis.get("AxisId") == axis_id:
            return axis
    return None


def _axis_span(axis: ET.Element) -> tuple[float, float, float]:
    """``(Reference + Start, Reference + Stop, Increment)`` of a scan axis."""
    ref = _num(axis.find("Reference"), 0.0)
    start, stop = _num(axis.find("Start")), _num(axis.find("Stop"))
    return ref + start, ref + stop, _num(axis.find("Increment"))


def _drive_position(root: ET.Element, axis_id: str) -> float:
    """Motor ``Position`` of a fixed drive (NOT ``VirtualPosition``)."""
    for info in root.findall(".//Drives/InfoData"):
        if axis_id in (info.get("AxisId"), info.get("LogicName")):
            pos = info.find("Position")
            if pos is not None:
                try:
                    return float(pos.get("Value", ""))
                except ValueError:
                    return float("nan")
    return float("nan")


def _datum_rows(route: ET.Element) -> list[list[float]]:
    rows: list[list[float]] = []
    for datum in route.findall("Datum"):
        if not datum.text:
            continue
        try:
            rows.append([float(v) for v in datum.text.split(",")])
        except ValueError:
            continue
    return rows


def _view_field(route: ET.Element, logic_name: str, fields: list[float]) -> float:
    for view in route.findall("DataViews/RawDataView"):
        if view.get("LogicName") == logic_name:
            idx = int(view.get("Start", "-1"))
            return fields[idx] if 0 <= idx < len(fields) else float("nan")
    return float("nan")


def _detector_view(route: ET.Element) -> tuple[int, int] | None:
    """``(Start, Length)`` of a recorded counter spanning more than one field."""
    for view in route.findall("DataViews/RawDataView"):
        if view.find("Recording") is None:
            continue
        start, length = int(view.get("Start", "0")), int(view.get("Length", "1"))
        if length > 1:
            return start, length
    return None


def read_frame(root: ET.Element, name: str) -> BrmlFrame:
    """Extract one scan document's points (see the module docstring)."""
    route = measured_route(root)
    if route is None:
        raise ValueError(f"no DataRoute in scan document: {name}")
    tt_axis = _axis(route, "TwoTheta")
    if tt_axis is None:
        raise ValueError(f"no TwoTheta scan axis in scan document: {name}")
    rows = _datum_rows(route)
    if not rows:
        raise ValueError(f"scan document has no data points: {name}")
    detector = _detector_view(route)
    if detector is not None:
        return _psd_frame(root, route, tt_axis, rows, detector, name)
    return _point_frame(root, route, tt_axis, rows, name)


def _psd_frame(
    root: ET.Element,
    route: ET.Element,
    tt_axis: ET.Element,
    rows: list[list[float]],
    detector: tuple[int, int],
    name: str,
) -> BrmlFrame:
    if len(rows) != 1:
        raise ValueError(f"detector scan with {len(rows)} steps per frame is not supported: {name}")
    fields = rows[0]
    start, length = detector
    if start + length > len(fields):
        raise ValueError(f"detector counter overruns its Datum ({start}+{length}): {name}")
    counts = np.asarray(fields[start : start + length], dtype=float)
    absorption = _view_field(route, "AbsorptionFactor", fields)
    attenuated = bool(np.isfinite(absorption) and absorption > 0 and absorption != 1.0)
    if attenuated:
        counts = np.asarray(counts * absorption, dtype=float)
    lo, hi, inc = _axis_span(tt_axis)
    if not np.isfinite(inc) or inc == 0:
        inc = (hi - lo) / length
    if not np.isfinite(lo) or not np.isfinite(inc):
        raise ValueError(f"detector 2Theta window is undefined: {name}")
    omega = _drive_position(root, "Theta")
    if not np.isfinite(omega):
        raise ValueError(f"no omega (Theta drive) position in scan document: {name}")
    return BrmlFrame(
        kind="psd",
        two_theta=np.asarray(lo + inc * np.arange(length), dtype=float),
        omega=np.full(length, omega),
        counts=counts,
        attenuated=attenuated,
        counting_time=_view_field(route, "MeasuredTime", fields),
    )


def _match_column(cols: FloatArray, lo: float, hi: float) -> FloatArray | None:
    """The Datum column whose first/last values match ``lo``/``hi``."""
    if cols.size == 0 or not (np.isfinite(lo) and np.isfinite(hi)):
        return None
    errs = np.abs(cols[0, :] - lo) + np.abs(cols[-1, :] - hi)
    best = int(np.argmin(errs))
    if errs[best] <= max(1e-6, 0.01 * abs(hi - lo)):
        return np.asarray(cols[:, best], dtype=float)
    return None


def _point_frame(
    root: ET.Element, route: ET.Element, tt_axis: ET.Element, rows: list[list[float]], name: str
) -> BrmlFrame:
    n_cols = min(len(r) for r in rows)
    data = np.array([r[:n_cols] for r in rows], dtype=float)
    axis_cols = data[:, :-1]
    n = data.shape[0]
    lo, hi, _ = _axis_span(tt_axis)
    two_theta = _match_column(axis_cols, lo, hi)
    if two_theta is None:
        if not (np.isfinite(lo) and np.isfinite(hi)):
            raise ValueError(f"2Theta of the line scan is undefined: {name}")
        two_theta = np.asarray(np.linspace(lo, hi, n), dtype=float)
    om_axis = _axis(route, "Theta")
    omega: FloatArray | None = None
    if om_axis is not None:
        om_lo, om_hi, _ = _axis_span(om_axis)
        omega = _match_column(axis_cols, om_lo, om_hi)
        if omega is None and np.isfinite(om_lo) and np.isfinite(om_hi):
            omega = np.asarray(np.linspace(om_lo, om_hi, n), dtype=float)
    if omega is None:
        fixed = _drive_position(root, "Theta")
        if not np.isfinite(fixed):
            raise ValueError(f"no omega for the line scan: {name}")
        omega = np.full(n, fixed)
    return BrmlFrame(kind="point", two_theta=two_theta, omega=omega, counts=data[:, -1].copy())


def _not_a_map(n: int, path: Path, why: str) -> ValueError:
    return ValueError(
        f"multi-scan .brml detected ({n} scans) but {why} -- "
        f"not a reciprocal-space map: {path.name}"
    )


def _mesh_kind(frames: list[BrmlFrame], path: Path) -> str:
    """Validate the frame set as one map and name its layout."""
    n = len(frames)
    kinds = {f.kind for f in frames}
    if len(kinds) != 1:
        raise _not_a_map(n, path, "it mixes detector frames and line scans")
    sizes = {f.counts.size for f in frames}
    tt0 = frames[0].two_theta
    if frames[0].kind == "psd":
        if len(sizes) != 1 or not all(np.allclose(f.two_theta, tt0, atol=1e-6) for f in frames):
            raise _not_a_map(n, path, "the detector 2Theta window differs between frames")
    else:
        same_window = len(sizes) == 1 and all(
            abs(f.two_theta[0] - tt0[0]) < 1e-4 and abs(f.two_theta[-1] - tt0[-1]) < 1e-4
            for f in frames
        )
        if n < 3 or not same_window:
            raise _not_a_map(n, path, "its line scans do not share one 2Theta window")
    mids = [float(np.mean(f.omega)) for f in frames]
    if max(mids) - min(mids) <= 1e-6:
        raise _not_a_map(n, path, "omega does not step between scans")
    sweeps = any(float(np.ptp(f.omega)) > 1e-6 for f in frames)
    return "coupled" if sweeps else "mesh"


def assemble_map(frames: list[BrmlFrame], *, path: Path, meta: dict[str, Any]) -> DataStruct:
    """Stack validated frames (sorted by omega) into the XRDML map schema.

    ``meta`` carries instrument fields (``io/bruker_brml._tube_meta``); its
    ``alpha1`` wavelength enables the Qx/Qz columns.
    """
    mesh_kind = _mesh_kind(frames, path)
    order = sorted(range(len(frames)), key=lambda i: float(np.mean(frames[i].omega)))
    ordered = [frames[i] for i in order]
    tt = np.concatenate([f.two_theta for f in ordered])
    om = np.concatenate([f.omega for f in ordered])
    intensity = np.concatenate([f.counts for f in ordered])
    columns = [tt, om, intensity]
    labels = ["2Theta", "Omega", "Intensity"]
    units = ["deg", "deg", "counts"]
    wavelength = float(meta.get("alpha1", float("nan")))
    if np.isfinite(wavelength) and wavelength > 0:
        qx, qz = compute_qspace(tt, om, wavelength)
        columns += [qx, qz]
        labels += ["Qx", "Qz"]
        units += ["Ang^-1", "Ang^-1"]
    values = np.column_stack(columns)
    times = {round(f.counting_time, 9) for f in ordered if np.isfinite(f.counting_time)}
    metadata: dict[str, Any] = {
        "source": str(path),
        "parser_name": "import_bruker_brml",
        "x_column_name": "2-Theta",
        "x_column_unit": "deg",
        "num_points": int(values.shape[0]),
        "is2D": True,
        "mesh_kind": mesh_kind,
        "map_shape": [len(ordered), int(ordered[0].counts.size)],
        "axis1_name": "Omega",
        "axis2_name": "2Theta",
        "wavelength_a": wavelength if np.isfinite(wavelength) and wavelength > 0 else None,
        "n_scans": len(ordered),
        "n_scans_att_corrected": sum(f.attenuated for f in ordered),
        "counting_time": times.pop() if len(times) == 1 else None,
        **meta,
    }
    return map_datastruct(values, labels, units, metadata, x_channel="2Theta")

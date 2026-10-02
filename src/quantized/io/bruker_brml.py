"""Bruker ``.brml`` XRD parser (DIFFRAC.EVA / DIFFRAC.MEASUREMENT).

A ``.brml`` is a ZIP archive of XML documents. The scan lives in
``Experiment<i>/RawData<j>.xml``; a 1-D line scan has exactly one such file,
while a reciprocal-space map (RSM) has one per scan line (hundreds).

RawData structure (namespaces declared for ``xsi:type`` only; elements are
un-prefixed, so ElementTree tags are plain)::

    <RawData>
      <DataRoutes><DataRoute RouteFlag="Measured">
        <ScanInformation>
          <MeasurementPoints>2001</MeasurementPoints>
          <ScanAxes>
            <ScanAxisInfo AxisId="TwoTheta" Unit="deg">
              <Start>44</Start><Stop>48</Stop><Increment>0.002</Increment>
        <Datum>plannedTime,measuredTime,TwoTheta,Theta,...,Counts</Datum>
        ...

Each ``<Datum>`` is a comma-separated row; the *first* scan axis (2theta) is
the abscissa and the *last* field is the recorded counter (intensity). This
parser handles the 1-D case (item #42); an RSM raises a clear error pointing
at the map path rather than silently returning one line.

Sample files ``FAIRmat_2thomega.brml`` / ``FAIRmat_RSM.brml`` (Apache-2.0,
FAIRmat pynxtools-xrd corpus) seed the parity tests.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET  # noqa: S405 (types only; parsing via _safe_xml)
import zipfile
from pathlib import Path
from typing import Any

import numpy as np

from quantized.datastruct import DataStruct
from quantized.io._safe_xml import parse_untrusted_xml
from quantized.io.base import CORRUPT_ARCHIVE_ERRORS

__all__ = ["import_bruker_brml", "is_bruker_brml"]

_UNIT_MAP = {"°": "deg", "deg": "deg", "Degree": "deg", "": ""}

# Hostile-input bound (security audit 2026-10-01): the scan XML is read whole,
# and deflate packs ~1000:1, so a 1.5 MB .brml can expand to gigabytes. A real
# 1-D RawData document is a few MB. zipfile never returns more than the
# member's declared size, so checking that size bounds the read.
MAX_XML_BYTES = 256 << 20


def _raw_data_members(names: list[str]) -> list[str]:
    """ZIP members matching ``Experiment*/RawData*.xml`` (the scan documents)."""
    out = []
    for n in names:
        parts = n.replace("\\", "/").split("/")
        if len(parts) >= 2 and parts[-1].startswith("RawData") and parts[-1].endswith(".xml"):
            out.append(n)
    return out


def is_bruker_brml(path: Path) -> bool:
    """Sniff a file as a Bruker ``.brml`` (a ZIP with a RawData scan document)."""
    p = Path(path)
    if not zipfile.is_zipfile(p):
        return False
    with zipfile.ZipFile(p) as zf:
        names = zf.namelist()
    return any(n.endswith("experimentCollection.xml") for n in names) or bool(
        _raw_data_members(names)
    )


def _first(elem: ET.Element | None, tag: str) -> ET.Element | None:
    return None if elem is None else elem.find(tag)


def _axis_range(axis: ET.Element) -> tuple[float, float]:
    start = _first(axis, "Start")
    stop = _first(axis, "Stop")
    lo = float(start.text) if start is not None and start.text else float("nan")
    hi = float(stop.text) if stop is not None and stop.text else float("nan")
    return lo, hi


def import_bruker_brml(filepath: str | Path) -> DataStruct:
    """Import a 1-D Bruker ``.brml`` line scan (2theta vs intensity).

    Returns
    -------
    DataStruct
        ``time`` = the primary scan axis (typically 2theta, deg), one
        ``Intensity`` channel (counts).

    Raises
    ------
    ValueError
        If the archive is not a ``.brml``, holds no scan, or is a multi-scan
        RSM (which this 1-D parser does not stitch).
    """
    path = Path(filepath)
    if not zipfile.is_zipfile(path):
        raise ValueError(f"not a ZIP archive (expected a .brml): {path.name}")

    try:
        with zipfile.ZipFile(path) as zf:
            members = _raw_data_members(zf.namelist())
            if not members:
                raise ValueError(f"no RawData scan document in archive: {path.name}")
            if len(members) > 1:
                raise ValueError(
                    f"multi-scan .brml detected ({len(members)} scans) -- reciprocal-space "
                    f"maps are not supported by the 1-D parser: {path.name}"
                )
            size = zf.getinfo(members[0]).file_size
            if size > MAX_XML_BYTES:
                raise ValueError(
                    f"scan document is {size} bytes uncompressed "
                    f"(limit {MAX_XML_BYTES}): {path.name}"
                )
            xml_text = zf.read(members[0]).decode("utf-8", "replace")
        root = parse_untrusted_xml(xml_text, path.name, kind="BRML")  # refuses DTDs
    except CORRUPT_ARCHIVE_ERRORS as exc:
        raise ValueError(f"damaged .brml archive ({exc}): {path.name}") from exc

    routes = root.findall(".//DataRoute")
    route = next((r for r in routes if r.get("RouteFlag") == "Measured"), None)
    route = route if route is not None else (routes[0] if routes else None)
    if route is None:
        raise ValueError(f"no DataRoute in scan document: {path.name}")

    scan_info = _first(route, "ScanInformation")
    axes = scan_info.findall(".//ScanAxisInfo") if scan_info is not None else []
    if not axes:
        raise ValueError(f"no scan axis in scan document: {path.name}")
    primary = axes[0]
    axis_name = primary.get("VisibleName") or primary.get("AxisName") or "2-Theta"
    axis_unit = _UNIT_MAP.get(primary.get("Unit", ""), primary.get("Unit", "") or "")
    x_lo, x_hi = _axis_range(primary)

    rows: list[list[float]] = []
    for datum in route.findall(".//Datum"):
        if not datum.text:
            continue
        try:
            rows.append([float(v) for v in datum.text.split(",")])
        except ValueError:
            continue
    if not rows:
        raise ValueError(f"scan document has no data points: {path.name}")

    n_cols = min(len(r) for r in rows)
    data = np.array([r[:n_cols] for r in rows], dtype=float)

    # The last column is the recorded counter (intensity). The abscissa is the
    # column matching the primary axis Start->Stop range; fall back to
    # reconstructing it from Start + i*Increment if no column matches.
    intensity = data[:, -1]
    x = _resolve_abscissa(data[:, :-1], x_lo, x_hi, primary, len(rows))

    metadata: dict[str, Any] = {
        "source": str(path),
        "parser_name": "import_bruker_brml",
        "x_column_name": axis_name,
        "x_column_unit": axis_unit,
        "num_points": len(rows),
        "start_angle": x_lo,
        "end_angle": x_hi,
        "scan_axes": [a.get("VisibleName") or a.get("AxisName") for a in axes],
    }
    return DataStruct.create(
        x, intensity, labels=["Intensity"], units=["counts"], metadata=metadata
    )


def _resolve_abscissa(
    axis_cols: np.ndarray, x_lo: float, x_hi: float, primary: ET.Element, n: int
) -> np.ndarray:
    """Pick the Datum column that spans the primary axis range, else rebuild it."""
    if axis_cols.size and np.isfinite(x_lo) and np.isfinite(x_hi):
        # score each candidate column by how well its ends match Start/Stop
        errs = np.abs(axis_cols[0, :] - x_lo) + np.abs(axis_cols[-1, :] - x_hi)
        best = int(np.argmin(errs))
        span = abs(x_hi - x_lo)
        if errs[best] <= max(1e-6, 0.01 * span):
            return np.asarray(axis_cols[:, best], dtype=float)
    inc = _first(primary, "Increment")
    if np.isfinite(x_lo) and inc is not None and inc.text:
        return np.asarray(x_lo + np.arange(n) * float(inc.text), dtype=float)
    if np.isfinite(x_lo) and np.isfinite(x_hi) and n > 1:
        return np.asarray(np.linspace(x_lo, x_hi, n), dtype=float)
    return np.asarray(axis_cols[:, 0] if axis_cols.size else np.arange(n), dtype=float)

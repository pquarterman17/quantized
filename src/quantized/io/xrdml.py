"""PANalytical XRDML parser (1D scans). Port of MATLAB parser.importXRDML.

x = 2theta reconstructed by linspace(start, end, N); intensity = counts,
optionally divided by commonCountingTime to cps (the default). Multi-scan
files concatenate Completed scans in appendNumber order.

2D area-detector (RSM) extraction is deferred to the W1 2D extension.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.datastruct import DataStruct

__all__ = ["import_xrdml"]


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


def import_xrdml(filepath: str | Path, *, intensity: str = "cps") -> DataStruct:
    """Import a 1D PANalytical ``.xrdml`` scan. Default intensity unit = cps."""
    if intensity not in ("cps", "counts"):
        raise ValueError(f'intensity must be "cps" or "counts", got "{intensity}"')
    path = Path(filepath)
    root = ET.fromstring(path.read_text(encoding="latin-1"))

    scans = _find_all(root, "scan")
    if not scans:
        raise ValueError(f"no <scan> element in {path.name}")
    scans.sort(key=lambda s: int(s.get("appendNumber", "1")))

    two_theta_parts: list[NDArray[np.float64]] = []
    counts_parts: list[NDArray[np.float64]] = []
    counting_time = float("nan")
    intensity_tag = "counts"

    for scan in scans:
        status = scan.get("status")
        if status is not None and status.lower() != "completed":
            continue
        dp = _find_first(scan, "dataPoints")
        if dp is None:
            continue

        ct = _text_float(_find_first(dp, "commonCountingTime"))
        if np.isnan(counting_time) and not np.isnan(ct):
            counting_time = ct

        counts_elem = _find_first(dp, "counts")
        if counts_elem is None:
            counts_elem = _find_first(dp, "intensities")
            intensity_tag = "intensities"
        if counts_elem is None or counts_elem.text is None:
            continue
        counts = np.asarray([float(x) for x in counts_elem.text.split()], dtype=float)

        start, end = _two_theta_range(dp)
        two_theta_parts.append(np.linspace(start, end, counts.size))
        counts_parts.append(counts)

    if not counts_parts:
        raise ValueError(f"no Completed scan data in {path.name}")

    two_theta = np.concatenate(two_theta_parts)
    counts = np.concatenate(counts_parts)

    if intensity == "cps" and not np.isnan(counting_time) and counting_time > 0:
        values = counts / counting_time
        unit = "cps"
    else:
        values = counts
        unit = "counts"

    metadata: dict[str, Any] = {
        "source": str(path),
        "parser_name": "import_xrdml",
        "x_column_name": "2-Theta",
        "x_column_unit": "deg",
        "num_points": int(two_theta.size),
        "counting_time": counting_time,
        "intensity_tag": intensity_tag,
    }
    return DataStruct.create(
        two_theta, values, labels=["Intensity"], units=[unit], metadata=metadata
    )


def _two_theta_range(dp: ET.Element) -> tuple[float, float]:
    for pos in _find_all(dp, "positions"):
        if pos.get("axis") == "2Theta":
            start = _text_float(_find_first(pos, "startPosition"))
            end = _text_float(_find_first(pos, "endPosition"))
            return start, end
    raise ValueError("no 2Theta positions (startPosition/endPosition) in scan")

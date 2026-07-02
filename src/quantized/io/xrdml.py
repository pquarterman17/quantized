"""PANalytical XRDML parser. Port of MATLAB parser.importXRDML.

**1D scans** (the common case): x = 2theta reconstructed by
``linspace(start, end, N)``; intensity = counts, optionally divided by
``commonCountingTime`` to cps (the default). Multi-scan files concatenate
Completed scans in appendNumber order. Returns ``[Intensity]`` vs 2theta.

**2D area-detector (RSM)**: a reciprocal-space-map mesh — many Completed scans
that share the same 2theta range while a secondary motor (Omega / Chi / Phi)
steps between them. Detected automatically; returned as a *scattered* multi-
column DataStruct so the 2-D map viewer (``calc/map``) can render it: columns
``[2Theta, <axis1>, Intensity]`` plus ``[Qx, Qz]`` reciprocal-space coordinates
when the secondary axis is Omega and a wavelength is present
(``calc.qspace.compute_qspace``). ``metadata.is2D`` / ``map_shape`` record the
``(N_frames, M_pixels)`` grid so a consumer can reshape without re-interpolating.
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

    __slots__ = ("tt_range", "tt_list", "counts", "sec_value")

    def __init__(
        self,
        tt_range: tuple[float, float],
        tt_list: NDArray[np.float64] | None,
        counts: NDArray[np.float64],
        sec_value: float,
    ) -> None:
        self.tt_range = tt_range
        self.tt_list = tt_list
        self.counts = counts
        self.sec_value = sec_value


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

        # Secondary axis: discover (first scan) which of Omega/Chi/Phi is held
        # fixed within the scan (range start == end), then read it on every scan.
        if sec_name is None:
            for axis in _SECONDARY_AXES:
                rng, _ = _axis_positions(dp, axis)
                if rng is not None and rng[0] == rng[1]:
                    sec_name = axis
                    break
        sec_value = float("nan")
        if sec_name is not None:
            rng, _ = _axis_positions(dp, sec_name)
            if rng is not None and rng[0] == rng[1]:
                sec_value = rng[0]

        collected.append(_Scan(tt_range, tt_list, counts, sec_value))

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

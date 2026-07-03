"""JCAMP-DX spectroscopy parser (``.jdx`` / ``.dx``).

JCAMP-DX (Joint Committee on Atomic and Molecular Physical Data — Data
eXchange) is the manufacturer-independent text format for IR, Raman, UV-Vis,
NMR and mass spectra. A file is a list of ``##LABEL= value`` records; the
ordinate data follows an ``##XYDATA= (X++(Y..Y))`` (equally-spaced, ASDF-
compressed) or ``##XYPOINTS=``/``##PEAK TABLE= (XY..XY)`` (explicit pairs)
record.

This parser reads the first spectral block of a file (compound ``LINK`` files
note the extra blocks in metadata) and returns a single-channel DataStruct.
The ASDF ordinate decoding (SQZ/DIF/DUP) lives in :mod:`_jcamp_asdf`.

Correctness is self-checking: the decoded ordinate count must equal
``##NPOINTS`` and the first ordinate must equal ``##FIRSTY`` (JCAMP's built-in
integrity checks), plus DIF lines carry per-line Y-value checks.

Sample corpus: ``nzhagen/jcamp`` (MIT) IR spectra + the R. J. Lancashire
compression-form test suite.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np

from quantized.datastruct import DataStruct
from quantized.io._jcamp_asdf import decode_xydata

__all__ = ["import_jcamp", "is_jcamp"]

_DATA_LABELS = {"XYDATA", "XYPOINTS", "PEAKTABLE"}


def _norm_label(label: str) -> str:
    """JCAMP label equivalence: case- and separator-insensitive."""
    return label.upper().replace(" ", "").replace("-", "").replace("_", "").replace("/", "")


def _strip_comment(line: str) -> str:
    i = line.find("$$")
    return line[:i] if i >= 0 else line


def is_jcamp(path: Path) -> bool:
    """Sniff a file as JCAMP-DX: the first data record must be ``##TITLE=``."""
    try:
        with Path(path).open("r", encoding="latin-1") as fh:
            for _ in range(20):
                line = fh.readline()
                if not line:
                    break
                s = line.strip()
                if s.startswith("##"):
                    return _norm_label(s[2:].split("=", 1)[0]) == "TITLE"
    except OSError:
        return False
    return False


def _parse_records(text: str) -> tuple[dict[str, str], list[str], str, int]:
    """Split into (header LDRs, data lines, data-kind, extra block count).

    Reads the *first* data block; counts how many additional ``##TITLE`` blocks
    follow (compound/LINK files).
    """
    header: dict[str, str] = {}
    data_lines: list[str] = []
    data_kind = ""
    in_data = False
    title_count = 0

    for raw_line in text.splitlines():
        line = _strip_comment(raw_line)
        stripped = line.strip()
        if stripped.startswith("##"):
            in_data = False
            label, _, value = stripped[2:].partition("=")
            nlabel = _norm_label(label)
            if nlabel == "TITLE":
                title_count += 1
                if title_count > 1:
                    continue  # a later block; header already captured
            if nlabel in _DATA_LABELS and not data_kind:
                data_kind = nlabel
                in_data = True
            elif nlabel == "END":
                in_data = False
            else:
                header.setdefault(nlabel, value.strip())
        elif in_data and stripped:
            data_lines.append(stripped)

    return header, data_lines, data_kind, max(0, title_count - 1)


def _num(header: dict[str, str], key: str, default: float) -> float:
    try:
        return float(header[key])
    except (KeyError, ValueError):
        return default


def _decode_pairs(data_lines: list[str], xfactor: float, yfactor: float) -> tuple[
    np.ndarray, np.ndarray
]:
    """Decode ``(XY..XY)`` explicit pairs (XYPOINTS / PEAK TABLE)."""
    nums: list[float] = []
    for line in data_lines:
        for tok in line.replace(";", " ").replace(",", " ").split():
            try:
                nums.append(float(tok))
            except ValueError:
                continue
    if len(nums) % 2:
        nums = nums[:-1]
    arr = np.asarray(nums, dtype=float).reshape(-1, 2)
    return arr[:, 0] * xfactor, arr[:, 1] * yfactor


def import_jcamp(filepath: str | Path) -> DataStruct:
    """Import a JCAMP-DX ``.jdx``/``.dx`` spectrum (one channel).

    Returns
    -------
    DataStruct
        ``time`` = abscissa (wavenumber / wavelength / m/z, per ``##XUNITS``),
        one ordinate channel (``##YUNITS``).
    """
    path = Path(filepath)
    text = path.read_text(encoding="latin-1")
    header, data_lines, data_kind, extra_blocks = _parse_records(text)
    if not data_kind or not data_lines:
        raise ValueError(f"no XYDATA/XYPOINTS/PEAK TABLE block found: {path.name}")

    xfactor = _num(header, "XFACTOR", 1.0)
    yfactor = _num(header, "YFACTOR", 1.0)

    if data_kind == "XYDATA":
        raw_y = np.asarray(decode_xydata(data_lines), dtype=float)
        y = raw_y * yfactor
        npoints = int(_num(header, "NPOINTS", len(y)))
        if len(y) != npoints:
            raise ValueError(
                f"decoded {len(y)} ordinates but ##NPOINTS={npoints}: {path.name}"
            )
        firstx = _num(header, "FIRSTX", 0.0)
        lastx = _num(header, "LASTX", float(len(y) - 1))
        x = np.linspace(firstx, lastx, len(y)) if len(y) > 1 else np.asarray([firstx])
        firsty = _num(header, "FIRSTY", y[0] if len(y) else 0.0)
        # FIRSTY is an optional integrity check; 0 is a common "not set"
        # placeholder, so only enforce it when a real value is given.
        if len(y) and firsty != 0.0 and abs(y[0] - firsty) > 1e-3 * (abs(firsty) + 1.0):
            raise ValueError(
                f"first ordinate {y[0]:.6g} != ##FIRSTY={firsty:.6g}: {path.name}"
            )
    else:  # XYPOINTS / PEAK TABLE
        x, y = _decode_pairs(data_lines, xfactor, yfactor)
        if not len(x):
            raise ValueError(f"no data points in {data_kind} block: {path.name}")

    xunits = header.get("XUNITS", "")
    yunits = header.get("YUNITS", "") or "Intensity"
    metadata: dict[str, Any] = {
        "source": str(path),
        "parser_name": "import_jcamp",
        "title": header.get("TITLE", path.stem),
        "data_type": header.get("DATATYPE", ""),
        "jcamp_version": header.get("JCAMPDX", ""),
        "data_form": data_kind,
        "x_column_name": header.get("DATATYPE", "") or "X",
        "x_column_unit": xunits,
        "num_points": int(len(y)),
    }
    if extra_blocks:
        metadata["extra_blocks"] = extra_blocks  # compound/LINK file
    return DataStruct.create(x, y, labels=[yunits.title()], units=[""], metadata=metadata)

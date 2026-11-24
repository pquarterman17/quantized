"""Default output format per input type for the quick converter.

**Provisional, owner to confirm** (the owner asked for "a default output format
per input type"; this table is a proposal, every entry overridable):

=========================================  ======  ============================
input                                      format  why
=========================================  ======  ============================
1-D XRD scan (``xrd.powder``)              xy      the lingua franca of XRD tools
any 2-D map / RSM (``is2D``)               h5      keeps the 2-D shape (NeXus)
magnetometry / transport (``.dat`` ...)    csv     columns + units, opens anywhere
Origin project (``.opj`` / ``.opju``)      xlsx    one workbook per book, sheets
reflectometry, SIMS, spectroscopy, other   csv     a plain table
=========================================  ======  ============================

A multi-dataset input whose default is flat (csv / xy) is suggested as ``xlsx``
instead, so it stays one file (owner policy: containers hold many datasets, flat
formats take one file each) -- also provisional. Pure ``io``.
"""

from __future__ import annotations

from quantized.io import technique as tq
from quantized.io.convert_plan import CONTAINER_FORMATS

__all__ = ["DEFAULT_FORMAT_BY_TECHNIQUE", "PROVISIONAL", "default_format"]

PROVISIONAL = "provisional, owner to confirm"

#: Technique (``io/technique.py``) -> default output format. Provisional.
DEFAULT_FORMAT_BY_TECHNIQUE: dict[str, str] = {
    tq.XRD_POWDER: "xy",
    tq.XRD_RSM: "h5",
    tq.MAGNETOMETRY_MVSH: "csv",
    tq.MAGNETOMETRY_MVST: "csv",
    tq.TRANSPORT: "csv",
    tq.REFLECTOMETRY: "csv",
    tq.SIMS: "csv",
    tq.SPECTROSCOPY: "csv",
    tq.GENERIC: "csv",
}


def default_format(
    technique: str, n_datasets: int, *, origin: bool = False, has_map: bool = False
) -> str:
    """The suggested format for an input (table in the module doc)."""
    if origin:
        return "xlsx"
    if has_map:  # any 2-D map, whatever its technique tag: keep the 2-D shape
        return "h5"
    fmt = DEFAULT_FORMAT_BY_TECHNIQUE.get(technique, "csv")
    if n_datasets > 1 and fmt not in CONTAINER_FORMATS:
        return "xlsx"
    return fmt

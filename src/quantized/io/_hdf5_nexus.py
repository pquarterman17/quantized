"""NeXus ``NXdata`` groups and generic HDF5 groups as DataStruct books.

**NXdata** (the NeXus plottable-data group): the group's ``@signal`` names the
data dataset and ``@axes`` the coordinate dataset for each of its dimensions
(``"."`` = none, the point index). A 1-D signal becomes a table against its axis
(plus its ``errors`` and ``@auxiliary_signals`` columns when they have the
signal's length); a 2-D signal becomes a map over its two axes. Anything that
would need a guess is refused with a reason, never improvised: no ``@signal``,
an axis that is missing, not 1-D, or the wrong length (bin EDGES, ``n + 1``
values, are not silently turned into centres), or a signal of 3+ dimensions
(which slice is a choice).

**Generic groups** (no NeXus structure): each group's equal-length 1-D numeric
datasets form one book of columns against the row index, and each 2-D dataset
is a book of its columns (a 2-D dataset wider than ``MAX_COLUMNS`` is a matrix or
image, so it becomes a map over its row/column indices). No column is guessed to
be an x axis, and nothing is paired with anything: the user picks the axes
afterwards.

Pure layer.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.datastruct import DataStruct
from quantized.io._array_books import (
    MAX_COLUMNS,
    MAX_MAP_POINTS,
    grid_map_datastruct,
    index_map_datastruct,
    table_datastruct,
)
from quantized.io._hdf5_walk import (
    Budget,
    attr_str,
    attr_str_list,
    is_numeric_dataset,
    read_numeric,
    resolve_child,
)

__all__ = ["generic_books", "nxdata_book"]


def _units(dset: Any) -> str:
    return attr_str(dset, "units")


def _numeric_child(h5py: Any, group: Any, name: str, budget: Budget) -> Any | None:
    child = resolve_child(h5py, group, name, follow_soft=True, budget=budget)
    return child if child is not None and is_numeric_dataset(h5py, child) else None


def _signal_name(h5py: Any, group: Any, budget: Budget) -> tuple[str, bool]:
    """``(name, legacy)``: ``@signal`` (NeXus 3), else the dataset carrying the
    legacy ``signal=1`` attribute (``legacy`` True)."""
    name = attr_str(group, "signal")
    if name:
        return name, False
    for child_name in group:
        child = resolve_child(h5py, group, child_name, follow_soft=True, budget=budget)
        if is_numeric_dataset(h5py, child) and "signal" in child.attrs:
            try:
                if int(np.asarray(child.attrs["signal"]).reshape(-1)[0]) == 1:
                    return str(child_name), True
            except (TypeError, ValueError):
                continue
    return "", False


def _legacy_axes(
    h5py: Any, group: Any, signal: Any, sig_name: str, budget: Budget, where: str
) -> list[str]:
    """Axis names of a legacy NeXus signal: its own ``axes="a:b"`` attribute, else
    the group's datasets carrying ``axis=k`` (1-based; ``primary=1`` preferred).
    Axes the file names only in part are refused; a file that names none at all
    uses the point index, and says so."""
    text = attr_str(signal, "axes")
    if text:
        names = [n.strip() or "." for n in re.split(r"[:,]", text)]
        return names
    found: dict[int, list[tuple[bool, str]]] = {}
    for child_name in group:
        child = resolve_child(h5py, group, child_name, follow_soft=True, budget=budget)
        if not is_numeric_dataset(h5py, child) or "axis" not in child.attrs:
            continue
        try:
            k = int(np.asarray(child.attrs["axis"]).reshape(-1)[0])
            primary = int(np.asarray(child.attrs.get("primary", 0)).reshape(-1)[0]) == 1
        except (TypeError, ValueError):
            continue
        found.setdefault(k, []).append((primary, str(child_name)))
    if not found:
        budget.notes.append(
            f"{where}: legacy signal={sig_name!r} lists no axes; the point index is used."
        )
        return ["."] * signal.ndim
    names = []
    for k in range(1, signal.ndim + 1):
        options = sorted(found.get(k, []), key=lambda t: not t[0])
        if len(options) > 1 and options[0][0] == options[1][0]:
            raise ValueError(f"{where}: dimension {k} has several candidate axes; not guessed")
        names.append(options[0][1] if options else ".")
    if "." in names:
        raise ValueError(
            f"{where}: legacy axes are named for only some dimensions; not guessed"
        )
    return names


def _axis(
    h5py: Any, group: Any, name: str | None, n: int, budget: Budget, where: str
) -> tuple[NDArray[np.float64] | None, str, str]:
    """``(coordinates, name, units)`` of one axis; ``None`` coordinates = index."""
    if not name or name == ".":
        return None, "", ""
    dset = _numeric_child(h5py, group, name, budget)
    if dset is None:
        raise ValueError(f"{where}: axis {name!r} is not a numeric dataset of the group")
    if dset.ndim != 1:
        raise ValueError(f"{where}: axis {name!r} is {dset.ndim}-D; only 1-D axes are read")
    if dset.size == n + 1:
        raise ValueError(
            f"{where}: axis {name!r} has {dset.size} values for {n} points "
            "(bin edges); not guessed as centres"
        )
    if dset.size != n:
        raise ValueError(f"{where}: axis {name!r} has {dset.size} values for {n} points")
    return read_numeric(name, dset, budget), name, _units(dset)


def nxdata_book(h5py: Any, group: Any, path: str, budget: Budget) -> DataStruct:
    """One ``NXdata`` group as a table (1-D signal) or map (2-D signal)."""
    where = f"NXdata {path}"
    sig_name, legacy = _signal_name(h5py, group, budget)
    if not sig_name:
        raise ValueError(f"{where}: no @signal attribute, so no data to import")
    signal = _numeric_child(h5py, group, sig_name, budget)
    if signal is None:
        raise ValueError(f"{where}: signal {sig_name!r} is not a numeric dataset")
    if signal.ndim not in (1, 2):
        raise ValueError(
            f"{where}: signal {sig_name!r} is {signal.ndim}-D; only 1-D and 2-D are imported "
            "(which slice to take is a choice)"
        )
    axes = attr_str_list(group, "axes")
    if not axes and legacy:
        axes = _legacy_axes(h5py, group, signal, sig_name, budget, where)
    if not axes:
        axes = ["."] * signal.ndim
    if len(axes) != signal.ndim:
        raise ValueError(
            f"{where}: @axes lists {len(axes)} axes for a {signal.ndim}-D signal; not guessed"
        )
    meta: dict[str, Any] = {
        "parser_name": "import_hdf5",
        "nexus": True,
        "nexus_signal": sig_name,
        "nexus_axes": axes,
        "hdf5_path": path,
        "sheet_name": path,
    }
    title = attr_str(group, "title")
    if title:
        meta["title"] = title
    if signal.ndim == 2 and signal.size > MAX_MAP_POINTS:  # before it is read
        raise ValueError(
            f"{where}: {signal.shape[1]} x {signal.shape[0]} grid is over the "
            f"{MAX_MAP_POINTS:,}-point limit"
        )
    values = read_numeric(sig_name, signal, budget)
    if signal.ndim == 1:
        return _nxdata_table(h5py, group, sig_name, signal, values, axes[0], budget, where, meta)
    ny, nx = values.shape
    ax_y, y_name, y_unit = _axis(h5py, group, axes[0], ny, budget, where)
    ax_x, x_name, x_unit = _axis(h5py, group, axes[1], nx, budget, where)
    return grid_map_datastruct(
        values,
        np.arange(nx, dtype=float) if ax_x is None else ax_x,
        np.arange(ny, dtype=float) if ax_y is None else ax_y,
        x_label=x_name or "column",
        x_unit=x_unit,
        y_label=y_name or "row",
        y_unit=y_unit,
        z_unit=_units(signal),
        metadata={**meta, "source_signal": sig_name},
    )


def _nxdata_table(
    h5py: Any,
    group: Any,
    sig_name: str,
    signal: Any,
    values: NDArray[np.float64],
    axis_name: str,
    budget: Budget,
    where: str,
    meta: dict[str, Any],
) -> DataStruct:
    n = int(values.size)
    x, x_name, x_unit = _axis(h5py, group, axis_name, n, budget, where)
    columns: list[tuple[str, NDArray[np.float64], str]] = [(sig_name, values, _units(signal))]
    err_name = attr_str(group, "errors") or (
        f"{sig_name}_errors" if f"{sig_name}_errors" in group else ""
    )
    extras = [err_name, *attr_str_list(group, "auxiliary_signals")]
    for name in dict.fromkeys(e for e in extras if e and e != sig_name):
        dset = _numeric_child(h5py, group, name, budget)
        if dset is None or dset.ndim != 1 or dset.size != n:
            budget.notes.append(
                f"{where}: {name!r} is not a 1-D column of the signal's length; skipped."
            )
            continue
        columns.append((name, read_numeric(name, dset, budget), _units(dset)))
    return table_datastruct(
        columns, x=x, x_name=x_name or "index", x_unit=x_unit, metadata=meta
    )


def _group_dataset_names(h5py: Any, group: Any, budget: Budget) -> list[tuple[str, Any]]:
    out: list[tuple[str, Any]] = []
    for name in group:
        child = resolve_child(h5py, group, name, follow_soft=False, budget=budget)
        if is_numeric_dataset(h5py, child) and child.size >= 2:
            out.append((str(name), child))
    return out


def _read_or_note(full: str, dset: Any, budget: Budget) -> NDArray[np.float64] | None:
    """``read_numeric``, or ``None`` with the refusal recorded as a note: one
    oversized, external or over-budget dataset must not cost the file its good
    ones."""
    try:
        return read_numeric(full, dset, budget)
    except ValueError as exc:
        budget.notes.append(f"{exc}.")
        return None


def generic_books(h5py: Any, group: Any, path: str, budget: Budget) -> list[DataStruct]:
    """Books of one non-NeXus group's direct numeric datasets (see module doc)."""
    by_length: dict[int, list[tuple[str, Any]]] = {}
    books: list[DataStruct] = []
    base: Mapping[str, Any] = {"parser_name": "import_hdf5", "nexus": False}
    for name, dset in _group_dataset_names(h5py, group, budget):
        full = f"{path.rstrip('/')}/{name}"
        if dset.ndim == 1:
            by_length.setdefault(int(dset.size), []).append((name, dset))
        elif dset.ndim == 2:
            books.extend(_matrix_book(dset, name, full, budget, base))
        else:
            budget.notes.append(
                f"{full} is {dset.ndim}-D; only 1-D and 2-D datasets are imported."
            )
    for n, members in by_length.items():
        suffix = f" (n={n})" if len(by_length) > 1 else ""
        cols: list[tuple[str, NDArray[np.float64], str]] = []
        for nm, d in members:
            arr = _read_or_note(f"{path.rstrip('/')}/{nm}", d, budget)
            if arr is not None:
                cols.append((nm, arr, _units(d)))
        if cols:
            meta = {**base, "hdf5_path": path, "sheet_name": f"{path}{suffix}"}
            books.append(table_datastruct(cols, metadata=meta))
    return books


def _matrix_book(
    dset: Any, name: str, full: str, budget: Budget, base: Mapping[str, Any]
) -> list[DataStruct]:
    rows, cols = dset.shape
    meta = {**base, "hdf5_path": full, "sheet_name": full}
    if cols > MAX_COLUMNS:  # a matrix or image, not a table: a map over its indices
        if rows * cols > MAX_MAP_POINTS:  # refused from the shape, before any read
            budget.notes.append(
                f"{full} ({rows} x {cols}): over the {MAX_MAP_POINTS:,}-point map limit; not read."
            )
            return []
        arr = _read_or_note(full, dset, budget)
        return [] if arr is None else [index_map_datastruct(arr, metadata=meta)]
    arr = _read_or_note(full, dset, budget)
    if arr is None:
        return []
    unit = _units(dset)
    columns = [(f"{name}[{j}]", arr[:, j], unit) for j in range(cols)]
    return [table_datastruct(columns, metadata=meta)]

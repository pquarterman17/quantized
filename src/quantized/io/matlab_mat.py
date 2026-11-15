"""MATLAB ``.mat`` import: v5/v6/v7 via ``scipy.io``, v7.3 (HDF5) via ``h5py``.

Numeric arrays and structs of arrays become columns, names kept:

* a top-level numeric vector is a column named after its variable; a 2-D array
  gives one column per MATLAB column (``name_1``, ``name_2``, ...);
* each top-level struct is its own book; nested struct fields are flattened
  with dots (``fit.params.a``);
* the columns of one book that share a length form one table against the row
  index (``0, 1, 2, ...``). **No column is guessed to be the x axis** and no
  two variables are paired: pick the axes afterwards. A book whose columns
  differ in length is split by length (``workspace (n=100)``, ``(n=250)``);
* a 2-D array wider than ``MAX_COLUMNS`` is a matrix/image, not a table: it
  becomes a 2-D map over its row and column indices;
* a scalar becomes ``metadata.mat_scalars`` (``name -> value``) on the first book.

Not imported, and NAMED in the first book's ``metadata.notes``: strings,
cells, struct arrays, sparse matrices, MATLAB objects (tables, datetimes,
...), complex arrays (they have no single real value per cell), arrays of
three or more dimensions.

**Limits.** v5 variables are sized from the file's own header (``whosmat``)
before they are loaded; v7.3 datasets pass the HDF5 reader's checks
(``io/_hdf5_walk.py``). Elements read in total, books and columns are capped.

Pure layer; ``scipy.io`` / ``h5py`` are imported lazily.
"""

from __future__ import annotations

import dataclasses
import struct
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.datastruct import DataStruct
from quantized.heavy_import import heavy_imports
from quantized.io._array_books import (
    MAX_BOOKS,
    MAX_COLUMNS,
    index_map_datastruct,
    table_datastruct,
)
from quantized.io._hdf5_walk import (
    MAX_DEPTH,
    MAX_NODES,
    Budget,
    h5py_module,
    is_hdf5,
    open_hdf5,
    read_numeric,
    resolve_child,
)
from quantized.io._mat5_bounded import bounded_mat5, is_mat5
from quantized.io.netcdf import MAX_DATASET_ELEMENTS

__all__ = ["import_mat", "read_mat_books"]

_NUMERIC_CLASSES = frozenset(
    {"double", "single", "logical", "int8", "uint8", "int16", "uint16",
     "int32", "uint32", "int64", "uint64"}
)
_MAX_SCALARS = 64
_MAX_NOTES = 20

# A node of the variable tree: an ndarray (numeric), a dict (struct), or None.
_Tree = dict[str, Any]


def _normalize(value: Any) -> NDArray[Any] | None:
    """A numeric array with MATLAB's singleton dimensions squeezed (a row or
    column vector -> 1-D, a 1 x 1 array -> 0-d); ``None`` for anything else."""
    if isinstance(value, np.ndarray) or np.isscalar(value):
        arr = np.asarray(value)
        if arr.dtype.kind in "fiub":
            if arr.ndim == 2 and arr.size == 1:
                arr = arr.reshape(())
            elif arr.ndim == 2 and 1 in arr.shape:
                arr = arr.reshape(-1)
            return arr
    return None


def _why_not(value: Any) -> str:
    if isinstance(value, str):
        return "a string"
    if isinstance(value, np.ndarray):
        kind = value.dtype.kind
        if kind == "c":
            return "complex (no single real value per cell)"
        if kind == "O":
            return "a cell or struct array"
        if kind in "US":
            return "text"
    return "not a numeric array or struct of arrays"


def _convert(value: Any) -> Any:
    """A loaded v5 variable as an ndarray / dict / other (not importable).
    ``squeeze_me=False`` keeps MATLAB's own shape, so a 1 x 2 x 300 array stays
    3-D (refused) exactly as in v7.3; a 1 x 1 struct becomes a dict."""
    if hasattr(value, "_fieldnames"):
        return {str(f): _convert(getattr(value, f)) for f in value._fieldnames}  # noqa: SLF001
    if isinstance(value, np.ndarray) and value.dtype.kind == "O" and value.size == 1:
        only = value.reshape(-1)[0]
        if hasattr(only, "_fieldnames"):
            return _convert(only)
    return value


def _load_v5(path: Path, budget: Budget) -> tuple[_Tree, list[str]]:
    with heavy_imports("scipy.io"):
        from scipy.io import loadmat, whosmat  # noqa: PLC0415

    with path.open("rb") as fh:
        head = fh.read(16)
    notes: list[str] = []
    try:
        # Version 5: compressed elements are inflated under a cap first
        # (io/_mat5_bounded.py); version 4 has no compression to bound.
        source: Any = path
        if is_mat5(head):
            source, notes = bounded_mat5(path, budget)
        listing = whosmat(source)
        wanted: list[str] = []
        for name, shape, klass in listing:
            if klass in _NUMERIC_CLASSES:
                size = int(np.prod(shape, dtype=np.int64))
                if size > MAX_DATASET_ELEMENTS:
                    notes.append(f"{name!r} declares {size:,} elements; not read.")
                    continue
            elif klass != "struct":
                notes.append(f"{name!r} is not imported: MATLAB class {klass!r}.")
                continue
            wanted.append(name)
        if hasattr(source, "seek"):
            source.seek(0)
        raw = (
            loadmat(source, variable_names=wanted, squeeze_me=False, struct_as_record=False)
            if wanted
            else {}
        )
    except (ValueError, NotImplementedError, OSError, TypeError, KeyError, struct.error) as exc:
        raise ValueError(f"not a readable MATLAB MAT-file ({exc}): {path.name}") from exc
    tree: _Tree = {n: _convert(raw[n]) for n in wanted if n in raw}
    return tree, notes


class _V73Walker:
    """Reads a v7.3 tree with a visited set, a depth limit and a node budget:
    a struct that links to itself (or to an ancestor), or a diamond of links
    that fans out exponentially, is noted and skipped, never walked."""

    def __init__(self, h5py: Any, budget: Budget) -> None:
        self.h5py, self.budget = h5py, budget
        self.seen: set[Any] = set()
        self.nodes = 0

    def node(self, obj: Any, name: str, depth: int) -> Any:
        h5py, budget = self.h5py, self.budget
        self.nodes += 1
        if self.nodes > MAX_NODES:
            if self.nodes == MAX_NODES + 1:
                budget.notes.append(f"Only the first {MAX_NODES:,} HDF5 objects were scanned.")
            return None
        klass = obj.attrs.get("MATLAB_class", b"")
        klass = klass.decode() if isinstance(klass, bytes) else str(klass)
        if isinstance(obj, h5py.Dataset):
            if obj.attrs.get("MATLAB_empty") is not None or klass not in _NUMERIC_CLASSES:
                return None
            if obj.dtype.kind not in "fiu":  # complex is a compound (real, imag) type
                return None
            try:  # HDF5 reverses MATLAB's dimensions
                return read_numeric(name, obj, budget).T
            except ValueError as exc:
                budget.notes.append(f"{exc}.")
                return None
        if klass != "struct" or "MATLAB_sparse" in obj.attrs:
            return None
        if obj.id in self.seen:
            budget.notes.append(f"{name!r} links back to a struct already read; skipped.")
            return None
        if depth >= MAX_DEPTH:
            budget.notes.append(f"{name!r} is nested more than {MAX_DEPTH} levels deep; skipped.")
            return None
        self.seen.add(obj.id)
        out: _Tree = {}
        for key in obj:
            child = resolve_child(h5py, obj, key, follow_soft=False, budget=budget)
            if child is not None:
                out[str(key)] = self.node(child, f"{name}.{key}", depth + 1)
        return out


def _load_v73(path: Path, budget: Budget) -> tuple[_Tree, list[str]]:
    f = open_hdf5(path)
    try:
        budget.bind(f)
        h5py = h5py_module()
        walker = _V73Walker(h5py, budget)
        tree: _Tree = {}
        for key in f:
            if str(key).startswith("#"):  # #refs# / #subsystem#
                continue
            child = resolve_child(h5py, f, key, follow_soft=False, budget=budget)
            if child is not None:
                tree[str(key)] = walker.node(child, str(key), 0)
    finally:
        f.close()
    return tree, budget.notes


class _Collector:
    def __init__(self) -> None:
        self.scalars: dict[str, float] = {}
        self.notes: list[str] = []

    def note(self, text: str) -> None:
        if len(self.notes) < _MAX_NOTES:
            self.notes.append(text)
        elif len(self.notes) == _MAX_NOTES:
            self.notes.append("... and more variables not imported.")

    def columns(
        self, name: str, qual: str, value: Any, out: list[tuple[str, NDArray[Any]]]
    ) -> list[Any]:
        """Add ``value``'s columns (labelled ``name``) to ``out``; scalars and
        notes use the full path ``qual``. Returns 2-D arrays too wide for a table."""
        wide: list[Any] = []
        if isinstance(value, dict):
            if not value:
                self.note(f"{qual!r} is an empty struct.")
            for key, sub in value.items():
                wide += self.columns(f"{name}.{key}", f"{qual}.{key}", sub, out)
            return wide
        arr = _normalize(value)
        if arr is None:
            self.note(f"{qual!r} is not imported: {_why_not(value)}.")
            return wide
        if arr.size == 0:
            self.note(f"{qual!r} is empty.")
        elif arr.ndim == 0:
            if len(self.scalars) < _MAX_SCALARS:
                self.scalars[qual] = float(arr)
        elif arr.ndim == 1:
            out.append((name, np.asarray(arr, dtype=float)))
        elif arr.ndim == 2 and arr.shape[1] <= MAX_COLUMNS:
            for j in range(arr.shape[1]):
                out.append((f"{name}_{j + 1}", np.asarray(arr[:, j], dtype=float)))
        elif arr.ndim == 2:
            wide.append((qual, arr))
        else:
            self.note(f"{qual!r} is {arr.ndim}-D; only 1-D and 2-D arrays are imported.")
        return wide


def _books(tree: _Tree, path: Path, notes: list[str]) -> list[DataStruct]:
    col = _Collector()
    col.notes.extend(notes)
    containers: list[tuple[str, list[tuple[str, NDArray[Any]]]]] = []
    top: list[tuple[str, NDArray[Any]]] = []
    wides: list[tuple[str, Any]] = []
    for name, value in tree.items():
        if isinstance(value, dict):
            members: list[tuple[str, NDArray[Any]]] = []
            for key, sub in value.items():
                wides += col.columns(key, f"{name}.{key}", sub, members)
            if not value:
                col.note(f"{name!r} is an empty struct.")
            containers.append((name, members))
        else:
            wides += col.columns(name, name, value, top)
    containers.insert(0, ("workspace", top))
    base = {"source": str(path), "parser_name": "import_mat"}
    books: list[DataStruct] = []
    for cname, cols in containers:
        by_len: dict[int, list[tuple[str, NDArray[Any]]]] = {}
        for label, arr in cols:
            by_len.setdefault(int(arr.shape[0]), []).append((label, arr))
        for n, members in by_len.items():
            sheet = cname if len(by_len) == 1 else f"{cname} (n={n})"
            books.append(
                table_datastruct(
                    [(lab, a, "") for lab, a in members],
                    metadata={**base, "sheet_name": sheet, "mat_container": cname},
                )
            )
    for name, arr in wides:
        try:
            books.append(index_map_datastruct(arr, metadata={**base, "sheet_name": name}))
        except ValueError as exc:
            col.note(f"{name!r}: {exc}.")
    if not books:
        why = " ".join(col.notes) or "it holds no numeric arrays"
        raise ValueError(f"nothing to import from {path.name}: {why}")
    if len(books) > MAX_BOOKS:
        col.note(f"Only the first {MAX_BOOKS} of {len(books)} datasets were imported.")
        books = books[:MAX_BOOKS]
    extra: dict[str, Any] = {}
    if col.scalars:
        extra["mat_scalars"] = col.scalars
    if col.notes:
        extra["notes"] = col.notes
    if extra:
        books[0] = dataclasses.replace(books[0], metadata={**books[0].metadata, **extra})
    return books


def read_mat_books(filepath: str | Path) -> list[DataStruct]:
    """Every importable book of the ``.mat`` file (see module doc)."""
    path = Path(filepath)
    budget = Budget()
    tree, notes = _load_v73(path, budget) if is_hdf5(path) else _load_v5(path, budget)
    return _books(tree, path, notes)


def import_mat(filepath: str | Path) -> DataStruct:
    """Import a MATLAB ``.mat``: the first book (``read_mat_books`` has them all)."""
    return read_mat_books(filepath)[0]

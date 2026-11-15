"""Bounded, fail-closed HDF5 reading primitives shared by the HDF5/NeXus and
MATLAB v7.3 importers (``hdf5_read``, ``_hdf5_nexus``, ``matlab_mat``).

An HDF5 file is untrusted input: a ~1 KB file can declare billions of
elements, point a dataset at another file on disk (external / virtual
storage), or link a group to its own ancestor. So every dataset passes
:func:`read_numeric` (which applies ``io.netcdf``'s per-dataset checks and a
whole-file element budget), and the tree is walked by :func:`walk_groups`,
which follows HARD links only, once per object, to a bounded depth and node
count. Soft links are resolved only where a caller asks (NXdata children,
which NeXus files routinely soft-link to the detector data); external links
are never followed.

Pure layer. ``h5py`` is imported lazily through ``heavy_imports``.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray

from quantized.heavy_import import heavy_imports
from quantized.io.netcdf import MAX_DATASET_ELEMENTS, _check_dataset

__all__ = [
    "MAX_NODES",
    "MAX_TOTAL_ELEMENTS",
    "Budget",
    "attr_str",
    "attr_str_list",
    "h5py_module",
    "is_hdf5",
    "is_numeric_dataset",
    "open_hdf5",
    "read_numeric",
    "resolve_child",
    "walk_groups",
]

MAX_NODES = 20_000
MAX_DEPTH = 32
#: Elements read from one file in total (float64: 512 MiB), however many datasets.
MAX_TOTAL_ELEMENTS = MAX_DATASET_ELEMENTS

_SIGNATURE = b"\x89HDF\r\n\x1a\n"


@dataclass
class Budget:
    """Elements still readable from this file, and what was left out and why."""

    elements: int = MAX_TOTAL_ELEMENTS
    notes: list[str] = field(default_factory=list)

    def take(self, name: str, n: int) -> None:
        if n > self.elements:
            raise ValueError(
                f"{name!r} would exceed this file's read budget ({MAX_TOTAL_ELEMENTS:,} elements)"
            )
        self.elements -= n


def h5py_module() -> Any:
    try:
        with heavy_imports("h5py"):
            import h5py  # noqa: PLC0415
    except ImportError as exc:  # pragma: no cover - h5py is a hard dependency
        raise ImportError("h5py is required to read HDF5 files (uv add h5py)") from exc
    return h5py


def is_hdf5(path: Path) -> bool:
    """True when the HDF5 signature sits at offset 0 or a power-of-two user
    block (MATLAB v7.3 ``.mat`` files carry a 512-byte one)."""
    with Path(path).open("rb") as fh:
        head = fh.read(len(_SIGNATURE))
        if head == _SIGNATURE:
            return True
        offset = 512
        while offset <= 1 << 16:
            fh.seek(offset)
            if fh.read(len(_SIGNATURE)) == _SIGNATURE:
                return True
            offset *= 2
    return False


def open_hdf5(path: Path) -> Any:
    """An open ``h5py.File`` (caller closes it); a clear error for a non-HDF5 file."""
    if not is_hdf5(path):
        raise ValueError(f"not an HDF5 file (no HDF5 signature): {path.name}")
    h5py = h5py_module()
    try:
        return h5py.File(path, "r")
    except OSError as exc:
        raise ValueError(f"not a readable HDF5 file ({exc}): {path.name}") from exc


def attr_str(obj: Any, name: str) -> str:
    """A string attribute (bytes, numpy bytes/str, or a 1-element array), else ``""``."""
    if name not in obj.attrs:
        return ""
    value = obj.attrs[name]
    if isinstance(value, np.ndarray):
        if value.size != 1:
            return ""
        value = value.reshape(-1)[0]
    if isinstance(value, (bytes, np.bytes_)):
        return bytes(value).decode("utf-8", "replace").strip()
    return str(value).strip()


def attr_str_list(obj: Any, name: str) -> list[str]:
    """A string-array attribute as a list (a lone string is a one-item list)."""
    if name not in obj.attrs:
        return []
    value = obj.attrs[name]
    items = np.asarray(value).reshape(-1) if not isinstance(value, (str, bytes)) else [value]
    return [
        bytes(v).decode("utf-8", "replace").strip() if isinstance(v, (bytes, np.bytes_)) else str(v)
        for v in items
    ]


def is_numeric_dataset(h5py: Any, obj: Any) -> bool:
    return bool(isinstance(obj, h5py.Dataset) and obj.dtype.kind in "fiu")


def read_numeric(name: str, dset: Any, budget: Budget) -> NDArray[np.float64]:
    """The dataset as float64, after the hostile-input checks and the budget."""
    _check_dataset(name, dset)
    budget.take(name, int(dset.size))
    return np.asarray(dset[()], dtype=np.float64)


def resolve_child(h5py: Any, group: Any, name: str, *, follow_soft: bool) -> Any:
    """``group[name]`` for a hard link (and a soft one when asked); ``None`` for
    a missing child, an external link, or a soft link that does not resolve."""
    link = group.get(name, getlink=True)
    if isinstance(link, h5py.HardLink) or (follow_soft and isinstance(link, h5py.SoftLink)):
        try:
            return group[name]
        except KeyError:
            return None
    return None


def walk_groups(h5py: Any, root: Any, budget: Budget) -> Iterator[tuple[str, Any]]:
    """Every group reachable by hard links from ``root`` (itself first), once
    each, depth-first in file order, within ``MAX_DEPTH`` / ``MAX_NODES``."""
    seen: set[Any] = {root.id}
    stack: list[tuple[str, Any, int]] = [("/", root, 0)]
    nodes = 0
    while stack:
        path, group, depth = stack.pop()
        yield path, group
        children: list[tuple[str, Any]] = []
        for name in group:
            nodes += 1
            if nodes > MAX_NODES:
                budget.notes.append(f"Only the first {MAX_NODES:,} HDF5 objects were scanned.")
                return
            child = resolve_child(h5py, group, name, follow_soft=False)
            if isinstance(child, h5py.Group) and child.id not in seen and depth < MAX_DEPTH:
                seen.add(child.id)
                children.append((f"{path.rstrip('/')}/{name}", child))
        stack.extend((p, g, depth + 1) for p, g in reversed(children))

"""Formats, naming and the shared write engine of the quick converter.

Owner policies (2026-11-24, ``quick_converter_frozen.md``):

* **Multi-dataset inputs.** Containers (``xlsx``, ``h5``/``nxs``, ``mat``,
  ``json``, ``npz``, ``sqlite``, ``xml``, ``nc``) -> ONE file with a sheet / group / struct /
  table per dataset;
  flat formats (``csv``, ``xy``) -> one file per dataset.
* **Metadata.** A ``#``-comment header in ``csv`` / ``xy``; native attributes
  or fields in the container formats (``h5`` ... ``nc``); a ``metadata`` sheet in
  Excel.
* **2-D maps** (``metadata.is2D``) to flat formats: a lossless long table, one
  row per point, every coordinate and signal a column (2theta, omega, I, Qx,
  Qz); containers keep the 2-D shape (:mod:`quantized.io.convert_containers`).

:func:`plan_outputs` is the ONE place output file names are made, so the
conversion and the guess (:mod:`quantized.io.convert_guess`) cannot disagree.
:func:`write_group` writes one input's datasets in a format, never
overwriting, each file through :func:`~quantized.io.write_guard.atomic_write`
(temp file, then rename: a failure leaves no partial output). Pure ``io``.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any

from quantized.datastruct import DataStruct
from quantized.io.write_guard import WriteRefused, atomic_write

__all__ = [
    "ALL_FORMATS",
    "CONTAINER_FORMATS",
    "FLAT_FORMATS",
    "FORMAT_SUFFIX",
    "plan_outputs",
    "safe_name",
    "unique_name",
    "unique_prefixes",
    "write_group",
]

FLAT_FORMATS = ("csv", "xy")
CONTAINER_FORMATS = ("xlsx", "h5", "nxs", "mat", "json", "npz", "sqlite", "xml", "nc")
ALL_FORMATS = (
    "csv", "xlsx", "xy", "h5", "nxs", "mat", "json", "npz", "sqlite", "xml", "nc",
)
FORMAT_SUFFIX = {f: f".{f}" for f in ALL_FORMATS}
XLSX_TAB_MAX = 31

_UNSAFE = re.compile(r"[^\w.\- ]+")


def safe_name(text: str) -> str:
    """``text`` as one filename component: anything but word characters,
    ``.``, ``-`` and spaces becomes ``_``; never empty."""
    cleaned = _UNSAFE.sub("_", text).strip(" .")
    return cleaned or "_"


def unique_name(name: str, taken: set[str], limit: int | None = None) -> str:
    """``name`` (cut to ``limit``), with ``~2``, ``~3`` ... until not in ``taken``
    (case-insensitive); the result is added to ``taken``."""
    base = name[:limit] if limit else name
    out, k = base, 2
    while out.lower() in taken:
        suffix = f"~{k}"
        out, k = (base[: limit - len(suffix)] if limit else base) + suffix, k + 1
    taken.add(out.lower())
    return out


def unique_prefixes(paths: Sequence[Path]) -> list[str]:
    """Output prefix per input: its file name (``run1.opj``), with ``~2``,
    ``~3`` ... for a later input whose name repeats one already used (the same
    file name in two folders), so no output overwrites another."""
    taken: set[str] = set()
    return [unique_name(safe_name(p.name), taken) for p in paths]


def plan_outputs(stem: str, fmt: str, labels: Sequence[str]) -> list[tuple[str, list[int]]]:
    """``[(file name, [dataset indices])]`` for datasets named ``labels``.

    Container -> one ``<stem>.<fmt>`` holding all; flat -> ``<stem>.<fmt>`` for
    a single dataset, else ``<stem>__<label>.<fmt>`` each (unique, so no file
    overwrites another of the same run)."""
    if fmt not in ALL_FORMATS:
        raise ValueError(f"unknown format {fmt!r}; choose one of {', '.join(ALL_FORMATS)}")
    suffix = FORMAT_SUFFIX[fmt]
    if fmt in CONTAINER_FORMATS:
        return [(f"{stem}{suffix}", list(range(len(labels))))]
    if len(labels) == 1:
        return [(f"{stem}{suffix}", [0])]
    taken: set[str] = set()
    return [
        (f"{unique_name(f'{stem}__{safe_name(lab)}', taken)}{suffix}", [i])
        for i, lab in enumerate(labels)
    ]


Producer = Callable[[Path, list[tuple[str, DataStruct]]], object]


def write_group(
    items: Sequence[tuple[str, DataStruct, dict[str, Any]]],
    out_dir: Path,
    stem: str,
    fmt: str,
    report: dict[str, Any],
    guard: dict[str, Any],
    producer: Producer,
    *,
    names: Sequence[str] | None = None,
) -> None:
    """Write ``items`` (``(label, DataStruct, book report entry)``) as
    :func:`plan_outputs` lays them out, ``producer(temp_path, [(label, ds)])``
    making each file's content. A refused target (exists / is an input) marks
    its books ``skipped``; any other failure of one file is that file's books
    ``skipped`` with the plain reason, and the rest are still written."""
    labels = list(names) if names is not None else [label for label, _, _ in items]
    for file_name, idx in plan_outputs(stem, fmt, labels):
        chosen = [items[i] for i in idx]
        target = out_dir / file_name
        pairs = [(n, d) for n, d, _ in chosen]

        def produce(tmp: Path, pairs: list[tuple[str, DataStruct]] = pairs) -> object:
            return producer(tmp, pairs)

        try:
            atomic_write(target, produce, **guard)
        except WriteRefused as exc:
            _skip(chosen, str(exc))
            continue
        except Exception as exc:  # noqa: BLE001 - one bad file must not stop the rest
            _skip(chosen, f"could not write {file_name}: {type(exc).__name__}: {exc}")
            continue
        for _, _, entry in chosen:
            entry["output"] = file_name
        report["outputs"].append(file_name)


def _skip(chosen: Sequence[tuple[str, DataStruct, dict[str, Any]]], why: str) -> None:
    for _, _, entry in chosen:
        entry["status"] = "skipped"
        entry["problems"].append(why)

"""What the quick converter guesses about its inputs (all of it overridable).

:func:`guess_inputs` looks at each file and says, without writing anything:

* its **type** -- the registry's own answer (extension, then the content
  sniffers: which ``.raw`` flavour, which ``.dat`` instrument), as
  ``kind`` (the parser's name) and a plain ``kind_label``; the measurement
  ``technique`` the parser stamped (``io/technique.py``);
* its **datasets** -- name, row count and the output column names + units, as
  the writers will make them (X column from ``x_column_long`` /
  ``x_column_name``, units from the channel units and ``x_unit_of``);
* a **suggested output format** from the table below (``format_source`` says
  whether it was guessed or forced);
* **suggested output names** -- the input's file name (``run1.opj``) plus the
  dataset / sheet / scan suffix of ``io/convert_plan.plan_outputs``, unique
  across the inputs and, when ``out_dir`` is given, never an existing file
  (``~2``, ``~3`` ... is appended until it is free).

Default output format per input type (provisional, owner to confirm): the table in
:mod:`quantized.io.convert_defaults`. Pure ``io``.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from quantized.datastruct import DataStruct
from quantized.heavy_import import heavy_imports
from quantized.io import technique as tq
from quantized.io.convert_data import dataset_label
from quantized.io.convert_defaults import (
    DEFAULT_FORMAT_BY_TECHNIQUE,
    PROVISIONAL,
    default_format,
)
from quantized.io.convert_flat import long_table_sheet
from quantized.io.convert_maps import is_map
from quantized.io.convert_plan import (
    ALL_FORMATS,
    XLSX_TAB_MAX,
    plan_outputs,
    safe_name,
    unique_name,
    unique_prefixes,
)
from quantized.io.origin_convert import ORIGIN_SUFFIXES, book_label, planned_outputs
from quantized.io.registry import import_auto_sheets, resolve_parser

__all__ = [
    "DEFAULT_FORMAT_BY_TECHNIQUE",
    "PROVISIONAL",
    "DatasetGuess",
    "InputGuess",
    "default_format",
    "guess_inputs",
]

_KIND_LABELS = (
    ("xrdml", "PANalytical / Malvern XRDML"),
    ("rigaku", "Rigaku SmartLab .raw"),
    ("bruker_raw", "Bruker Diffrac .raw"),
    ("brml", "Bruker .brml"),
    ("qd", "Quantum Design magnetometry .dat"),
    ("ppms", "Quantum Design PPMS .dat"),
    ("lake", "Lake Shore VSM"),
    ("hdf5", "HDF5 / NeXus"),
    ("mat", "MATLAB .mat"),
    ("excel", "Excel workbook"),
    ("xls", "Excel workbook"),
    ("csv", "delimited text table"),
)


@dataclass(frozen=True)
class DatasetGuess:
    """One dataset of an input and the columns its output will have."""

    name: str
    rows: int
    columns: tuple[tuple[str, str], ...]  # (name, unit)
    is_map: bool = False


@dataclass(frozen=True)
class InputGuess:
    """The guesses for one input file (see the module doc)."""

    path: str
    kind: str = ""
    kind_label: str = ""
    technique: str = ""
    datasets: tuple[DatasetGuess, ...] = ()
    format: str = ""
    format_source: str = ""  # "default (provisional, owner to confirm)" | "requested"
    outputs: tuple[str, ...] = ()
    error: str | None = None
    notes: tuple[str, ...] = field(default_factory=tuple)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _kind_label(parser_name: str) -> str:
    low = parser_name.lower()
    for key, label in _KIND_LABELS:
        if key in low:
            return label
    return parser_name.removeprefix("import_").removeprefix("_import_").replace("_", " ")


def _dataset_guess(ds: DataStruct, index: int, name: str | None = None) -> DatasetGuess:
    sheet = long_table_sheet(ds, "x")
    cols = tuple((c.name, c.unit) for c in sheet.columns)
    return DatasetGuess(
        name=name or dataset_label(ds, index), rows=ds.n_points, columns=cols, is_map=is_map(ds)
    )


def _free(out_dir: Path, stem: str, fmt: str, labels: Sequence[str]) -> str:
    """``stem``, bumped (``~2`` ...) until none of its output files exists in
    ``out_dir`` (the guess never suggests a name that would be refused)."""
    k, candidate = 2, stem
    while any((out_dir / n).exists() for n, _ in plan_outputs(candidate, fmt, labels)):
        candidate, k = f"{stem}~{k}", k + 1
    return candidate


def _guess_one(
    path: Path, prefix: str, out_dir: Path | None, fmt: str | None, deep: bool
) -> InputGuess:
    if not path.is_file():
        return InputGuess(path=str(path), error="file not found")
    if path.suffix.lower() in ORIGIN_SUFFIXES:
        return _guess_origin(path, prefix, out_dir, fmt, deep)
    try:
        parser = resolve_parser(path)
    except Exception as exc:  # noqa: BLE001 - a guess never raises
        return InputGuess(path=str(path), error=str(exc))
    kind, label = parser.__name__, _kind_label(parser.__name__)
    if not deep:
        chosen = fmt or "csv"
        return InputGuess(
            path=str(path),
            kind=kind,
            kind_label=label,
            format=chosen,
            format_source="requested" if fmt else f"default ({PROVISIONAL})",
        )
    try:
        books = import_auto_sheets(path)
    except Exception as exc:  # noqa: BLE001
        return InputGuess(
            path=str(path), kind=kind, kind_label=label, error=f"{type(exc).__name__}: {exc}"
        )
    technique = str(books[0].metadata.get("technique") or tq.GENERIC)
    chosen = fmt or default_format(technique, len(books), has_map=any(is_map(ds) for ds in books))
    seen: set[str] = {"metadata"} if chosen == "xlsx" else set()
    names = [
        unique_name(
            safe_name(dataset_label(ds, i)), seen, XLSX_TAB_MAX if chosen == "xlsx" else None
        )
        for i, ds in enumerate(books)
    ]
    stem = _free(out_dir, prefix, chosen, names) if out_dir else prefix
    outs = tuple(n for n, _ in plan_outputs(stem, chosen, names))
    return InputGuess(
        path=str(path),
        kind=kind,
        kind_label=label,
        technique=technique,
        datasets=tuple(_dataset_guess(ds, i) for i, ds in enumerate(books)),
        format=chosen,
        format_source="requested" if fmt else f"default ({PROVISIONAL})",
        outputs=outs,
    )


def _guess_origin(
    path: Path, prefix: str, out_dir: Path | None, fmt: str | None, deep: bool
) -> InputGuess:
    chosen = fmt or "xlsx"
    source = "requested" if fmt else f"default ({PROVISIONAL})"
    base = InputGuess(
        path=str(path), kind="origin_project", kind_label="Origin project",
        technique=tq.GENERIC, format=chosen, format_source=source,
    )  # fmt: skip
    if not deep:
        return base
    with heavy_imports("quantized.io.origin_project", "quantized.io.origin_project.opju_memo"):
        from quantized.io.origin_project import read_origin_project_all
        from quantized.io.origin_project.opju_memo import import_scope

    try:
        with import_scope():
            primary, books = read_origin_project_all(path)
    except Exception as exc:  # noqa: BLE001
        return InputGuess(
            **{**asdict(base), "datasets": (), "error": f"{type(exc).__name__}: {exc}"}
        )
    books = books or [primary]
    stem = prefix
    outs = planned_outputs(books, stem, chosen)
    if out_dir:
        k = 2
        while any((out_dir / n).exists() for n in outs):
            stem, k = f"{prefix}~{k}", k + 1
            outs = planned_outputs(books, stem, chosen)
    note = "output names assume every book is written; books with a loss are skipped (fail closed)"
    return InputGuess(
        **{
            **asdict(base),
            "datasets": tuple(
                _dataset_guess(ds, i, book_label(ds, i)) for i, ds in enumerate(books)
            ),
            "outputs": tuple(outs),
            "notes": (note,),
        }
    )


def guess_inputs(
    paths: Sequence[Path | str],
    *,
    out_dir: Path | None = None,
    fmt: str | None = None,
    deep: bool = True,
) -> list[InputGuess]:
    """One :class:`InputGuess` per path, in order; never raises (an input that
    cannot be read has ``error``). ``fmt`` forces the output format (names are
    then planned for it), else the default table applies. ``out_dir`` makes the
    suggested names avoid existing files; ``deep=False`` only detects the type
    (no parsing)."""
    if fmt is not None and fmt not in ALL_FORMATS and fmt != "dwk":
        raise ValueError(f"unknown format {fmt!r}; choose one of {', '.join(ALL_FORMATS)}")
    files = [Path(p) for p in paths]
    prefixes = unique_prefixes(files)
    return [_guess_one(p, pre, out_dir, fmt, deep) for p, pre in zip(files, prefixes, strict=True)]

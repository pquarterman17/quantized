"""``qz run`` -- re-run an analysis template saved in the app on new files.

    qz run "Peak fit.json" scans/*.csv --out results/
    qz run recipe.json run1.dat run2.dat --out out/ --format xlsx --figures pdf
    qz run subtract.json sample.csv --background empty_cell.csv --out out/

The template is the JSON the Pipeline panel / Recipe Library exports
(``frontend/src/lib/template.ts``). Each input is loaded with the import
registry (as ``quantized.api.load``), the steps are replayed headless
(:mod:`quantized.recipe_run`: the same ``quantized.api`` calls the app's
exported pipeline script makes) and the result is written to ``--out``:

* the processed data, one ``<input stem> - <recipe name>.csv`` (or ``.xlsx``)
  per input -- or, with ``--format dwk``, ONE ``<recipe name>.dwk`` project
  holding every processed dataset (and the summary sheet), to open in the app;
* the summary sheet the template declares (its ``outputs``: the last fit's
  parameters and R2, one row per input, as the app's template batch builds
  it), ``<recipe name> summary.csv``, when the recipe has outputs;
* with ``--figures pdf|svg|png``, a publication figure per input (X against
  every channel), rendered by the server's own exporter;
* ``run-report.json``: every input's status, step log and warnings.

A background subtraction reads its background from ``--background FILE``,
given once per background-subtraction step, in step order, read as loaded.

Fail closed: a recipe with a step that cannot replay headless (a formula
outside the supported subset, a two-input transform, a weighted fit, a missing
or extra ``--background``, ...) is
refused before any file is read, with every such step named; a step that fails
on one input fails that input (reported, nothing written for it) and the run
goes on. Nothing is overwritten unless ``--overwrite``, and no output is ever
written to an input (``io/write_guard.py``).

Exit status: 0 when every input ran; 1 when any input failed; 2 for a usage
error or a refused recipe.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np

import quantized.api as qz
from quantized.cli_convert import expand_inputs
from quantized.datastruct import DataStruct
from quantized.io.origin_convert import safe_name
from quantized.io.workspace_dwk import datasets_workspace_json
from quantized.io.write_guard import WriteRefused, check_target
from quantized.recipe_run import Recipe, extract_outputs, parse_recipe, recipe_problems, run_recipe

__all__ = ["run_command", "summary_dataset"]

_REPORT_NAME = "run-report.json"
_FORMATS = ("csv", "xlsx", "dwk")
_FIGURES = ("pdf", "svg", "png")


def summary_dataset(recipe: Recipe, rows: list[tuple[str, list[float], str | None]]) -> DataStruct:
    """One row per input: x = input number, channels = the declared outputs
    (``lib/template.ts`` ``summaryDataset``); file names and failures in
    metadata."""
    return DataStruct.create(
        np.arange(1, len(rows) + 1, dtype=float),
        np.asarray([vals for _, vals, _ in rows], dtype=float).reshape(
            len(rows), len(recipe.outputs)
        ),
        labels=list(recipe.outputs),
        units=["" for _ in recipe.outputs],
        metadata={
            "x_column_name": "file #",
            "source": f"template batch: {recipe.name}",
            "files": [name for name, _, _ in rows],
            "failures": [
                f"{i}: {name} - {why}" for i, (name, _, why) in enumerate(rows, start=1) if why
            ],
        },
    )


def _unique_stems(paths: list[Path], tag: str) -> list[str]:
    """``<input stem> - <recipe>`` per input, ``~2``, ``~3`` … for a stem
    already used (``a.csv`` and ``a.dat``), so no output overwrites another."""
    taken: set[str] = set()
    out: list[str] = []
    for p in paths:
        base = safe_name(f"{p.stem} - {tag}")
        name, k = base, 2
        while name.lower() in taken:
            name, k = f"{base}~{k}", k + 1
        taken.add(name.lower())
        out.append(name)
    return out


def _write_bytes(path: Path, data: bytes, overwrite: bool, protect: list[Path]) -> Path:
    check_target(path, overwrite=overwrite, protected=protect)
    path.write_bytes(data)
    return path


def _figure(data: DataStruct, title: str, fmt: str) -> bytes:
    x_label = str(data.metadata.get("x_column_name") or "x")
    series = [(lbl, data.values[:, c]) for c, lbl in enumerate(data.labels)]
    return qz.render_figure(data.time, series, title=title, x_label=x_label, fmt=fmt)


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="qz run", description="Re-run an analysis template saved in the app on new files."
    )
    p.add_argument("recipe", help="the template JSON (Pipeline panel / Recipe Library export)")
    p.add_argument("inputs", nargs="+", help="input files (globs and ** work)")
    p.add_argument("--out", required=True, help="output folder (created)")
    p.add_argument("--format", choices=_FORMATS, default="csv", help="processed data format")
    p.add_argument("--figures", choices=_FIGURES, help="also write one figure per input")
    p.add_argument(
        "--background",
        action="append",
        default=[],
        help="background file: one per background-subtraction step, in step order",
    )
    p.add_argument("--overwrite", action="store_true", help="replace existing outputs")
    return p


def run_command(argv: list[str]) -> int:
    """``qz run ...``; returns the exit status (module doc)."""
    args = _parser().parse_args(argv)
    try:
        recipe = parse_recipe(Path(args.recipe).read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        print(f"qz run: {args.recipe}: {exc}", file=sys.stderr)
        return 2
    problems = recipe_problems(recipe, backgrounds=len(args.background))
    if problems:
        print(
            f"qz run: {recipe.name!r} cannot run headless (nothing was read or written):",
            file=sys.stderr,
        )
        for line in problems:
            print(f"  {line}", file=sys.stderr)
        return 2
    files, unmatched = expand_inputs(args.inputs)
    if unmatched or not files:
        print(f"qz run: no input matches {', '.join(unmatched) or args.inputs}", file=sys.stderr)
        return 2
    protect: list[Path] = [*files, Path(args.recipe), *(Path(b) for b in args.background)]
    backgrounds: list[DataStruct] = []
    for bg_path in args.background:
        try:
            backgrounds.append(qz.load(bg_path))
        except Exception as exc:  # noqa: BLE001 - any reader failure is a usage error here
            print(f"qz run: background {bg_path}: {exc}", file=sys.stderr)
            return 2
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    report: dict[str, Any] = {
        "recipe": recipe.name,
        "revision": recipe.revision,
        "started": datetime.now(UTC).isoformat(timespec="seconds"),
        "inputs": [],
    }
    rows: list[tuple[str, list[float], str | None]] = []
    project: list[tuple[str, DataStruct]] = []
    sources: list[str | None] = []
    failed = 0
    for path, prefix in zip(files, _unique_stems(files, recipe.name), strict=True):
        entry: dict[str, Any] = {"input": str(path), "outputs": []}
        try:
            run = run_recipe(recipe, qz.load(path), backgrounds=backgrounds)
            last = run.fits[-1][1] if run.fits else None
            entry.update(status="ok", log=run.log, warnings=run.warnings)
            rows.append((path.name, extract_outputs(recipe.outputs, last), None))
            if args.format == "dwk":
                project.append((f"{path.name} ({recipe.name})", run.data))
                sources.append(str(path.resolve()))
            else:
                target = out / f"{prefix}.{args.format}"
                qz.save_table(run.data, target, overwrite=args.overwrite, protect=protect)
                entry["outputs"].append(str(target))
            if args.figures:
                fig = out / f"{prefix}.{args.figures}"
                _write_bytes(fig, _figure(run.data, f"{recipe.name} - {path.name}", args.figures),
                             args.overwrite, protect)  # fmt: skip
                entry["outputs"].append(str(fig))
            print(f"{path}: ok ({len(run.fits)} fit{'s' if len(run.fits) != 1 else ''})")
        except Exception as exc:  # noqa: BLE001 - one bad input never stops the batch
            failed += 1
            entry.update(status="failed", error=str(exc))
            rows.append((path.name, extract_outputs(recipe.outputs, None), str(exc)))
            print(f"{path}: FAILED - {exc}")
        report["inputs"].append(entry)
    stem = safe_name(recipe.name)
    try:
        if recipe.outputs:
            summary = summary_dataset(recipe, rows)
            if args.format == "dwk":
                project.append((f"{recipe.name} summary", summary))
                sources.append(None)
            else:
                target = out / f"{stem} summary.csv"
                qz.save_table(summary, target, overwrite=args.overwrite, protect=protect)
                report["summary"] = str(target)
        if args.format == "dwk" and project:
            text = datasets_workspace_json(project, sources=sources)
            report["project"] = str(
                _write_bytes(out / f"{stem}.dwk", text.encode("utf-8"), args.overwrite, protect)
            )
        report_path = out / _REPORT_NAME
        check_target(report_path, overwrite=args.overwrite, protected=protect)
        report_path.write_text(json.dumps(report, indent=2, default=str) + "\n", encoding="utf-8")
    except WriteRefused as exc:
        print(f"qz run: {exc}", file=sys.stderr)
        return 1
    print(f"{len(files) - failed}/{len(files)} input(s) ran; report: {out / _REPORT_NAME}")
    return 1 if failed else 0

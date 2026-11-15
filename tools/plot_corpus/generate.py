"""Write the plot-corpus data families: ``<out>/<family>/family.json`` + ``.truth.json``.

``family.json`` is what the Origin builder loads (books, sheets, columns with
designations/units/values, matrices, masks, axis scales). ``<family>.truth.json``
is the planted answer the scorers compare against: the applicable plot types,
row counts, and each family's edge-case facts. Same seed -> same bytes
(sorted keys, Python float repr, NaN written as null).

    uv run python tools/plot_corpus/generate.py --out <dir> [--seed 20261115] [--family NAME ...]
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from families import FAMILIES, Family, build_family  # noqa: E402
from plot_types import applicable  # noqa: E402

DEFAULT_SEED = 20261115
GENERATOR_VERSION = 1


def _dumps(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, indent=1, ensure_ascii=False, allow_nan=False) + "\n"


def family_payload(fam: Family, seed: int) -> dict[str, Any]:
    return {
        "generator_version": GENERATOR_VERSION,
        "seed": seed,
        "name": fam.name,
        "description": fam.description,
        "books": [asdict(b) for b in fam.books],
        "matrices": [asdict(m) for m in fam.matrices],
        "axis": fam.axis,
    }


def truth_payload(fam: Family, seed: int) -> dict[str, Any]:
    sheets = []
    for book in fam.books:
        for sheet in book.sheets:
            sheets.append({
                "book": book.name,
                "sheet": sheet.name,
                "deleted": sheet.deleted,
                "n_rows": sheet.columns[0].n_rows if sheet.columns else 0,
                "columns": [
                    {"short": c.short, "long": c.long, "units": c.units,
                     "designation": c.designation, "fmt": c.fmt}
                    for c in sheet.columns
                ],
            })
    return {
        "generator_version": GENERATOR_VERSION,
        "seed": seed,
        "family": fam.name,
        "description": fam.description,
        "shapes": sorted(fam.shapes),
        "plot_types": [p.name for p in applicable(fam.shapes)],
        "sheets": sheets,
        "matrices": [
            {"name": m.name, "rows": len(m.values), "cols": len(m.values[0]) if m.values else 0,
             "x": [m.x1, m.x2], "y": [m.y1, m.y2]}
            for m in fam.matrices
        ],
        "axis": fam.axis,
        "facts": fam.truth,
    }


def write_family(out: Path, name: str, seed: int) -> list[Path]:
    fam = build_family(name, seed)
    d = out / name
    d.mkdir(parents=True, exist_ok=True)
    paths = [d / "family.json", d / f"{name}.truth.json"]
    paths[0].write_text(_dumps(family_payload(fam, seed)), encoding="utf-8", newline="\n")
    paths[1].write_text(_dumps(truth_payload(fam, seed)), encoding="utf-8", newline="\n")
    return paths


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--seed", type=int, default=DEFAULT_SEED)
    ap.add_argument("--family", action="append", choices=sorted(FAMILIES))
    args = ap.parse_args(argv)
    for name in args.family or list(FAMILIES):
        for p in write_family(args.out, name, args.seed):
            print(p)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

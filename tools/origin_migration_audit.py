"""Audit the Origin migration inventory against the local test-data corpus.

This is intentionally local-only: it reads the sibling ``test-data/origin``
checkout and never copies project contents into this repository.  It exercises
the same lazy-workbook payload used by the application, then reports the counts
the migration cockpit will show.

Examples::

    uv run python tools/origin_migration_audit.py
    uv run python tools/origin_migration_audit.py --projects Moke.opj PNR.opj
    uv run python tools/origin_migration_audit.py --json audit.json
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any

from quantized.routes.parsers import _import_with_books


def _default_corpus() -> Path:
    repo = Path(__file__).resolve().parents[1]
    candidates = [repo.parent / "test-data" / "origin"]
    # Managed worktrees are often siblings of ``git/quantized`` rather than
    # of the corpus. Walk a few ancestors so the command behaves the same from
    # main and from a review worktree.
    candidates.extend(parent / "test-data" / "origin" for parent in repo.parents[:4])
    return next((path for path in candidates if path.is_dir()), candidates[0])


def audit_project(path: Path) -> dict[str, Any]:
    started = time.perf_counter()
    payload, handle = _import_with_books(path)
    elapsed = time.perf_counter() - started
    books = payload.get("books", [])
    figures = payload.get("figures", [])
    manifest = payload["origin_fidelity"]
    actionable = len(figures)
    filtered = len(manifest["filtered_figures"])
    total = manifest["graph_records_total"]
    # The frontend deliberately keys nameless records by entry id because
    # separate nameless windows cannot safely be grouped. Only named windows
    # use the (name, layer) identity and therefore need uniqueness here.
    identities = [(figure["name"], figure.get("layer")) for figure in figures if figure.get("name")]
    empty = [
        f"{figure.get('name') or '<unnamed>'}:{figure.get('layer') or 1}"
        for figure in figures
        if not figure.get("curves")
    ]
    issues: list[str] = []
    if handle is not None:
        issues.append("unexpected dataset handle")
    if actionable != manifest["graph_records_actionable"]:
        issues.append("actionable figure count disagrees with manifest")
    if filtered != manifest["graph_records_filtered"]:
        issues.append("filtered figure count disagrees with manifest")
    if actionable + filtered != total:
        issues.append("actionable + filtered does not equal total")
    if len(identities) != len(set(identities)):
        issues.append("duplicate graph-window/layer identities")
    if books and not payload.get("book_source"):
        issues.append("lazy workbook inventory has no reloadable source")
    if empty:
        issues.append(f"{len(empty)} actionable graph layers have no decoded curves")

    return {
        "project": path.name,
        "bytes": path.stat().st_size,
        "seconds": round(elapsed, 3),
        "status": manifest["status"],
        "books": len(books),
        "lazy_books": sum(book.get("lazy") is True for book in books),
        "graph_records_total": total,
        "graph_records_actionable": actionable,
        "graph_records_filtered": filtered,
        "decoded_curves": sum(len(figure.get("curves", [])) for figure in figures),
        "empty_actionable_graphs": empty,
        "issues": issues,
    }


def _files(corpus: Path, projects: list[str], recursive: bool) -> list[Path]:
    if projects:
        return [corpus / name for name in projects]
    glob = corpus.rglob if recursive else corpus.glob
    return sorted((*glob("*.opj"), *glob("*.opju")), key=lambda path: str(path).lower())


def _print_table(rows: list[dict[str, Any]]) -> None:
    print("project\tMiB\tseconds\tbooks\tgraphs (actionable/total)\tfiltered\tcurves\tresult")
    for row in rows:
        result = "OK" if not row["issues"] else "; ".join(row["issues"])
        print(
            f"{row['project']}\t{row['bytes'] / 1024 / 1024:.1f}\t{row['seconds']:.3f}\t"
            f"{row['books']}\t{row['graph_records_actionable']}/{row['graph_records_total']}\t"
            f"{row['graph_records_filtered']}\t{row['decoded_curves']}\t{result}"
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus", type=Path, default=_default_corpus())
    parser.add_argument("--projects", nargs="*", default=[])
    parser.add_argument(
        "--recursive", action="store_true", help="include specimens/probes below the corpus root"
    )
    parser.add_argument("--json", type=Path, help="also write the machine-readable report")
    args = parser.parse_args()

    if not args.corpus.is_dir():
        parser.error(f"Origin corpus not found: {args.corpus}")
    paths = _files(args.corpus, args.projects, args.recursive)
    missing = [path for path in paths if not path.is_file()]
    if missing:
        parser.error("project not found: " + ", ".join(str(path) for path in missing))
    if not paths:
        parser.error(f"no .opj/.opju projects found in {args.corpus}")

    rows = [audit_project(path) for path in paths]
    _print_table(rows)
    if args.json:
        args.json.write_text(json.dumps(rows, indent=2) + "\n", encoding="utf-8")
    return 1 if any(row["issues"] for row in rows) else 0


if __name__ == "__main__":
    sys.exit(main())

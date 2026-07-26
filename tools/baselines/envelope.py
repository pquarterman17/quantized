"""P0.4 backend performance-envelope harness (PRIMARY_SOFTWARE_AUDIT_PLAN).

A manual measurement CLI, NOT a pytest -- nothing here runs in CI. It
generates (if missing) the P0.4-scale fixtures under ``--fixtures-dir``
(default ``tools/baselines/out``, gitignored -- see ``tools/baselines/large.py``
and ``make_fixtures.py --large``), runs the six measurement cases in
``envelope_cases.py`` against the REAL ``quantized.io`` / ``quantized.calc``
paths, and writes one dated, hardware-stamped JSON report.

Usage::

    uv run python tools/baselines/envelope.py
    uv run python tools/baselines/envelope.py --out docs/envelope/2026-07-26-backend.json
"""

from __future__ import annotations

import argparse
import datetime
import json
import sys
from pathlib import Path

from common import DEFAULT_LARGE_DIR, REPO_ROOT
from envelope_cases import (
    case_correction_chain,
    case_csv_import,
    case_dense_multiseries,
    case_figure_export_scale,
    case_map_suite,
    case_plot_payload,
)
from envelope_hw import hardware_block
from envelope_measure import CaseResult
from large import write_dense_multiseries_csv, write_large_csv

_SEED_LARGE_CSV = 2001
_SEED_LARGE_MULTISERIES = 2003

CASE_FUNCS = (
    case_csv_import,
    case_correction_chain,
    case_map_suite,
    case_dense_multiseries,
    case_figure_export_scale,
    case_plot_payload,
)


def _ensure_fixtures(fixtures_dir: Path) -> None:
    """Generate the two flat P0.4 fixtures if absent (the 3 map sizes are
    generated lazily, per-size, inside ``case_map_suite``). Same seeds as
    ``make_fixtures.py --large`` so re-running this is a no-op once
    ``--large`` has already populated ``fixtures_dir``."""
    fixtures_dir.mkdir(parents=True, exist_ok=True)
    csv_path = fixtures_dir / "large_million_row.csv"
    if not csv_path.exists():
        print(f"generating {csv_path} (~1,000,000 rows) ...")
        write_large_csv(csv_path, seed=_SEED_LARGE_CSV)
    dense_path = fixtures_dir / "large_dense_multiseries.csv"
    if not dense_path.exists():
        print(f"generating {dense_path} ...")
        write_dense_multiseries_csv(dense_path, seed=_SEED_LARGE_MULTISERIES)


def _run_all(fixtures_dir: Path) -> list[CaseResult]:
    results: list[CaseResult] = []
    for fn in CASE_FUNCS:
        print(f"running {fn.__name__} ...")
        case_results = fn(fixtures_dir)
        for r in case_results:
            print(f"  {r.case}: {r.wall_s * 1000:.1f} ms, {r.peak_mem_mb:.1f} MB peak")
        results.extend(case_results)
    return results


def _print_table(results: list[CaseResult]) -> None:
    case_w = max(len(r.case) for r in results) + 2
    print(f"\n{'case':<{case_w}} {'wall (ms)':>12} {'peak mem (MB)':>15} {'reps':>6}")
    print("-" * (case_w + 38))
    for r in results:
        reps = f"{r.repeat}" if r.warmup or r.repeat > 1 else "1 (single)"
        print(f"{r.case:<{case_w}} {r.wall_s * 1000:>12.1f} {r.peak_mem_mb:>15.1f} {reps:>6}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--fixtures-dir",
        type=Path,
        default=DEFAULT_LARGE_DIR,
        help="directory holding/receiving the P0.4-scale fixtures (default: tools/baselines/out)",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help="output JSON path (default: docs/envelope/<today>-backend.json)",
    )
    args = parser.parse_args()

    fixtures_dir: Path = args.fixtures_dir
    _ensure_fixtures(fixtures_dir)

    results = _run_all(fixtures_dir)
    _print_table(results)

    today = datetime.date.today().isoformat()
    default_out = REPO_ROOT / "docs" / "envelope" / f"{today}-backend.json"
    out_path: Path = args.out if args.out is not None else default_out
    out_path.parent.mkdir(parents=True, exist_ok=True)
    report = {
        "generated": datetime.datetime.now(datetime.UTC).isoformat(),
        "plan_item": "PRIMARY_SOFTWARE_AUDIT_PLAN P0.4 (backend half)",
        "python": sys.version,
        "hardware": hardware_block(),
        "cases": [r.as_dict() for r in results],
    }
    out_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"\nwrote {out_path.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()

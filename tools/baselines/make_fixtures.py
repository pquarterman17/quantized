"""Generate the P0.3 timed-workflow-baseline fixtures.

Default mode writes the small, committed fixture set into
``tests/fixtures/baselines/`` — these are byte-deterministic (fixed numpy
seeds) and matrix-validated by ``tests/test_parsers_matrix.py`` /
``tests/test_baseline_fixtures.py``.

``--large`` writes the separate P0.4-scale performance-envelope fixtures
(a ~1,000,000-row CSV, a >=1000x1000 2-D map, a dense multi-series CSV) to
``--out`` (default ``tools/baselines/out``, gitignored) — these are NEVER
committed.

Usage::

    uv run python tools/baselines/make_fixtures.py
    uv run python tools/baselines/make_fixtures.py --large
    uv run python tools/baselines/make_fixtures.py --large --out D:/scratch
"""

from __future__ import annotations

import argparse
from pathlib import Path

from common import COMMITTED_DIR, DEFAULT_LARGE_DIR
from large import write_dense_multiseries_csv, write_large_csv, write_large_map
from qd import write_qd_mvsh_series
from reflectometry import write_pnr_pair, write_xrr_refl
from rsm import write_xrdml_rsm
from sims import write_sims_profile
from tabular import write_grouped_factors_csv, write_preamble_table
from xrd import write_xrd_pattern

# Seeds are per-fixture and fixed so re-running this script is a no-op against
# the committed set (tests/test_baseline_fixtures.py byte-compares output).
_SEED_CSV_PREAMBLE = 1001
_SEED_TSV_PREAMBLE = 1002
_SEED_QD = 1003
_SEED_XRD = 1004
_SEED_XRR = 1005
_SEED_PNR = 1006
_SEED_SIMS = 1007
_SEED_RSM = 1008
_SEED_GROUPED = 1009

_SEED_LARGE_CSV = 2001
_SEED_LARGE_MAP = 2002
_SEED_LARGE_MULTISERIES = 2003


def write_committed_set(out_dir: Path) -> list[Path]:
    """Write the small, committed fixture set. Returns the written paths."""
    out_dir.mkdir(parents=True, exist_ok=True)

    csv_preamble = out_dir / "csv_preamble_multichannel.csv"
    write_preamble_table(csv_preamble, delimiter=",", seed=_SEED_CSV_PREAMBLE)

    tsv_preamble = out_dir / "tsv_preamble_multichannel.tsv"
    write_preamble_table(tsv_preamble, delimiter="\t", seed=_SEED_TSV_PREAMBLE)

    qd_series = out_dir / "qd_mvsh_parametric_series.dat"
    write_qd_mvsh_series(qd_series, seed=_SEED_QD)

    xrd_pattern = out_dir / "xrd_two_phase_pattern.csv"
    write_xrd_pattern(xrd_pattern, seed=_SEED_XRD)

    xrr_refl = out_dir / "xrr_bilayer_kiessig.refl"
    write_xrr_refl(xrr_refl, seed=_SEED_XRR)

    pnr_pair = out_dir / "pnr_bilayer_spin_pair.pnr"
    write_pnr_pair(pnr_pair, seed=_SEED_PNR)

    sims_profile = out_dir / "sims_four_species_profile.csv"
    write_sims_profile(sims_profile, seed=_SEED_SIMS)

    rsm_map = out_dir / "xrdml_rsm_small_map.xrdml"
    write_xrdml_rsm(rsm_map, seed=_SEED_RSM)

    grouped = out_dir / "grouped_factors_boxplot.csv"
    write_grouped_factors_csv(grouped, seed=_SEED_GROUPED)

    return [
        csv_preamble,
        tsv_preamble,
        qd_series,
        xrd_pattern,
        xrr_refl,
        pnr_pair,
        sims_profile,
        rsm_map,
        grouped,
    ]


def write_large_set(out_dir: Path) -> list[Path]:
    """Write the P0.4-scale fixtures. Never committed; returns the written paths."""
    out_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []

    large_csv = out_dir / "large_million_row.csv"
    write_large_csv(large_csv, seed=_SEED_LARGE_CSV)
    written.append(large_csv)

    large_map = out_dir / "large_rsm_map.xrdml"
    write_large_map(large_map, seed=_SEED_LARGE_MAP)
    written.append(large_map)

    dense = out_dir / "large_dense_multiseries.csv"
    write_dense_multiseries_csv(dense, seed=_SEED_LARGE_MULTISERIES)
    written.append(dense)

    return written


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--large",
        action="store_true",
        help="generate the P0.4-scale fixtures instead of the committed set",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help="output directory (default: tests/fixtures/baselines, or "
        "tools/baselines/out with --large)",
    )
    args = parser.parse_args()

    if args.large:
        out_dir = args.out if args.out is not None else DEFAULT_LARGE_DIR
        written = write_large_set(out_dir)
    else:
        out_dir = args.out if args.out is not None else COMMITTED_DIR
        written = write_committed_set(out_dir)

    total_bytes = sum(p.stat().st_size for p in written)
    print(f"wrote {len(written)} file(s) to {out_dir} ({total_bytes / 1024:.1f} KiB total)")
    for p in written:
        print(f"  {p.name:<40} {p.stat().st_size / 1024:>10.1f} KiB")


if __name__ == "__main__":
    main()

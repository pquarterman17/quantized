"""P0.4 residual M1 fixtures: parameterized 2-D RSM maps at 500x500, 1000x1000,
and 2000x2000 (large.py's ``write_large_map`` already accepts n_omega/n_tt --
this just calls it three times with the sizes the browser-side map-envelope
harness (tools/bench/map_envelope.mjs) needs). Never committed — same
``tools/baselines/out/`` gitignored directory as ``make_fixtures.py --large``.

Usage::

    uv run python tools/baselines/make_map_fixtures.py
    uv run python tools/baselines/make_map_fixtures.py --out D:/scratch
"""

from __future__ import annotations

import argparse
from pathlib import Path

from common import DEFAULT_LARGE_DIR
from large import write_large_map

# Distinct seed band from make_fixtures.py's _SEED_LARGE_* (2001-2003) so a
# combined run of both scripts never reuses a seed.
_SEED_MAP_500 = 2101
_SEED_MAP_1000 = 2102
_SEED_MAP_2000 = 2103

SIZES = [500, 1000, 2000]


def write_map_set(out_dir: Path) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for n, seed in zip(SIZES, [_SEED_MAP_500, _SEED_MAP_1000, _SEED_MAP_2000]):
        p = out_dir / f"large_rsm_map_{n}.xrdml"
        write_large_map(p, seed=seed, n_omega=n, n_tt=n)
        written.append(p)
    return written


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=None, help="output directory (default: tools/baselines/out)")
    args = parser.parse_args()
    out_dir = args.out if args.out is not None else DEFAULT_LARGE_DIR
    written = write_map_set(out_dir)
    total_bytes = sum(p.stat().st_size for p in written)
    print(f"wrote {len(written)} file(s) to {out_dir} ({total_bytes / 1024 / 1024:.1f} MiB total)")
    for p in written:
        print(f"  {p.name:<30} {p.stat().st_size / 1024 / 1024:>10.1f} MiB")


if __name__ == "__main__":
    main()

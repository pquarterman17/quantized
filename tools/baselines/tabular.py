"""Generic delimited-table fixtures: preamble CSV/TSV and grouped-factors CSV.

Journey 1 (CSV/TSV with pre-header metadata) and journey 7 (grouped box
plot). Both route through the generic ``io/delimited.py`` importer.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from common import fmt_sig, write_text

__all__ = ["write_grouped_factors_csv", "write_preamble_table"]


def _preamble_block(lines: list[str]) -> str:
    return "".join(f"# {line}\n" for line in lines)


def write_preamble_table(path: Path, *, delimiter: str, seed: int, n_rows: int = 300) -> None:
    """An ~8-line ``key: value`` instrument preamble, then a 4-numeric-column
    table (Time, and three sensor channels). Written with ``delimiter``
    (``,`` for CSV, ``\\t`` for TSV) so the same generator covers journey 1's
    CSV and TSV cases."""
    rng = np.random.default_rng(seed)
    preamble = _preamble_block(
        [
            "Instrument: LabX Multichannel Logger 9000",
            "Firmware: 4.2.1",
            "Operator: qa-baseline",
            "Sample: baseline-fixture-01",
            "Channel count: 3",
            "Sample interval (s): 0.5",
            "Notes: synthetic P0.3 baseline fixture, not real instrument data",
            "End of preamble",
        ]
    )
    header = delimiter.join(["Time (s)", "Channel A (V)", "Channel B (V)", "Temperature (C)"])

    t = np.arange(n_rows, dtype=float) * 0.5
    chan_a = 1.5 * np.sin(t * 0.05) + 0.05 * rng.normal(size=n_rows)
    chan_b = 0.8 * np.cos(t * 0.03 + 0.4) + 0.3 + 0.03 * rng.normal(size=n_rows)
    temp = 25.0 + 0.002 * t + 0.1 * rng.normal(size=n_rows)

    lines = [preamble.rstrip("\n"), header]
    for i in range(n_rows):
        row = [fmt_sig(t[i]), fmt_sig(chan_a[i]), fmt_sig(chan_b[i]), fmt_sig(temp[i])]
        lines.append(delimiter.join(row))
    write_text(path, "\n".join(lines) + "\n")


def write_grouped_factors_csv(path: Path, *, seed: int) -> None:
    """~600-row grouped-factors table for the box-plot journey.

    A first attempt at this fixture used text factor columns (``Lot,Wafer,
    Type,Response``) directly. Probing ``io/delimited.py`` against that shape
    surfaced two real import-quality gaps (see
    ``docs/timed_workflow_baselines.md`` journey 7 for the write-up):
    a text first column silently produces an all-NaN x-axis, and a numeric
    response column followed only by text factor columns raises
    ``ValueError: no valid data columns`` outright (every candidate column
    fails the >10% numeric-fraction test). Neither is a clean, valid import,
    so — per the P0.3 instructions — the committed fixture restructures
    around the generic importer's real contract: small-integer factor CODES
    as ordinary numeric columns, with the code->name legend recorded in the
    ``#``-preamble (preserved as ``metadata['comments']``, per MAIN_PLAN #33).
    This is exactly the P1.4 gap the audit plan already tracks (first-class
    categorical channels) — not a new defect, just first-hand evidence of it.
    """
    rng = np.random.default_rng(seed)
    lots = ["LotA", "LotB", "LotC"]
    types = ["Center", "Edge"]
    n_wafers = 5
    n_replicates = 20
    lot_effect = {1: 0.0, 2: 0.6, 3: -0.4}
    type_effect = {1: 0.0, 2: 0.35}
    wafer_effect = rng.normal(scale=0.15, size=(len(lots), n_wafers))

    rows: list[tuple[int, int, int, float]] = []
    for li in range(1, len(lots) + 1):
        for wi in range(1, n_wafers + 1):
            for ti in range(1, len(types) + 1):
                for _ in range(n_replicates):
                    response = (
                        12.0
                        + lot_effect[li]
                        + type_effect[ti]
                        + float(wafer_effect[li - 1, wi - 1])
                        + rng.normal(scale=0.2)
                    )
                    rows.append((li, wi, ti, response))

    preamble_lines = [
        "Wafer inspection - grouped factors (box plot journey)",
        "lot_codes: " + ", ".join(f"{i + 1}={name}" for i, name in enumerate(lots)),
        "wafer_codes: 1.." + str(n_wafers) + " (wafer position on the lot)",
        "type_codes: " + ", ".join(f"{i + 1}={name}" for i, name in enumerate(types)),
        "Response unit: arb. units",
        "Notes: numeric factor codes decode via the legend above; the generic",
        "  CSV importer has no first-class categorical/text channel (P1.4),",
        "  so text factor columns cannot be imported cleanly today.",
    ]
    header = "LotCode,WaferCode,TypeCode,Response"
    lines = [_preamble_block(preamble_lines).rstrip("\n"), header]
    for li, wi, ti, resp in rows:
        lines.append(f"{li},{wi},{ti},{fmt_sig(resp)}")
    write_text(path, "\n".join(lines) + "\n")

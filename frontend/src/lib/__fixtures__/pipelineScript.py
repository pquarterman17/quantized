#!/usr/bin/env python3
"""Quantized pipeline: reproducible analysis script (7 steps).

Re-runs the recorded data pipeline headless with the public quantized.api
(pip install quantized). It runs in this process: no app or server is needed,
and the project open in the app is not changed. Steps with no quantized.api
equivalent are kept as comments that say so.

Usage: python <this file> [INPUT ...] [--out OUT]
  INPUT  the file(s) the pipeline imports, in order (default: the recorded names)
  OUT    where the final data goes: .csv, .tsv or .xlsx (default pipeline_output.csv)
"""

import argparse

import numpy as np

import quantized.api as qz

RECORDED_INPUTS = ["peak.csv"]


def main(argv=None):
    parser = argparse.ArgumentParser(description="Re-run a recorded Quantized pipeline.")
    parser.add_argument("inputs", nargs="*", help="input file(s), in import order")
    parser.add_argument("--out", default="pipeline_output.csv", help="output table (.csv/.tsv/.xlsx)")
    args = parser.parse_args(argv)
    if not args.inputs and None not in RECORDED_INPUTS:
        args.inputs = list(RECORDED_INPUTS)
    if len(args.inputs) != len(RECORDED_INPUTS):
        parser.error(f"give {len(RECORDED_INPUTS)} input file(s)")
    data = None
    fits = []

    # 1. Import peak.csv
    data = qz.load(args.inputs[0])
    raw = data  # the uncorrected base that corrections start from

    # 2. Corrections → peak
    # Error-column bindings set in the app are not recorded; pass error_bindings=[...] to match them.
    data = qz.apply_corrections(raw, {"yOff": -2, "yScale": 0.5})

    # 3. Y axis log
    # display setting only; there is no data to re-run

    # 4. Fit Gaussian
    x, y = np.asarray(data.time, dtype=float), np.asarray(data.column(0), dtype=float)
    keep = np.isfinite(x) & np.isfinite(y)
    keep &= (x >= 2) & (x <= 8)  # the recorded fit window
    fit = qz.fit_model("Gaussian", x[keep], y[keep])
    fits.append(("4. Fit Gaussian", fit))
    if int(keep.sum()) != 61:
        print(f"note: step 4 fit {int(keep.sum())} points; the app fit 61 (rows masked in the app are not recorded)")

    # 5. Grid
    # (turned off in the pipeline; not run)

    # 6. Add column twice
    # NOT REPRODUCED: formula columns are evaluated only in the app (no quantized.api equivalent).

    # 7. Corrections → peak
    # not run: it follows step 6, which this script cannot reproduce

    for label, fit in fits:
        values = ", ".join(f"{k}={v:.6g}" for k, v in zip(fit["paramNames"], fit["params"]))
        print(f"{label}: {values}  R2={fit['R2']:.6g}")
    if data is None:
        print("nothing to save: no step loaded data")
        return 1
    qz.save_table(data, args.out)
    print(f"saved {args.out}: the data after step 5; steps from 6 on were NOT reproduced")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

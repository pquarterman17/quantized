// Signal filters and Reduce XY as ONE recordable transform (gap audit 4, G6/G7).
// The `sigop` op of lib/transformRun: median / despike / LOWESS / convolve /
// deconvolve / Hilbert / inverse FFT keep the rows (or, for the FFT, make a new
// axis); reduce-bin / reduce-duplicates / reduce-nth make a SMALLER dataset.
// The maths is backend (calc/signal_ops.py) -- this module is the params, their
// validation for replay, the request, and the ONE compute that the workshops'
// live previews and the commit/replay path all call.
//
// The source is the dataset's ANALYSIS rows (exclusions/filters pruned), as for
// resample. Rows are never sorted: the filters work in row order and Reduce
// refuses an X that reverses direction (calc/reduce_xy.py explains why).
// Lazy: only the workshops and the transform runner import it.

import { sigopDataset, type SigopResult } from "./api/sigop";
import { blanksToNaN } from "./blankCells";
import type { TransformWarning } from "./transformWarnings";
import type { DataStruct } from "./types";

export type SigopMethod =
  | "median" | "despike" | "lowess" | "convolve" | "deconvolve" | "hilbert" | "ifft"
  | "reduce-bin" | "reduce-duplicates" | "reduce-nth";
export type SigopArgs = Record<string, number | string | boolean>;

export const SIGOP_METHODS: readonly SigopMethod[] = [
  "median", "despike", "lowess", "convolve", "deconvolve", "hilbert", "ifft",
  "reduce-bin", "reduce-duplicates", "reduce-nth",
];

export interface SigopParams {
  op: "sigop";
  method: SigopMethod;
  /** Source channels the operation reads (ignored by `reduce-nth`, which keeps every column). */
  channels: number[];
  args: SigopArgs;
}

export interface SigopComputed {
  data: DataStruct;
  name: string;
  warnings: TransformWarning[];
  flagged: Record<string, number[]>;
  rowsIn: number;
  rowsOut: number;
}

const stem = (name: string): string => name.replace(/\.[^.]+$/, "");

export const SIGOP_NAMES: Record<SigopMethod, string> = {
  median: "median filter",
  despike: "despiked",
  lowess: "LOWESS",
  convolve: "convolved",
  deconvolve: "deconvolved",
  hilbert: "Hilbert",
  ifft: "inverse FFT",
  "reduce-bin": "binned",
  "reduce-duplicates": "duplicates averaged",
  "reduce-nth": "every Nth row",
};

export function sigopLabel(p: SigopParams, primaryName: string): string {
  return `${SIGOP_NAMES[p.method][0].toUpperCase()}${SIGOP_NAMES[p.method].slice(1)} · ${primaryName}`;
}

export function sigopOutputName(p: SigopParams, primaryName: string): string {
  return `${stem(primaryName)} (${SIGOP_NAMES[p.method]})`;
}

/** Resolve a request/preview: `source` is the dataset's analysis rows. */
export async function computeSigop(
  p: SigopParams,
  source: { name: string; data: DataStruct },
  opts: { signal?: AbortSignal } = {},
): Promise<SigopComputed> {
  const d = source.data;
  const res: SigopResult = await sigopDataset({
    dataset: {
      time: d.time, values: d.values, labels: d.labels, units: d.units,
      metadata: d.metadata, cat_levels: d.cat_levels, level_order: d.level_order,
    },
    method: p.method,
    channels: p.channels,
    args: p.args,
  }, opts.signal);
  const provenance = { sigop_of: source.name, sigop_method: p.method };
  return {
    data: blanksToNaN({ ...res.dataset, metadata: { ...res.dataset.metadata, ...provenance } }),
    name: sigopOutputName(p, source.name),
    warnings: res.warnings.map((text) => ({ code: "sigop", text, info: true })),
    flagged: res.flagged,
    rowsIn: res.rows_in,
    rowsOut: res.rows_out,
  };
}

/** Validate a recorded `sigop` step's params (a .dwk / template is user-editable JSON). */
export function sigopParamsOf(raw: Record<string, unknown>): SigopParams {
  const method = String(raw.method ?? "") as SigopMethod;
  if (!SIGOP_METHODS.includes(method)) throw new Error(`unknown signal operation "${method}"`);
  const channels = raw.channels ?? [];
  if (!Array.isArray(channels) || !channels.every((c) => Number.isInteger(c))) {
    throw new Error(`"${method}" needs integer "channels"`);
  }
  const args = (raw.args ?? {}) as Record<string, unknown>;
  const clean: SigopArgs = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") clean[k] = v;
    else throw new Error(`"${method}" argument "${k}" must be a number, text or yes/no`);
  }
  if (method === "ifft") {
    const [m, p] = [clean.magnitudeChannel, clean.phaseChannel];
    if (!Number.isInteger(m) || !Number.isInteger(p) || (m as number) < 0 || (p as number) < 0 || m === p) {
      throw new Error('"ifft" needs two different whole-number column indices (magnitudeChannel, phaseChannel)');
    }
  }
  return { op: "sigop", method, channels: channels as number[], args: clean };
}

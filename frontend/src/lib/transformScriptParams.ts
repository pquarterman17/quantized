// Recorded `sigop` / `resample` step params, validated for the exported Python
// script (lib/pipeline.ts) exactly as the app's replay validates them
// (lib/transformSigop.ts `sigopParamsOf`, lib/transformResample.ts
// `resampleParamsOf`; pipelinePython.test.ts holds each pair equal case by
// case). Copies, deliberately: importing those modules here split each into a
// chunk of its own whose name landed in the entry's eager preload map (+0.1 to
// +0.2 kB eager, measured on the gap-audit-5 lane E build).

const SIGOP_METHODS = [
  "median", "despike", "lowess", "convolve", "deconvolve", "hilbert", "ifft",
  "reduce-bin", "reduce-duplicates", "reduce-nth",
  "unwrap", "percentile", "binomial", "envelope-extrema", "coherence", "decimate-aa", "zoom-fft",
  "cwt", "dwt", "wavelet-reconstruct", "wavelet-smooth", "wavelet-denoise",
];

/** `{method, channels, args}` the replay would send, or throws its message. */
export function sigopScriptParams(raw: Record<string, unknown>): {
  method: string;
  channels: number[];
  args: Record<string, number | string | boolean>;
} {
  const method = String(raw.method ?? "");
  if (!SIGOP_METHODS.includes(method)) throw new Error(`unknown signal operation "${method}"`);
  const channels = raw.channels ?? [];
  if (!Array.isArray(channels) || !channels.every((c) => Number.isInteger(c))) {
    throw new Error(`"${method}" needs integer "channels"`);
  }
  const args: Record<string, number | string | boolean> = {};
  for (const [k, v] of Object.entries((raw.args ?? {}) as Record<string, unknown>)) {
    if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") args[k] = v;
    else throw new Error(`"${method}" argument "${k}" must be a number, text or yes/no`);
  }
  if (method === "ifft") {
    const [m, p] = [args.magnitudeChannel, args.phaseChannel];
    if (!Number.isInteger(m) || !Number.isInteger(p) || (m as number) < 0 || (p as number) < 0 || m === p) {
      throw new Error('"ifft" needs two different whole-number column indices (magnitudeChannel, phaseChannel)');
    }
  }
  return { method, channels: channels as number[], args };
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export interface ResampleScriptParams {
  mode: "n_points" | "step" | "range";
  method: string;
  outOfRange: string;
  sortUnsorted: boolean;
  nPoints?: number;
  step?: number;
  start?: number;
  stop?: number;
}

/** A recorded `resample` step's grid and options, validated as
 *  `resampleParamsOf` validates them (same messages). `match` is refused: it
 *  needs another dataset, so the script never reproduces it. */
export function resampleScriptParams(raw: Record<string, unknown>): ResampleScriptParams {
  const mode = String(raw.mode ?? "");
  if (mode !== "n_points" && mode !== "step" && mode !== "range") throw new Error(`unknown resample grid "${mode}"`);
  const method = String(raw.method ?? "linear");
  if (!["linear", "pchip", "spline", "makima"].includes(method)) throw new Error(`unknown resample method "${method}"`);
  const outOfRange = String(raw.outOfRange ?? "nan");
  if (outOfRange !== "nan" && outOfRange !== "clip") throw new Error(`unknown out-of-range rule "${outOfRange}"`);
  const acc = raw.acceptedXUnits;
  if (acc !== undefined && (!Array.isArray(acc) || acc.length !== 2 || !acc.every((u) => typeof u === "string" && u))) {
    throw new Error('resample "acceptedXUnits" must be two unit names');
  }
  const need = (k: "nPoints" | "step" | "start" | "stop"): number => {
    const v = raw[k];
    if (!finite(v)) throw new Error(`resample "${mode}" needs a number "${k}"`);
    return v;
  };
  const p = { mode, method, outOfRange, sortUnsorted: raw.sortUnsorted === true } as const;
  if (mode === "n_points") {
    const nPoints = need("nPoints");
    if (!Number.isInteger(nPoints) || nPoints < 2) throw new Error('resample "nPoints" must be an integer ≥ 2');
    return { ...p, nPoints };
  }
  if (mode === "step") return { ...p, step: need("step") };
  return { ...p, start: need("start"), stop: need("stop"), step: need("step") };
}

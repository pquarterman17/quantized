// Analysis results kept server-side and fetched by id (P4 phase 4,
// plans/LARGE_PAYLOAD_PLAN.md; backend routes/_arrayresults.py, /api/results).
// Lazy workshops only: never import this from an eager module.
//
// A SNIP / ModPoly baseline, a peak search's background or a signal-op dataset
// is DATA (it is subtracted and written to a new worksheet), so it is never
// thinned. A large request opts in to a lean response -- `resultId` plus a
// per-bucket display for the preview -- and the full result crosses the wire
// once, when the user commits it. A 409 (evicted, a server restart) re-runs
// the same request with the full response: the calc is deterministic, so the
// arrays are the ones the id named.

import { postJSON, type HttpError } from "./http";

/** Requests of more rows than this ask for the lean response. */
export const RESULT_DISPLAY_MIN_POINTS = 20_000;
/** The display budget (~2 rows per bucket, 4096 buckets). */
export const RESULT_DISPLAY_POINTS = 4096;

type Num = number | null;

/** The wire's display column: `rows` index the posted points. */
export interface ResultDisplay {
  rows: number[];
  y: Num[];
}

export const isUnknownResult = (e: unknown): boolean => (e as HttpError | null)?.status === 409;

/** The transport fields for a result over `n` rows; empty (the unchanged
 *  full response) for a small one. */
export function leanTransport(n: number): { return_baseline: false; display_points: number } | Record<string, never> {
  return n > RESULT_DISPLAY_MIN_POINTS ? { return_baseline: false, display_points: RESULT_DISPLAY_POINTS } : {};
}

/** A display column laid out over `n` rows: the display values at their rows,
 *  `undefined` between them (uPlot draws across; a real gap stays null). */
export function displayColumn(display: ResultDisplay, n: number): Num[] {
  const out = new Array<Num | undefined>(n).fill(undefined);
  display.rows.forEach((row, i) => {
    if (row < n) out[row] = display.y[i] ?? null;
  });
  return out as Num[];
}

/** The kept array for `resultId` (`baseline` or `background`); on a miss or
 *  without an id, whatever `rerun` returns (the same request, full response). */
export async function arrayByIdOr(
  resultId: unknown,
  kind: "baseline" | "background",
  rerun: () => Promise<Num[]>,
  signal?: AbortSignal,
): Promise<Num[]> {
  if (typeof resultId === "string") {
    try {
      const out = await postJSON<{ values: Num[] }>("/api/results/array", { result_id: resultId, kind }, signal);
      return out.values;
    } catch (e) {
      if (!isUnknownResult(e)) throw e;
    }
  }
  return rerun();
}

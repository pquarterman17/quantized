// Curve Fit — the bootstrap corner plot export, moved out of useCurveFit.ts
// (module ceiling) unchanged: bootstrap the CURRENT fit's (x, y) and export
// the pairwise parameter-uncertainty figure. The hook owns the busy/error
// state; this owns the two requests.

import { bootstrapFit } from "../../../lib/api/curvefit";
import { dropGapRows } from "../../../lib/api/finitePairs";
import { exportCornerFigure } from "../../../lib/api/figures";
import type { Dataset } from "../../../lib/types";
import { runCancellable } from "../../../store/pendingOpActions";
import { toast } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";

export interface CornerPlotInput {
  dataset: Dataset;
  model: string;
  /** The model's parameter names (generic p0, p1, … when the count differs). */
  paramNames: readonly string[];
  x: readonly number[];
  y: readonly number[];
  /** The fitted parameters the bootstrap starts from. */
  p0: number[];
}

/** Bootstrap and export; throws with the message the panel shows. */
export async function exportCornerPlot(i: CornerPlotInput): Promise<void> {
  const pairs = dropGapRows(i.x, i.y);
  if (pairs.x.length === 0) throw new Error("no finite X/Y pairs are available to bootstrap");
  if (!pairs.complete) {
    toast(`${pairs.n - pairs.keep.length} of ${pairs.n} rows are gaps; they were excluded from the bootstrap.`);
  }
  // P3.4: bootstrap + render are one StatusBar op whose Cancel aborts
  // whichever request is in flight; a cancel saves no file and sets no error.
  const done = await runCancellable("Exporting corner plot…", async (signal) => {
    const boot = await bootstrapFit({ model: i.model, x: pairs.x, y: pairs.y, p0: i.p0, return_samples: true }, signal);
    if (!boot.boot_samples || boot.boot_samples.length === 0) {
      throw new Error("bootstrap returned no replicate samples");
    }
    const paramNames =
      i.paramNames.length === boot.params.length ? [...i.paramNames] : boot.params.map((_, k) => `p${k}`);
    const stem = i.dataset.name.replace(/\.[^.]+$/, "");
    await exportCornerFigure({
      samples: boot.boot_samples,
      param_names: paramNames,
      truths: boot.params,
      title: `${i.model} corner — ${i.dataset.name}`,
      filename: `${stem}-corner`,
    }, signal);
  });
  if (!done) useApp.getState().setStatus("corner plot cancelled");
}

// Peak Analyzer batch — the CLIENT half of "run a saved recipe over many
// datasets" (audit P2.4 slice 4).
//
// THE SPLIT. The recipe's range cut, baseline, peak find and parameter-table
// seeding already exist as the wizard's code: baseline and find are backend
// calls (./recipeSteps), the table is `buildSetup` (./peakModelParams —
// re-seeded from the data + every stored edit on top, lib/peakRecipeFit.ts).
// Re-implementing the seeding in Python would give two definitions of what a
// recipe means that could drift apart. So the client PREPARES one fit problem
// per dataset with exactly the wizard's code (the dataset's row here is what
// the wizard would fit on it), and the backend job (calc/peak_model_batch.py)
// FITS them — the long part — with cancel, progress and per-item isolation.
// Preparation is quick (two short requests per dataset); a dataset that
// cannot be prepared is an error row from here, never a dead batch.
//
// CHANNELS. The batch fits the X/Y columns the wizard fits on the active
// dataset (its plotted X + primary Y), matched in every other dataset BY
// COLUMN NAME (same-instrument files share names, not necessarily
// positions). A dataset without that column is an error row naming it —
// never a guess at another column (the repo's fail-closed rule).

import { dropGapRows } from "../../../lib/api/finitePairs";
import type { PeakBatchItem } from "../../../lib/api/peakBatch";
import { selectedFitData } from "../../../lib/fitselection";
import { cutRange, subtractBaseline, type PeakRecipe } from "../../../lib/peakwizard";
import { analysisData } from "../../../lib/rowstate";
import type { Dataset } from "../../../lib/types";
import { setupProblems } from "./modelSetupChecks";
import { buildSetup, modelFitBody } from "./peakModelParams";
import { recipeBaseline, recipeFind } from "./recipeSteps";

/** The backend's per-fit caps (src/quantized/routes/peaks.py). */
export const BATCH_MAX_PEAKS = 50;
export const BATCH_MAX_POINTS = 100_000;
/** The batch route's cap on items (src/quantized/routes/peaks_batch.py). */
export const BATCH_MAX_DATASETS = 200;

/** Which columns the batch fits: names (null x = the row index/time axis)
 *  plus the active dataset's indices, preferred when the name still matches. */
export interface BatchChannels {
  xLabel: string | null;
  yLabel: string;
  xIndex: number | null;
  yIndex: number;
}

/** The wizard's X/Y on the active dataset, as names; null when it has none. */
export function batchChannels(
  active: Dataset | null | undefined,
  xKey: number | null,
  yKeys: number[] | null,
  seriesOrder: number[] | null,
): BatchChannels | null {
  const sel = selectedFitData(active, xKey, yKeys, seriesOrder);
  const labels = active?.data.labels ?? [];
  if (!sel || labels[sel.yKey] === undefined) return null;
  const xLabel = xKey === null ? null : (labels[xKey] ?? null);
  if (xKey !== null && xLabel === null) return null;
  return { xLabel, yLabel: labels[sel.yKey], xIndex: xKey, yIndex: sel.yKey };
}

function columnOf(labels: readonly string[], label: string, preferred: number | null): number {
  if (preferred !== null && labels[preferred] === label) return preferred;
  return labels.indexOf(label);
}

export interface BatchSegment {
  x: number[];
  y: number[];
  gapCount: number;
}

/** `ds`'s analysis rows (exclusions and filters honoured) on the batch
 *  channels, range-cut and gap-free — the wizard's working segment. Throws
 *  an Error saying why when there is none. */
export function batchSegment(ds: Dataset, ch: BatchChannels, range: PeakRecipe["range"]): BatchSegment {
  const data = analysisData(ds);
  if (!data) throw new Error("no data");
  const yi = columnOf(data.labels, ch.yLabel, ch.yIndex);
  if (yi < 0) throw new Error(`no column named "${ch.yLabel}"`);
  let x = data.time;
  if (ch.xLabel !== null) {
    const xi = columnOf(data.labels, ch.xLabel, ch.xIndex);
    if (xi < 0) throw new Error(`no column named "${ch.xLabel}"`);
    x = data.values.map((row) => row[xi]);
  }
  const y = data.values.map((row) => row[yi]);
  const cut = cutRange(x, y, range.lo, range.hi);
  const pairs = dropGapRows(cut.x, cut.y);
  if (pairs.x.length === 0) throw new Error("no finite X/Y pairs in the recipe's range");
  if (pairs.x.length > BATCH_MAX_POINTS) {
    throw new Error(`${pairs.x.length} points in range; the fit takes at most ${BATCH_MAX_POINTS}`);
  }
  return { x: pairs.x, y: pairs.y, gapCount: pairs.n - pairs.keep.length };
}

/** Why this recipe cannot run as a batch at all, or null. */
export function recipeBatchBlock(recipe: PeakRecipe): string | null {
  return recipe.fit.engine === "classic"
    ? `recipe "${recipe.name}" uses the Classic engine; the batch runs the mixed-shape model engine (the one that reports uncertainties) — switch the recipe to the model engine in step 3 and save it again`
    : null;
}

export type PreparedItem =
  | { ok: true; item: Omit<PeakBatchItem, "id">; nPeaks: number; notes: string[] }
  | { ok: false; error: string };

/** One dataset's fit problem, prepared exactly as the wizard would on it:
 *  segment -> baseline -> find -> table (seed + the recipe's edits) -> body.
 *  Never throws: a dataset that cannot be prepared returns the reason. */
export async function prepareBatchItem(ds: Dataset, recipe: PeakRecipe, ch: BatchChannels): Promise<PreparedItem> {
  try {
    const seg = batchSegment(ds, ch, recipe.range);
    const baseline = await recipeBaseline(seg.y, recipe.baseline);
    const workingY = baseline ? subtractBaseline(seg.y, baseline) : seg.y;
    const found = await recipeFind(seg.x, workingY, recipe.find);
    if (found.length === 0) {
      return { ok: false, error: `no peaks found (SNR threshold ${recipe.find.snr_threshold})` };
    }
    if (found.length > BATCH_MAX_PEAKS) {
      return { ok: false, error: `${found.length} peaks found; the model fit takes at most ${BATCH_MAX_PEAKS}` };
    }
    const peaks = found.map(({ center, height, bg, fwhm }) => ({ center, height, bg, fwhm }));
    const setup = buildSetup(peaks, recipe.fit, recipe.model, seg.x, workingY);
    const problems = setupProblems(setup);
    if (problems.length > 0) return { ok: false, error: `parameter table: ${problems[0]}` };
    const notes = seg.gapCount > 0 ? [`${seg.gapCount} gap rows in range were excluded`] : [];
    return { ok: true, item: modelFitBody(setup, seg.x, workingY), nPeaks: peaks.length, notes };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "could not prepare this dataset" };
  }
}

// SIMS batch processing (P2.3) — the multi-profile half of the workshop,
// split out of useSims.ts. The rules a batch keeps so it is never less
// careful than processing the profiles one at a time:
//
// - Only COMPATIBLE profiles can be ticked. Each loaded dataset is checked up
//   front against the exact request the batch will send (`simsRequest`: the
//   named reference / keep / RSF columns, a scale recipe's x unit), and an
//   incompatible one is shown disabled WITH the reason instead of being sent
//   to fail. A still-loading book is allowed; the check pass below decides.
// - Nothing is created until every profile's warnings have been SEEN. One
//   preview is shown in the panel (the active profile); the others are
//   computed first (the check pass), and any warnings on them -- including a
//   time-unit override, which the panel only acknowledged for the active
//   profile -- go into ONE review dialog. Declining creates nothing.
// - The commit pass then creates each output with its own undo entry, and
//   refuses any profile whose warnings differ from the ones just reviewed.

import { runSequentialBatch, type BatchProgress, type BatchResult } from "../../../lib/sequentialBatch";
import { computeSims, simsRequest, simsSource, type SimsParams } from "../../../lib/transformSims";
import { runTransform } from "../../../lib/transformRun";
import { actionable, needsConfirm, type TransformWarning } from "../../../lib/transformWarnings";
import type { Dataset } from "../../../lib/types";
import { askConfirm } from "../../../store/confirmDialog";

export interface SimsBatchOutput {
  id: string;
  name: string;
  warnings: TransformWarning[];
}

export type SimsBatchResult = BatchResult<SimsBatchOutput>;

export interface SimsBatchProgress extends BatchProgress {
  phase: "check" | "create";
}

export interface SimsBatchCandidate {
  id: string;
  name: string;
  /** Why this profile cannot take the current settings, or null. */
  problem: string | null;
}

/** Each dataset with the reason (if any) the batch request cannot be built
 *  for it. Pure; a pending book has no rows yet, so it is left to the check. */
export function batchCandidates(params: SimsParams | string, datasets: readonly Dataset[]): SimsBatchCandidate[] {
  return datasets.map((d) => {
    if (typeof params === "string" || d.pending) return { id: d.id, name: d.name, problem: null };
    try {
      simsRequest(params, simsSource(d));
      return { id: d.id, name: d.name, problem: null };
    } catch (e) {
      return { id: d.id, name: d.name, problem: e instanceof Error ? e.message : "incompatible" };
    }
  });
}

const sameWarnings = (a: readonly TransformWarning[], b: readonly TransformWarning[]): boolean =>
  a.length === b.length && a.every((w, i) => w.code === b[i].code && w.text === b[i].text);

/** The single review for every profile whose warnings the panel has not
 *  shown. Resolves true when there is nothing to review. */
export function reviewBatchWarnings(flagged: readonly { name: string; warnings: readonly TransformWarning[] }[]): Promise<boolean> {
  if (!flagged.length) return Promise.resolve(true);
  const units = flagged.some((f) => needsConfirm(f.warnings));
  const lines = flagged.flatMap((f) => [f.name, ...actionable(f.warnings).map((w) => `  • ${w.text}`)]);
  const n = flagged.length;
  return askConfirm(
    `SIMS batch: ${n} profile${n === 1 ? " has" : "s have"} warnings`,
    lines.join("\n"),
    units ? "Create despite unit override" : "Create all",
    units,
  );
}

/** The store accessor `runTransform` takes (the caller passes `useApp.getState`). */
type StoreGet = Parameters<typeof runTransform>[0];

export interface RunSimsBatchOptions {
  store: StoreGet;
  params: SimsParams;
  items: readonly { id: string; name: string }[];
  /** The profile previewed in the panel: its warnings were already shown. */
  previewedId: string;
  signal: AbortSignal;
  onProgress: (p: SimsBatchProgress) => void;
}

/** Check every profile, review the unseen warnings once, then create. Returns
 *  null when the review was declined (nothing was created). */
export async function runSimsBatch(o: RunSimsBatchOptions): Promise<SimsBatchResult[] | null> {
  const checks = await runSequentialBatch(
    o.items,
    async (item) => {
      const ds = await o.store().resolveDataset(item.id);
      if (!ds) throw new Error("the input dataset is unavailable");
      return (await computeSims(o.params, { id: ds.id, name: ds.name, data: simsSource(ds) })).warnings;
    },
    { signal: o.signal, onProgress: (p) => o.onProgress({ ...p, phase: "check" }) },
  );
  // A Stop during the check pass stops the whole batch: nothing was created.
  if (checks.some((c) => c.status === "stopped")) {
    return checks.map((c) => (c.status === "failed" ? c : { item: c.item, status: "stopped" }));
  }
  const reviewed = new Map(checks.flatMap((c) => (c.status === "created" ? [[c.item.id, c.value] as const] : [])));
  const flagged = checks.flatMap((c) =>
    c.status === "created" && c.item.id !== o.previewedId && actionable(c.value).length
      ? [{ name: c.item.name, warnings: c.value }]
      : [],
  );
  if (!(await reviewBatchWarnings(flagged))) return null;

  const made = await runSequentialBatch(
    o.items.filter((item) => reviewed.has(item.id)),
    async (item) => {
      const expected = reviewed.get(item.id) ?? [];
      const out = await runTransform(o.store, o.params, item.id, (pv) =>
        Promise.resolve(sameWarnings(pv.warnings, expected)),
      );
      if (!out) throw new Error("its warnings changed after the review; nothing was created for it");
      return { id: out.id, name: out.name, warnings: out.warnings };
    },
    { signal: o.signal, onProgress: (p) => o.onProgress({ ...p, phase: "create" }) },
  );
  const byId = new Map(made.map((r) => [r.item.id, r]));
  return checks.map((c) => (c.status === "failed" ? c : (byId.get(c.item.id) ?? { item: c.item, status: "stopped" })));
}

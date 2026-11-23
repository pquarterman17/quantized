// Reflectivity fit curves and DREAM bands: the C9 input record of the worksheets they
// become (result-lifecycle acceptance, criterion 9; audit rows 26 and 27). Pure.
//
// The fit reads each source's X from the worksheet's own time axis (Q, or 2θ that
// `buildChannel` converts) and sends only the rows it kept: not excluded/filtered,
// finite, inside the Q window, usable for the weighting. The record therefore uses
// `xKey: null` and, as each source's view, EXACTLY those rows, found by rebuilding
// the channel the way the fit sent it. It is written only while that rebuild still
// matches the digest stored with the fit; against changed data the fit's inputs
// cannot be restated, so NO record is written (fail closed, never a guess).
//
// Recorded only: `metadata.inputs` is never read for identity (the duplicate guard
// is `existingFitDatasetIds`, by `reflFit.fitId`), so a curve worksheet saved before
// this record existed still matches an identical re-add.

import type { AnalysisResultValue } from "../../../lib/analysisResult";
import { recordedInputs } from "../../../lib/resultInputsRecord";
import { droppedRows } from "../../../lib/rowstate";
import type { DataStruct, Dataset } from "../../../lib/types";
import { buildChannel } from "./reflFitData";
import { channelDigest, recordDatasetIds, type ReflFitRecord } from "./reflFitRecord";
import { resolveBinding } from "./reflFitRestore";

/** What can be said about a record's fitted data against the live library:
 *  "current" (the inputs, restated), "unverified" (cannot be judged YET: a lazy
 *  source not loaded, or a channel stored without a digest), "changed" (a
 *  source is gone, its columns moved, or its rows no longer match the digest).
 *  "changed" wins over "unverified" when both apply. */
export type FitInputsState =
  | { state: "current"; inputs: AnalysisResultValue }
  | { state: "unverified" }
  | { state: "changed" };

export function fitInputsState(record: ReflFitRecord, datasets: readonly Dataset[]): FitInputsState {
  const sources: Dataset[] = [];
  const views: DataStruct[] = [];
  let unverified = false;
  for (const id of recordDatasetIds(record)) {
    const ds = datasets.find((d) => d.id === id);
    if (!ds) return { state: "changed" };
    if (ds.pending) { unverified = true; continue; }
    const rows = new Set<number>();
    const dropped = droppedRows(ds);
    const { settings, weighting } = record.request;
    let n = 0;
    for (const ch of record.request.channels) {
      n++;
      if (ch.datasetId !== id) continue;
      const binding = resolveBinding(ch, ds, n);
      if (typeof binding === "string") return { state: "changed" };
      if (!ch.digest) { unverified = true; continue; }
      try {
        const sent = buildChannel(ds.data, dropped, binding, settings, weighting, ch.lambda, "");
        if (channelDigest(sent.channel) !== ch.digest) return { state: "changed" };
        for (const row of sent.rows) rows.add(row);
      } catch {
        return { state: "changed" };
      }
    }
    const keep = [...rows].sort((a, b) => a - b);
    sources.push(ds);
    views.push({ ...ds.data, time: keep.map((r) => ds.data.time[r]), values: keep.map((r) => ds.data.values[r]) });
  }
  if (unverified || !sources.length) return { state: "unverified" };
  return { state: "current", inputs: recordedInputs(sources, { xKey: null, views }) };
}

/** `recordedInputs` for the sources of `record`, or undefined (see the header). */
export function fitInputsRecord(record: ReflFitRecord, datasets: readonly Dataset[]): AnalysisResultValue | undefined {
  const verdict = fitInputsState(record, datasets);
  return verdict.state === "current" ? verdict.inputs : undefined;
}

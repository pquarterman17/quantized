// SIMS profile comparison as a recordable transform (audit P2.3, box 3). The
// `simscompare` op of lib/transformRun: several profiles' chosen species laid
// side by side in ONE derived table (`calc.sims_compare`: row blocks, one
// column per profile × species, nothing interpolated), so a log-y plot can
// overlay them — same species across samples, or several species of one.
//
// Species are recorded BY NAME (a replay onto files with another column order
// picks the same species); the other profiles are dataset REFERENCES
// (`with`, the pipeline's one reference model, like merge's), resolved or
// refused by name on replay. The primary input is the run's target when it
// was the active dataset at recording, as for every transform.
//
// The comparison's decade offsets are NOT part of this step: they are the
// plot's own per-series style (`SeriesStyle.logOffset`, lib/logOffset.ts), so
// they persist with the window/figure and never alter the table. Lazy: only
// the workshop and the transform runner import this.

import { compareSims } from "./api/sims";
import { blanksToNaN } from "./blankCells";
import { lit } from "./macro";
import type { DatasetRef } from "./transformRun";
import { simsWarningOf, simsWireDataset } from "./transformSims";
import type { TransformWarning } from "./transformWarnings";
import type { DataStruct, SeriesStyle } from "./types";
import type { AppState } from "../store/useApp";

export interface SimsCompareParams {
  op: "simscompare";
  /** Species (column names) to compare; each profile gives those it has. */
  species: string[];
  /** The OTHER profiles (the primary is the transform's input). */
  with: DatasetRef[];
}

export interface SimsCompareComputed {
  data: DataStruct;
  name: string;
  warnings: TransformWarning[];
  traces: Record<string, unknown>[];
}

const stem = (name: string): string => name.replace(/\.[^.]+$/, "");

export function simsCompareLabel(p: SimsCompareParams, primaryName: string): string {
  const n = p.with.length + 1;
  return `SIMS compare ${p.species.join(", ")} across ${n} profile${n === 1 ? "" : "s"} (${primaryName}${p.with.length ? ", …" : ""})`;
}

export function simsCompareOutputName(primaryName: string, others: number): string {
  return others ? `${stem(primaryName)} + ${others} (SIMS comparison)` : `${stem(primaryName)} (SIMS comparison)`;
}

/** THE compute for the workshop's live preview, the commit and the replay:
 *  `profiles[0]` is the primary. Throws the backend's refusal message. */
export async function computeSimsCompare(
  p: SimsCompareParams,
  profiles: readonly { id: string; name: string; data: DataStruct }[],
  opts: { signal?: AbortSignal } = {},
): Promise<SimsCompareComputed> {
  const res = await compareSims(
    { profiles: profiles.map((d) => ({ name: d.name, dataset: simsWireDataset(d.data) })), species: p.species },
    opts.signal,
  );
  const sources = profiles.map((d) => ({ id: d.id, name: d.name }));
  return {
    // Blanks (every cell outside a trace's own block) arrive as JSON null;
    // stored as NaN so the .dwk reopens (lib/blankCells.ts).
    data: blanksToNaN({ ...res.dataset, metadata: { ...res.dataset.metadata, sims_compare_sources: sources } }),
    name: simsCompareOutputName(profiles[0]?.name ?? "", profiles.length - 1),
    warnings: res.warnings.map(simsWarningOf),
    traces: res.traces,
  };
}

/** After a comparison was created: stagger its traces by `k` decades each
 *  (trace c drawn at y · 10^(c·k)) on the plot now showing it, with a log y
 *  axis, as ONE undo entry of its own (the offsets are the plot's series
 *  styles, not the table — lib/logOffset.ts). A no-op returning false when
 *  `k` is 0 or the plot is no longer showing `datasetId`. The store is
 *  injected (`useApp.getState` / `useApp.setState`), as `runTransform`'s is. */
export function staggerComparison(
  get: () => AppState,
  set: (fn: (st: AppState) => Partial<AppState>) => void,
  datasetId: string,
  k: number,
): boolean {
  const s = get();
  const made = s.datasets.find((d) => d.id === datasetId);
  if (!k || !made || s.activeId !== datasetId) return false;
  s.recordHistory("offset curves by decades");
  set((st) => {
    const next: Record<number, SeriesStyle> = { ...st.seriesStyles };
    made.data.labels.forEach((_, c) => { next[c] = { ...next[c], logOffset: c === 0 ? 0 : c * k }; });
    return { seriesStyles: next, yScale: "log" };
  });
  // Finding 7: `yScale` is set on the raw `set()` above (so the whole stagger
  // stays ONE undo entry, per this function's own doc), which bypasses
  // `setYScale`'s own `recordMacro` call -- a recorded macro would replay the
  // offsets but never the log axis they need. Record the SAME step
  // `setYScale("log")` would, without calling the action itself (which would
  // push a second, unwanted history entry).
  get().recordMacro("Y axis log", `qz.setYScale(${lit("log")})`);
  return true;
}

/** Validate a recorded `simscompare` step (user-editable JSON), or throw. */
export function simsCompareParamsOf(raw: Record<string, unknown>): SimsCompareParams {
  const sp = raw.species;
  if (!Array.isArray(sp) || !sp.length || !sp.every((s) => typeof s === "string" && s.trim())) {
    throw new Error('simscompare "species" must list column names');
  }
  const w = raw.with ?? [];
  if (!Array.isArray(w)) throw new Error('simscompare "with" must list the other profiles');
  const refs = w.map((v) => {
    const o = (v ?? {}) as Record<string, unknown>;
    if (typeof o.id !== "string" || !o.id) throw new Error("simscompare has a recorded profile with no id");
    return { id: o.id, name: typeof o.name === "string" ? o.name : o.id };
  });
  return { op: "simscompare", species: sp as string[], with: refs };
}

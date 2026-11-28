// The Stat Stage's faceted compute (one draw per level of the "facet by" column), moved out of
// `useStatStage.ts` (its 500-line ceiling) when the item 20 variants joined the box family.
// Box / violin / strip draw each slice through `computeFacetGroupDraws`, bar through
// `computeFacetBarDraws`, the variants through `computeFacetVariantDraws`. The hook owns the
// state: it passes the writers in `sink` and keeps the cancel flag.

import type { FacetSlice } from "../../lib/facet";
import type { StatMarksMode } from "../../lib/plotviewSanitize";
import { computeFacetVariantDraws, type FacetVariant, type FacetVariantOpts } from "./statFacetVariants";
import { computeFacetBarDraws, computeFacetGroupDraws, type FacetDraw } from "./useStatStageCompute";

export interface FacetComputeInputs {
  slices: readonly FacetSlice[];
  /** Box / violin / strip / bar, or null for a variant. */
  marksMode: StatMarksMode | null;
  variant: FacetVariant | null;
  groupCol: number | null;
  nestCol: number | null;
  nestLabel: string | null;
  valueCol: number;
  plotted: readonly number[];
  valueLabel: string;
  groupLabel: string;
  /** The analysis view's row ids when the panels draw raw points (null: no points). */
  points: { rowIds: readonly number[] | null } | null;
  bar: {
    channels: readonly number[];
    labels: readonly string[];
    valueLabel: string;
    stack: boolean;
    errChannels: readonly (number | null)[];
    raw: { rowIds: readonly number[] | null } | null;
  };
  variantOpts: FacetVariantOpts;
}

/** The writers of the hook's state, and its cancel flag. */
export interface FacetSink {
  cancelled: () => boolean;
  set: (facets: FacetDraw[] | null) => void;
  setError: (message: string | null) => void;
  setNote: (message: string | null) => void;
  setBusy: (busy: boolean) => void;
  fail: (e: unknown) => void;
}

/** Computes the panels and hands them to `sink` (never after `sink.cancelled()`). */
export function runFacetCompute(p: FacetComputeInputs, sink: FacetSink): void {
  const finish = (results: FacetDraw[], skipped: readonly string[] = []) => {
    if (sink.cancelled()) return;
    if (results.length === 0) {
      sink.set(null);
      sink.setError(skipped.length ? `no panel can be drawn (${skipped.join("; ")})` : "no finite values to group");
    } else {
      sink.set(results);
      sink.setNote(skipped.length ? `not drawn: ${skipped.join("; ")}` : null);
    }
  };
  if (p.marksMode === "bar") {
    // Synchronous (no backend round-trip) — mirrors the flat bar branch.
    const b = p.bar;
    finish(computeFacetBarDraws(
      p.slices, p.groupCol, b.channels, b.labels, p.valueCol, p.plotted, b.valueLabel, b.stack, p.groupLabel, b.raw, b.errChannels,
    ));
    return;
  }
  sink.setBusy(true);
  const done = () => !sink.cancelled() && sink.setBusy(false);
  if (p.variant) {
    void computeFacetVariantDraws(p.slices, p.variant, p.variantOpts)
      .then((r) => finish(r.facets, r.skipped))
      .catch(sink.fail)
      .finally(done);
    return;
  }
  void computeFacetGroupDraws(
    p.slices, p.marksMode as "box" | "violin" | "strip", p.groupCol, p.valueCol, p.plotted, p.valueLabel, p.groupLabel, p.nestCol, p.nestLabel,
    p.points,
  )
    .then((r) => finish(r))
    .catch(sink.fail)
    .finally(done);
}

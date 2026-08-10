// Peak-anchored radial/transverse cut helpers (RSM_CUTS_PLAN item 7 — the
// two-click epitaxial deliverable). Pure, DOM-free, and API-free: given an
// already-resolved RSM DataStruct and one of its `rsm_analyze` peaks, builds
// the cut-ruler (`lib/roi.ts::radialRulerForPeak`, unmodified) and the
// relabeling this module owns — the backend's `box_cut` label is a generic
// "Box x=[...] @angle deg" string with no notion of "radial"/"transverse"
// or which peak, so the caller (workshops/rsm/useRsm.ts) overwrites
// `metadata.cut_label` with a physics-legible one AFTER the cut lands,
// BEFORE adding it to the library — the same `{...ds, metadata: {...}}`
// pattern `useHysteresis.ts`/`useMagTools.ts` already use for a post-hoc
// metadata patch.
//
// "Radial" = along the scattering vector Q (d-spacing / strain); "transverse"
// = perpendicular to it (mosaic / tilt) — the standard epitaxial RSM pair
// (Resolved decisions, RSM_CUTS_PLAN rev 2).

import type { RoiRuler } from "./roi";
import { radialRulerForPeak } from "./roi";
import type { DataStruct, RsmPeak } from "./types";

export type PeakCutKind = "radial" | "transverse";

/** True only when a peak carries a finite reciprocal-space centre —
 *  `radialRulerForPeak`'s own null gate, exposed standalone so a caller (the
 *  RSM panel's disabled-state check) doesn't need to build a throwaway
 *  ruler just to ask "can I cut through this peak at all?". */
export function peakHasQCentre(peak: RsmPeak): boolean {
  const [qx, qz] = peak.centre_Q;
  return qx != null && qz != null && Number.isFinite(qx) && Number.isFinite(qz);
}

/** The peak-anchored actions' default target (Resolved decisions: "film peak
 *  as default") — falls back to the brightest/first peak when no peak is
 *  classified "film" (mirrors `useRsm.ts::strainPair`'s own substrate
 *  fallback style). Null for an empty list. */
export function defaultPeakForCut(peaks: readonly RsmPeak[]): RsmPeak | null {
  return peaks.find((p) => p.classification === "film") ?? peaks[0] ?? null;
}

/** Characteristic Q-space grid spacing for a resolved RSM dataset — the
 *  `gridCell` `radialRulerForPeak` wants for its default ruler width (3 grid
 *  cells). Estimated from the Qx/Qz column extents divided by the map's own
 *  `map_shape` (falling back to a square-root guess when `map_shape` is
 *  absent, and to `1` when there is no finite Q extent at all — the same
 *  "never throw mid-preview" posture `lib/roiMath.ts` takes). Kept out of
 *  `lib/roi.ts` (that module is geometry-only, no dataset-shape inspection). */
export function estimateQGridCell(ds: DataStruct): number {
  const qx = ds.labels.indexOf("Qx");
  const qz = ds.labels.indexOf("Qz");
  if (qx < 0 || qz < 0 || ds.values.length === 0) return 1;

  let xMin = Infinity;
  let xMax = -Infinity;
  let zMin = Infinity;
  let zMax = -Infinity;
  for (const row of ds.values) {
    const x = row[qx]!;
    const z = row[qz]!;
    if (Number.isFinite(x)) {
      if (x < xMin) xMin = x;
      if (x > xMax) xMax = x;
    }
    if (Number.isFinite(z)) {
      if (z < zMin) zMin = z;
      if (z > zMax) zMax = z;
    }
  }
  if (!Number.isFinite(xMin) || !Number.isFinite(zMin)) return 1;

  const shape = ds.metadata?.["map_shape"];
  const n = ds.values.length;
  const [rows, cols] =
    Array.isArray(shape) && shape.length === 2
      ? [Number(shape[0]), Number(shape[1])]
      : [Math.sqrt(n), Math.sqrt(n)];

  const cellX = cols > 1 ? (xMax - xMin) / (cols - 1) : xMax - xMin || 1;
  const cellZ = rows > 1 ? (zMax - zMin) / (rows - 1) : zMax - zMin || 1;
  const cell = (Math.abs(cellX) + Math.abs(cellZ)) / 2;
  return cell > 0 ? cell : 1;
}

/** Build the radial/transverse ruler for `peak` over the resolved dataset
 *  `ds` (its Qx/Qz columns feed `estimateQGridCell`'s width estimate) — null
 *  when the peak has no finite Q centre, same as `radialRulerForPeak`. */
export function buildPeakRuler(ds: DataStruct, peak: RsmPeak, kind: PeakCutKind): RoiRuler | null {
  return radialRulerForPeak(peak, kind, estimateQGridCell(ds));
}

/** The physics-legible label (deliverable requirement: "distinguishable at a
 *  glance ... which peak") — e.g. "Radial cut — film peak (rank 1)". */
export function peakCutLabel(peak: RsmPeak, kind: PeakCutKind): string {
  const dir = kind === "radial" ? "Radial" : "Transverse";
  return `${dir} cut — ${peak.classification} peak (rank ${peak.rank})`;
}

/** Overwrite a just-landed cut's `metadata.cut_label` (read by
 *  `lib/mapcuts.ts::cutName` for the library display name AND by any
 *  caption/provenance reader downstream) with `peakCutLabel`'s text, and
 *  tag the peak's own classification/kind alongside it so a caption or a
 *  future batch table can group by either without re-parsing the label
 *  string. Applied AFTER the backend response, never sent as a request
 *  field — `box_cut` has no notion of "radial"/"transverse"/peak identity. */
export function withPeakCutLabel(ds: DataStruct, peak: RsmPeak, kind: PeakCutKind): DataStruct {
  return {
    ...ds,
    metadata: {
      ...ds.metadata,
      cut_label: peakCutLabel(peak, kind),
      rsm_cut_kind: kind,
      rsm_peak_classification: peak.classification,
      rsm_peak_rank: peak.rank,
    },
  };
}

// Reflectivity fit — the fitted CURVES (P2.2 slice 3 follow-up). Pure: no
// React, no store. A fit's per-channel model curves and SLD profiles are
// stored with its record (reflFitRecord.ts `SavedCurves`), so a saved fit can
// overlay its model on the data and "Add fit curves" without re-running. This
// module decimates them for storage, turns live or saved curves into library
// datasets (named, placed and provenanced for the fit), and aligns a saved
// channel-0 curve back onto the dataset's rows for the overlay.
//
// Stored numbers go through the record's BUG-017 sentinel codec
// (`encodeRecord`), so NaN/±Infinity survive a .dwk round trip; a model point
// the fit did not report stays null.

import type { ReflFitResult } from "../../../lib/api/reflectivity";
import { droppedRows } from "../../../lib/rowstate";
import type { DataStruct, Dataset, FitOverlay } from "../../../lib/types";
import { alignToRows, buildChannel } from "./reflFitData";
import {
  channelDigest,
  recordDatasetIds,
  type ReflFitRecord,
  type SavedChannelCurve,
  type SavedCurves,
  type SavedSldProfile,
} from "./reflFitRecord";
import { resolveBinding } from "./reflFitRestore";

/** At most this many points per stored curve. Reflectometry scans are a few
 *  hundred points; this bounds a record (4 channels + SLD) for a .dwk and for
 *  autosave's browser storage. Longer curves are thinned evenly, keeping both
 *  ends, and the record says so (`total`). */
export const MAX_CURVE_POINTS = 2000;

/** Evenly spaced indices into `n` points, `max` of them including both ends;
 *  null when all `n` fit. */
export function decimateIndices(n: number, max = MAX_CURVE_POINTS): number[] | null {
  if (n <= max) return null;
  return Array.from({ length: max }, (_, i) => Math.round((i * (n - 1)) / (max - 1)));
}

function pick<T>(xs: readonly T[], idx: number[] | null): T[] {
  return idx ? idx.map((i) => xs[i]) : [...xs];
}

/** The fit response's curves in their stored form, decimated if needed. */
export function savedCurves(res: Pick<ReflFitResult, "curves" | "sld_profiles">, max = MAX_CURVE_POINTS): SavedCurves {
  return {
    channels: res.curves.map((c): SavedChannelCurve => {
      const idx = decimateIndices(c.q.length, max);
      return { label: c.label, spin: c.spin, q: pick(c.q, idx), r: pick(c.r, idx), model: pick(c.model, idx), total: c.q.length };
    }),
    sld: res.sld_profiles.map((p): SavedSldProfile => {
      const idx = decimateIndices(p.z.length, max);
      return { spin: p.spin, z: pick(p.z, idx), sld: pick(p.sld, idx), total: p.z.length };
    }),
  };
}

/** Is any stored curve thinned? A human-readable note, or null. */
export function decimationNote(curves: SavedCurves): string | null {
  const thinned = [...curves.channels, ...curves.sld].filter((c) => c.total > ("q" in c ? c.q.length : c.z.length));
  if (!thinned.length) return null;
  const c = thinned[0];
  const kept = "q" in c ? c.q.length : c.z.length;
  return `stored curves are thinned to ${kept} of ${c.total} points${thinned.length > 1 ? ` (${thinned.length} curves)` : ""}`;
}

// ── fit-curve datasets ───────────────────────────────────────────────────────

/** Name, placement and provenance for the datasets "Add fit curves" makes
 *  from `record`: named for the fit ("<source> — refl fit #n model"), placed
 *  in the source's workbook/folder, and pointing back at the source datasets
 *  and the record id in `metadata.reflFit` (the Freeze Copy precedent). */
export function curveDatasetFor(record: ReflFitRecord, datasets: readonly Dataset[]) {
  const first = record.request.channels[0];
  const host = datasets.find((d) => d.id === first.datasetId);
  const ids = recordDatasetIds(record);
  const base = `${host?.name ?? first.datasetName} — refl fit #${record.seq}`;
  const provenance = {
    fitId: record.id,
    seq: record.seq,
    fittedAt: record.fittedAt,
    sourceIds: ids,
    sourceNames: ids.map((id) => datasets.find((d) => d.id === id)?.name ?? record.request.channels.find((c) => c.datasetId === id)?.datasetName ?? ""),
  };
  const placement = {
    ...(host?.workbookId ? { workbookId: host.workbookId } : {}),
    ...(host?.folderId ? { folderId: host.folderId } : {}),
  };
  return {
    base,
    placement,
    metadata: (extra: Record<string, unknown>): DataStruct["metadata"] => ({
      source: "reflectivity-fit",
      reflFit: provenance,
      weighting: record.result.weighting,
      radiation: record.model.radiation,
      ...extra,
    }),
  };
}

/** Curves as either a live response or a saved record carries them. */
export interface CurvesLike {
  channels: { label: string; spin: "+" | "-" | null; q: number[]; r: number[]; model: (number | null)[]; total?: number }[];
  sld: { spin: "+" | "-" | null; z: number[]; sld: (number | null)[]; total?: number }[];
}

export function liveCurves(res: Pick<ReflFitResult, "curves" | "sld_profiles">): CurvesLike {
  return { channels: res.curves, sld: res.sld_profiles };
}

export interface CurveDataset {
  name: string;
  data: DataStruct;
  placement: { workbookId?: string; folderId?: string };
}

/** The library datasets for a fit's curves: one "model" per channel (R and
 *  R fit on the fitted Q points) and one per SLD profile. `record` null (a
 *  live fit whose record could not be stored) names them generically. */
export function curveDatasets(
  curves: CurvesLike,
  record: ReflFitRecord | null,
  datasets: readonly Dataset[],
  fallback: { weighting: string; radiation: string },
): CurveDataset[] {
  const out = record ? curveDatasetFor(record, datasets) : null;
  const base = out?.base ?? "Reflectivity fit";
  const placement = out?.placement ?? {};
  const meta = (extra: Record<string, unknown>): DataStruct["metadata"] =>
    out ? out.metadata(extra) : { source: "reflectivity-fit", ...fallback, ...extra };
  const thinned = (n: number, total: number | undefined) => (total && total > n ? { decimated: { kept: n, total } } : {});
  const many = curves.channels.length > 1;
  return [
    ...curves.channels.map((c, i) => ({
      name: `${base} model${many ? ` (${c.spin ?? `channel ${i + 1}`})` : ""}`,
      placement,
      data: {
        time: c.q,
        values: c.q.map((_, k) => [c.r[k], c.model[k] ?? Number.NaN]),
        labels: ["R", "R fit"],
        units: ["", ""],
        metadata: meta({ spin: c.spin, channel: i + 1, ...thinned(c.q.length, c.total) }),
      },
    })),
    ...curves.sld.map((p) => ({
      name: `${base} SLD${p.spin ? ` (${p.spin})` : ""}`,
      placement,
      data: {
        time: p.z,
        values: p.sld.map((v) => [v ?? Number.NaN]),
        labels: ["SLD"],
        units: ["Å⁻²"],
        metadata: meta({ spin: p.spin, ...thinned(p.z.length, p.total) }),
      },
    })),
  ];
}

// ── the saved overlay ────────────────────────────────────────────────────────

/** A saved fit's channel-1 model aligned onto its dataset's rows (the same
 *  overlay a live fit draws), or why it cannot be drawn. Drawn only while the
 *  channel would send exactly the points it sent then — against changed data
 *  the stored model belongs to different points. A thinned curve overlays
 *  only its stored points. */
export function savedOverlay(record: ReflFitRecord, datasets: readonly Dataset[]): FitOverlay | string {
  const curve = record.curves?.channels[0];
  if (!curve) return "fit curves were not stored with this fit — re-run it to plot them";
  const ch = record.request.channels[0];
  const ds = datasets.find((d) => d.id === ch.datasetId);
  const b = resolveBinding(ch, ds, 1);
  if (typeof b === "string") return b;
  const data = (ds as Dataset).data;
  const { settings, weighting } = record.request;
  let sent;
  try {
    sent = buildChannel(data, droppedRows(ds as Dataset), b, settings, weighting, ch.lambda, "");
  } catch {
    return `the data of "${(ds as Dataset).name}" changed since this fit — re-run it to overlay`;
  }
  // The same digest the "data changed" flag compares (reflFitRestore.ts).
  const same = ch.digest ? channelDigest(sent.channel) === ch.digest : sent.channel.q.length === curve.total;
  if (!same) return `the data of "${(ds as Dataset).name}" changed since this fit — re-run it to overlay`;
  return { datasetId: ch.datasetId, y: alignToRows(curve, { q: sent.channel.q, rows: sent.rows }, data.time.length) };
}

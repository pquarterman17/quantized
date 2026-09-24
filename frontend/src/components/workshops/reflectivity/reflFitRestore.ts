// Reflectivity fit — reading a saved record back (P2.2 slice 3). Pure: the
// record module (reflFitRecord.ts) owns the stored form; this owns what a
// saved fit means against the LIVE library — is each channel's dataset still
// there, do its columns still sit where they did, did its data change, and
// what setup does "Restore fit setup" load.

import { droppedRows } from "../../../lib/rowstate";
import type { Dataset, SldPreset } from "../../../lib/types";
import { buildChannel, channelLambda, type ChannelBinding, type FitDataSettings } from "./reflFitData";
import { applyResults, type FitGlobals, type ParamOverrides } from "./reflFitModel";
import { channelDigest, type ReflFitRecord, type SavedChannel } from "./reflFitRecord";
import type { ModelLayer, Radiation } from "./useReflectivity";

/** The column now carrying `label`, preferring the saved index. null when the
 *  label is gone or ambiguous — a restore never guesses a column. */
function column(labels: readonly string[], saved: number, label: string): number | null {
  if (labels[saved] === label) return saved;
  const hits = labels.flatMap((l, i) => (l === label ? [i] : []));
  return hits.length === 1 ? hits[0] : null;
}

/** A saved channel's binding against the live dataset, or why it cannot be
 *  restored. Columns are matched by the LABEL saved with them. */
export function resolveBinding(ch: SavedChannel, ds: Dataset | undefined, n: number): ChannelBinding | string {
  if (!ds) return `channel ${n}: its dataset "${ch.datasetName}" is no longer in the library`;
  if (ds.pending) return `channel ${n}: "${ds.name}" has not finished loading`;
  const labels = ds.data.labels;
  const rCol = column(labels, ch.rCol, ch.rLabel);
  const drCol = ch.drCol == null || ch.drLabel == null ? null : column(labels, ch.drCol, ch.drLabel);
  const dqCol = ch.dqCol == null || ch.dqLabel == null ? null : column(labels, ch.dqCol, ch.dqLabel);
  if (rCol == null || (ch.drCol != null && drCol == null) || (ch.dqCol != null && dqCol == null)) {
    return `channel ${n}: a column of "${ds.name}" it used is missing or renamed`;
  }
  return { datasetId: ch.datasetId, rCol, drCol, dqCol, dqIsFwhm: ch.dqIsFwhm, spin: ch.spin };
}

export interface RecordIssues {
  /** A channel cannot be restored (dataset deleted, column gone). */
  missing: string[];
  /** A channel's data would send different points today. */
  changed: string[];
}

// The answer depends only on the record and its channels' dataset objects, so
// it is cached against exactly those: an edit to some OTHER dataset in the
// library does not re-run the digests (each rebuilds a channel, O(rows)).
const issuesCache = new WeakMap<ReflFitRecord, { refs: (Dataset | undefined)[]; out: RecordIssues }>();

/** What the live library says about a saved record. A pending (not yet
 *  fetched) dataset is neither missing nor changed: it is unknown. */
export function recordIssues(record: ReflFitRecord, datasets: readonly Dataset[]): RecordIssues {
  const refs = record.request.channels.map((ch) => datasets.find((d) => d.id === ch.datasetId));
  const hit = issuesCache.get(record);
  if (hit && hit.refs.every((r, i) => r === refs[i])) return hit.out;
  const out: RecordIssues = { missing: [], changed: [] };
  const { settings, weighting } = record.request;
  record.request.channels.forEach((ch, i) => {
    const ds = refs[i];
    if (ds?.pending) return;
    const b = resolveBinding(ch, ds, i + 1);
    if (typeof b === "string") {
      out.missing.push(b);
      return;
    }
    const data = (ds as Dataset).data;
    let digest = "";
    try {
      const lam = settings.xKind === "twotheta" ? channelLambda(settings, data) : null;
      digest = channelDigest(buildChannel(data, droppedRows(ds as Dataset), b, settings, weighting, lam, "").channel);
    } catch {
      /* no longer buildable: that is a change too */
    }
    if (ch.digest && digest !== ch.digest) out.changed.push(`channel ${i + 1}: the data of "${(ds as Dataset).name}" changed since this fit`);
  });
  issuesCache.set(record, { refs, out });
  return out;
}

export interface RestoredSetup {
  layers: ModelLayer[];
  radiation: Radiation;
  overrides: ParamOverrides;
  globals: FitGlobals;
  channels: ChannelBinding[];
  settings: FitDataSettings;
  /** Channels that could not be restored, with the reason. */
  skipped: string[];
}

/** The Fit view's state as it was when `record` ran. The layer snapshot gets
 *  the SENT parameter values written over it, so a preset whose SLD has since
 *  changed restores as a manual row carrying the value actually fitted from
 *  (with no presets loaded yet, the snapshot is used as-is). */
export function restoreSetup(
  record: ReflFitRecord,
  datasets: readonly Dataset[],
  presets: SldPreset[],
): RestoredSetup | string {
  const { layers, radiation } = record.model;
  const skipped: string[] = [];
  const channels: ChannelBinding[] = [];
  record.request.channels.forEach((ch, i) => {
    const b = resolveBinding(ch, datasets.find((d) => d.id === ch.datasetId), i + 1);
    if (typeof b === "string") skipped.push(b);
    else channels.push(b);
  });
  if (channels.length === 0) return `cannot restore this fit: ${skipped.join("; ")}`;
  const byName: ParamOverrides["byName"] = {};
  for (const p of record.request.parameters) byName[p.name] = { vary: p.vary, min: p.min, max: p.max, tie: p.tie ?? "" };
  const value = (n: string, d: number): number => record.request.parameters.find((p) => p.name === n)?.value ?? d;
  return {
    layers: presets.length ? applyResults(layers, presets, radiation, record.request.parameters) : layers,
    radiation,
    overrides: { layerCount: layers.length, byName },
    globals: { scale: value("scale", 1), background: value("background", 0) },
    channels,
    settings: { ...record.request.settings },
    skipped,
  };
}

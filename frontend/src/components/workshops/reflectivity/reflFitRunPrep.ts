// Reflectivity fit — the request half of a run (split from useReflFit.ts, lane
// WB5): resolve each bound dataset, build its channel exactly as the fit sends
// it, and the saved description of that channel (labels, lambda, digest) the
// record keeps. Pure of React.

import { droppedRows } from "../../../lib/rowstate";
import type { Dataset } from "../../../lib/types";
import { datasetInputsToken } from "../workbench/inputsKey";
import { buildChannel, channelLambda, type BuiltChannel, type ChannelBinding, type FitDataSettings, type Weighting } from "./reflFitData";
import { channelDigest, type ReflFitRecord } from "./reflFitRecord";

/** Every SETTING a fit result depends on: the bindings, the data settings, the
 *  parameter table as sent (values, bounds, fixed, ties) and the graded layers.
 *  A different key = an out-of-date result. (The bound data is judged apart,
 *  by `ranDataStale`: a deleted dataset leaves its fit usable, as it always did.) */
export function reflFitKey(
  channels: readonly ChannelBinding[],
  settings: FitDataSettings,
  sentParams: unknown,
  sentGraded: unknown,
): string {
  return JSON.stringify([channels, settings, sentParams, sentGraded]);
}

/** The rows / data identity of each bound dataset (those present). */
export function boundDataTokens(channels: readonly ChannelBinding[], datasets: readonly Dataset[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of new Set(channels.map((c) => c.datasetId))) {
    const d = datasets.find((x) => x.id === id);
    if (d) out[id] = datasetInputsToken(d);
  }
  return out;
}

/** A bound dataset still in the library whose rows / data are not the ones the fit ran on. */
export function ranDataStale(ran: Record<string, string> | null, datasets: readonly Dataset[]): boolean {
  return ran !== null && Object.entries(ran).some(([id, token]) => {
    const d = datasets.find((x) => x.id === id);
    return d !== undefined && datasetInputsToken(d) !== token;
  });
}

export interface PreparedRun {
  built: BuiltChannel[];
  /** Each dataset's full row count (the overlay is aligned back onto it). */
  sizes: number[];
  saved: ReflFitRecord["request"]["channels"];
  /** A dataset was a lazy preview when the run began (its install moves the data identity). */
  hadPending: boolean;
}

export async function prepareRunChannels(
  channels: readonly ChannelBinding[],
  datasets: readonly Dataset[],
  resolve: (id: string) => Promise<Dataset | undefined>,
  settings: FitDataSettings,
  weighting: Weighting,
): Promise<PreparedRun> {
  const built: BuiltChannel[] = [];
  const sizes: number[] = [];
  const saved: ReflFitRecord["request"]["channels"] = [];
  const hadPending = channels.some((b) => datasets.find((d) => d.id === b.datasetId)?.pending !== undefined);
  for (const [i, b] of channels.entries()) {
    const ds = await resolve(b.datasetId);
    if (!ds) throw new Error(`channel ${i + 1}: its dataset is no longer in the library`);
    const labels = ds.data.labels;
    const label = `${ds.name} · ${labels[b.rCol] ?? "R"}${b.spin === "none" ? "" : ` (${b.spin})`}`;
    const lam = settings.xKind === "twotheta" ? channelLambda(settings, ds.data) : null;
    const one = buildChannel(ds.data, droppedRows(ds), b, settings, weighting, lam, label);
    built.push(one);
    sizes.push(ds.data.time.length);
    const colLabel = (c: number | null): string | null => (c == null ? null : (labels[c] ?? ""));
    saved.push({
      ...b,
      datasetName: ds.name,
      rLabel: labels[b.rCol] ?? "",
      drLabel: colLabel(b.drCol),
      dqLabel: colLabel(b.dqCol),
      lambda: lam,
      digest: channelDigest(one.channel),
    });
  }
  return { built, sizes, saved, hadPending };
}

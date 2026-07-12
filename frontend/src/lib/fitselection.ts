// Shared plotted-channel -> fit-input bridge. Curve fitting must consume the
// same primary X/Y pair the Stage shows, after row exclusions and filters.
// Also the provenance bridge (audit P1 #3): `fitSpecFrom` records the fit's
// recipe and `fitDataForSpec` reproduces it on recompute.

import { effectiveChannels } from "./plotdata";
import { analysisData } from "./rowstate";
import type { CalcResult, Dataset, FitSpec } from "./types";

export interface FitSelection {
  x: number[];
  y: number[];
  yKey: number;
}

export function selectedFitData(
  dataset: Dataset | null | undefined,
  xKey: number | null,
  yKeys: number[] | null,
  seriesOrder: number[] | null,
): FitSelection | null {
  const data = analysisData(dataset);
  if (!dataset || !data) return null;
  const channels = effectiveChannels(
    data,
    yKeys,
    xKey,
    dataset.channelRoles,
    seriesOrder,
  );
  const yKey = channels[0];
  if (yKey === undefined) return null;
  const x = xKey == null ? data.time : data.values.map((row) => row[xKey]);
  const y = data.values.map((row) => row[yKey]);
  return { x, y, yKey };
}

/** Build a durable fit recipe (audit P1 #3) from the model, the plotted X, the
 *  fit selection (its `yKey`), and the fit result — so a later recompute
 *  reproduces the SAME channels and the workspace records what was produced. */
export function fitSpecFrom(
  model: string,
  xKey: number | null,
  sel: FitSelection,
  result: CalcResult,
): FitSpec {
  const spec: FitSpec = { model, xKey, yKey: sel.yKey };
  const params = result.params;
  if (Array.isArray(params) && params.every((v) => typeof v === "number")) {
    spec.params = params as number[];
  }
  if (typeof result.exitFlag === "number") spec.exitFlag = result.exitFlag;
  return spec;
}

/** Fit inputs for a SAVED spec on recompute: reproduce the spec's recorded
 *  channels (provenance) over the current analysis rows (#50/#53). Legacy specs
 *  without channels — or a stored channel that no longer exists after a column
 *  change — fall back to the live plotted selection. */
export function fitDataForSpec(
  dataset: Dataset | null | undefined,
  spec: FitSpec,
  liveXKey: number | null,
  liveYKeys: number[] | null,
  liveSeriesOrder: number[] | null,
): FitSelection | null {
  if (spec.xKey === undefined && spec.yKey === undefined) {
    return selectedFitData(dataset, liveXKey, liveYKeys, liveSeriesOrder);
  }
  const data = analysisData(dataset);
  if (!dataset || !data) return null;
  const width = data.labels.length;
  const yKey = spec.yKey ?? 0;
  if (yKey < 0 || yKey >= width) {
    return selectedFitData(dataset, liveXKey, liveYKeys, liveSeriesOrder);
  }
  const xKey = spec.xKey ?? null;
  const x =
    xKey == null || xKey < 0 || xKey >= width ? data.time : data.values.map((row) => row[xKey]);
  const y = data.values.map((row) => row[yKey]);
  return { x, y, yKey };
}

// Shared plotted-channel -> fit-input bridge. Curve fitting must consume the
// same primary X/Y pair the Stage shows, after row exclusions and filters.

import { effectiveChannels } from "../../../lib/plotdata";
import { analysisData } from "../../../lib/rowstate";
import type { Dataset } from "../../../lib/types";

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

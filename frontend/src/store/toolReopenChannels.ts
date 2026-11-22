// The plotted channels a batch tool ran on (lane RO2). Peak batch and Batch
// integrate read the ACTIVE dataset's plotted X/Y by column name in every
// picked dataset, so reopening one must plot the recorded channels (or say it
// cannot) before Run: otherwise the same settings would integrate whatever
// happens to be plotted. Recorded unkeyed beside the settings (`extra.channels`).

import type { ReopenSeed } from "../lib/committedOutputReopen";
import type { Dataset } from "../lib/types";

export interface RecordedChannels {
  xLabel: string | null;
  yLabel: string;
  xIndex: number | null;
  yIndex: number;
}

/** The recorded channels as `extra.channels` holds them, or null. */
export function recordedChannels(extra: ReopenSeed | null): RecordedChannels | null {
  const value = extra?.["channels"];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { xLabel, yLabel, xIndex, yIndex } = value;
  if (typeof yLabel !== "string" || typeof yIndex !== "number") return null;
  if (xLabel !== null && typeof xLabel !== "string") return null;
  if (xIndex !== null && typeof xIndex !== "number") return null;
  return { xLabel: xLabel ?? null, yLabel, xIndex: xIndex ?? null, yIndex };
}

export type ChannelPlot =
  | { kind: "plot"; xKey: number | null; yKey: number; label: string }
  | { kind: "problem"; problem: string };

/** What reopening must do about the plotted channels: plot the recorded ones
 *  (they are still where they were, by position AND name), or say they are not. */
export function planRecordedChannels(source: Dataset, channels: RecordedChannels | null): ChannelPlot {
  if (!channels) {
    return { kind: "problem", problem: "The channels it ran on were not recorded, so plot the column to analyse before running again." };
  }
  const labels = source.data.labels;
  const yOk = labels[channels.yIndex] === channels.yLabel;
  const xOk = channels.xIndex === null || labels[channels.xIndex] === channels.xLabel;
  if (!yOk || !xOk) {
    return {
      kind: "problem",
      problem: `The recorded channel “${channels.yLabel}”${channels.xLabel ? ` vs “${channels.xLabel}”` : ""} is no longer at its place in “${source.name}”; plot the column to analyse before running again.`,
    };
  }
  return { kind: "plot", xKey: channels.xIndex, yKey: channels.yIndex, label: channels.yLabel };
}

// Which recorded transforms can be replayed on ANOTHER dataset, and the reason
// when they cannot. Used by "Repeat last action" (lib/repeatTransform.ts) before
// anything runs, so a selection with one bad dataset creates nothing.
//
// A replay is well defined when the recorded settings still mean the same thing
// on the target. Settings that address a column by position or name (spectrogram
// channel, stack channels, split column, a SIMS reference or kept species) do
// not mean anything on a sheet that lacks that column, so it is refused here
// with the column named. Settings with no column (transpose, SIMS smoothing and
// calibration) always replay.
//
// NEVER REPEATABLE, refused with a reason by `repeatableTransform` returning
// null (so the chord says it can't be repeated):
// - unstack: it addresses three columns plus an aggregate; not offered yet.
// - promote / metaclean: they edit the dataset in place, not an output.
// - a running pipeline replay: not something the user just did.

import { channelLetter } from "./formula";
import type { TransformParams } from "./transformRun";
import type { Dataset } from "./types";

/** The reason `p` can't be replayed on `ds`, or null when it can. */
export function replayRefusal(p: TransformParams, ds: Dataset): string | null {
  const labels = ds.data.labels;
  const missing = (col: number) => `"${ds.name}" has no column ${channelLetter(col)} (it has ${labels.length})`;
  const named = (name: string) => `"${ds.name}" has no column named "${name}"`;
  switch (p.op) {
    case "spectrogram":
      return p.channel < labels.length ? null : missing(p.channel);
    case "stack": {
      const bad = p.channels.find((c) => c < 0 || c >= labels.length);
      return bad === undefined ? null : missing(bad);
    }
    case "split":
      return p.col < labels.length ? null : missing(p.col);
    case "sims": {
      const need = [p.normalization?.reference, ...(p.background?.keep ?? [])].filter((n): n is string => !!n);
      const gone = need.find((n) => !labels.includes(n));
      return gone === undefined ? null : named(gone);
    }
    default:
      return null;
  }
}

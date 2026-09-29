// What the Graph Builder's encoding wells (Color / Symbol / Label, P1.4) offer,
// show and accept — pure, so useGraphBuilder stays a thin binding.
//
// Options: Symbol offers the channels the modeling chokepoint reads as
// categorical (lib/plotEncoding.isEncodingFactor); Color offers every channel —
// a categorical one colours by level, a continuous one by GRADIENT (residual
// 4); Label offers every channel. All three also offer the sheet's row-indexed
// TEXT columns (residual 5: Origin's `origin_text_columns`, no channel index),
// under VIRTUAL option indices past the channels (`n + k`, k in short-name
// order) that exist only in this UI — the spec stores a text pick by name
// (`ChannelRef.text`, channel -1), so no index can go stale.

import { originTextColumnNames } from "../../../lib/columnmeta";
import { isEncodingFactor } from "../../../lib/plotEncoding";
import type { ChannelRef } from "../../../lib/plotspec";
import { rowsAreSampled } from "../../../lib/rowSidecars";
import type { Dataset } from "../../../lib/types";
import type { WellChip, WellOption } from "./ZoneWell";

export type EncodingZone = "color" | "symbol" | "label";

export function isEncodingZone(zone: string): zone is EncodingZone {
  return zone === "color" || zone === "symbol" || zone === "label";
}

/** The sheet's pickable text columns — none for a sampled preview. */
function textNames(ds: Dataset): string[] {
  return rowsAreSampled(ds.pending) ? [] : originTextColumnNames(ds.data);
}

/** Each encoding well's options (see the module doc). */
export function encodingOptions(ds: Dataset | null, options: readonly WellOption[]): Record<EncodingZone, WellOption[]> {
  if (!ds) return { color: [], symbol: [], label: [] };
  const n = ds.data.labels.length;
  const text = textNames(ds).map((name, k) => ({ index: n + k, label: `${name} (text)` }));
  return {
    color: [...options, ...text],
    symbol: [...options.filter((o) => isEncodingFactor(ds, o.index)), ...text],
    label: [...options, ...text],
  };
}

/** The chip for an assigned encoding ref, saying how it is read. */
export function encodingChip(ds: Dataset | null, zone: EncodingZone, ref: ChannelRef): WellChip {
  if (ref.text !== undefined) {
    const k = ds ? textNames(ds).indexOf(ref.text) : -1;
    const n = ds?.data.labels.length ?? 0;
    return { channel: k < 0 ? -1 : n + k, label: k < 0 ? `${ref.text} (text column missing: ignored)` : `${ref.text} (text)` };
  }
  const label = ds?.data.labels[ref.channel] ?? `col ${ref.channel}`;
  if (zone === "label" || !ds || isEncodingFactor(ds, ref.channel)) return { channel: ref.channel, label };
  // Not categorical: Color reads it as a gradient; Symbol ignores it (BUG-004's lesson).
  return { channel: ref.channel, label: `${label} (${zone === "color" ? "gradient" : "not categorical: ignored"})` };
}

/** The ref an assignment of option `channel` to `zone` stores, or a refusal
 *  message (a continuous column dropped on Symbol). */
export function encodingRef(ds: Dataset, zone: EncodingZone, channel: number): ChannelRef | string {
  const n = ds.data.labels.length;
  if (channel >= n) {
    const name = textNames(ds)[channel - n];
    return name === undefined ? "That text column is no longer in this sheet." : { datasetId: ds.id, channel: -1, text: name };
  }
  if (zone === "symbol" && !isEncodingFactor(ds, channel)) {
    return `Symbol needs a categorical column; set "${ds.data.labels[channel] ?? `col ${channel}`}" to nominal or ordinal first.`;
  }
  return { datasetId: ds.id, channel };
}

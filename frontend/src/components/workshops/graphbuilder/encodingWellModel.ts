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
import { facetSplitChannels } from "../../../lib/facetDomains";
import { isEncodingFactor } from "../../../lib/plotEncoding";
import { isStatSpec, statEncodingRefusal } from "../../../lib/plotEncodingStat";
import type { ChannelRef, PlotSpec } from "../../../lib/plotspec";
import { rowsAreSampled } from "../../../lib/rowSidecars";
import { analysisData } from "../../../lib/rowstate";
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

/** The one sentence a gradient Color gets on an xy facet grid (residual 3). */
export const FACET_GRADIENT_NOTE = "A gradient colours single points, so it does not apply while faceted.";
/** The one sentence an encoded xy facet grid gets when it has no Y channel to
 *  split: none explicit, and the plot's default list (`lib/facet.
 *  facetSplitChannels`, the flat plot's own) names none either. */
export const FACET_NO_Y_NOTE =
  "Color, Symbol and Label need a Y channel on a facet grid, and this sheet has no default one to use.";

/** Is `spec`'s xy facet grid encoded over NO Y channel at all (see
 *  `FACET_NO_Y_NOTE`)? With explicit Y, or a default the flat plot would draw,
 *  the grid splits that list in every panel. */
function facetLacksY(spec: PlotSpec, ds: Dataset): boolean {
  if (isStatSpec(spec) || !spec.zones.facet || spec.zones.y.length > 0) return false;
  const x = spec.zones.x;
  return facetSplitChannels(analysisData(ds) ?? ds.data, x && x.datasetId === ds.id ? x.channel : null, null) === null;
}

/** Why `spec` does not draw `ref` in `zone`, or null: a box / violin / bar
 *  refusal (`lib/plotEncodingStat`), or a gradient Color on an xy facet grid
 *  (`plotEncodingBinding.facetEncoding` drops it). */
function refusal(spec: PlotSpec, ds: Dataset, zone: EncodingZone, ref: ChannelRef): string | null {
  const gradient = zone === "color" && ref.text === undefined && !isEncodingFactor(ds, ref.channel);
  if (!isStatSpec(spec) && spec.zones.facet && gradient) return FACET_GRADIENT_NOTE;
  return statEncodingRefusal(spec, ds, zone, ref);
}

/** The chip for an assigned encoding ref, saying how it is read — "(ignored)"
 *  when the spec refuses it (`encodingNotes` says why). */
export function encodingChip(ds: Dataset | null, zone: EncodingZone, ref: ChannelRef, spec?: PlotSpec): WellChip {
  if (ds && spec && refusal(spec, ds, zone, ref)) {
    const name = ref.text ?? ds.data.labels[ref.channel] ?? `col ${ref.channel}`;
    return { channel: ref.text !== undefined ? -1 : ref.channel, label: `${name} (ignored)` };
  }
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
 *  message (a continuous column dropped on Symbol; an encoding the spec's
 *  box / violin / bar mark cannot draw, `lib/plotEncodingStat`). */
export function encodingRef(ds: Dataset, zone: EncodingZone, channel: number, spec?: PlotSpec): ChannelRef | string {
  const n = ds.data.labels.length;
  let ref: ChannelRef = { datasetId: ds.id, channel };
  if (channel >= n) {
    const name = textNames(ds)[channel - n];
    if (name === undefined) return "That text column is no longer in this sheet.";
    ref = { datasetId: ds.id, channel: -1, text: name };
  } else if (zone === "symbol" && !isEncodingFactor(ds, channel) && !(spec && isStatSpec(spec))) {
    return `Symbol needs a categorical column; set "${ds.data.labels[channel] ?? `col ${channel}`}" to nominal or ordinal first.`;
  }
  return (spec && refusal(spec, ds, zone, ref)) ?? ref;
}

/** Why each assigned encoding is not drawn by `spec`, one sentence per well
 *  (empty when every assigned one applies). */
export function encodingNotes(ds: Dataset | null, spec: PlotSpec): string[] {
  if (!ds) return [];
  const notes = (["color", "symbol", "label"] as const).flatMap((zone) => {
    const ref = spec.zones[zone];
    const why = ref ? refusal(spec, ds, zone, ref) : null;
    return why ? [why] : [];
  });
  const assigned = ENCODING_ZONES.some((zone) => spec.zones[zone] !== null && spec.zones[zone] !== undefined);
  return assigned && facetLacksY(spec, ds) ? [...notes, FACET_NO_Y_NOTE] : notes;
}
const ENCODING_ZONES = ["color", "symbol", "label"] as const;

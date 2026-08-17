// Canonical live-preview adapter for Quick Figure Builder G3. It consumes the
// same PlotPayload and ErrorSpan contracts as the Graph Builder and Stage.

import { buildErrorSpans } from "./errorbars";
import { effectiveChannels, buildColumns } from "./plotdata";
import type { SpecRender } from "./plotspec";
import { mappingReady, type QuickFigureMapping } from "./quickFigureMapping";
import type { ChannelRole, DataStruct } from "./types";

export type QuickPlotStyle = "line" | "scatter" | "line-symbol";

/** G4 review round (P2, FIX 2): the created figure renders through
 *  `effectiveChannels` (lib/plotdata.ts), which drops any channel carrying a
 *  `Dataset.channelRoles` entry (label/ignore) EVEN when it is explicitly
 *  listed in `yKeys` -- the Quick Figure Builder's own mapping UI does not
 *  consult `channelRoles` at all (`QuickMappingPanel` is agnostic of it), so
 *  a user CAN explicitly assign a role-carrying channel to Y there. Verified
 *  before choosing this fix: `effectiveChannels` itself was NOT changed to
 *  exempt explicit `yKeys` from role filtering, because at least one other
 *  surface relies on today's filter applying to an explicit list too --
 *  `ChannelsCard.tsx`'s `changeRole` reassigns a role onto an ALREADY-plotted
 *  (explicitly yKeys-listed) channel without scrubbing it from `yKeys`; the
 *  role filter is what actually drops it from the plot afterward, and its
 *  checkbox is `disabled` once role'd, so there would be no way back. So the
 *  preview matches the figure by applying the SAME filter here instead. */
function previewedChannels(
  data: DataStruct,
  mapping: QuickFigureMapping,
  channelRoles?: Record<number, ChannelRole>,
): number[] {
  return effectiveChannels(data, mapping.yKeys, mapping.xKey, channelRoles, null);
}

export function quickFigurePreview(
  data: DataStruct,
  mapping: QuickFigureMapping,
  style: QuickPlotStyle,
  channelRoles?: Record<number, ChannelRole>,
): SpecRender {
  if (!mappingReady(mapping)) {
    return { kind: "message", tone: "hint", message: "Assign at least one Y series to preview the figure." };
  }
  const plotted = previewedChannels(data, mapping, channelRoles);
  const payload = buildColumns(data, null, mapping.xKey, plotted);
  const errorSpans = buildErrorSpans(data, plotted, mapping.errorBindings);
  return {
    kind: "xy",
    payload,
    mark: style === "scatter" ? "scatter" : "line",
    grouped: false,
    ...(style === "line-symbol" ? { showMarkers: true } : {}),
    ...(errorSpans.size > 0 ? { errorSpans } : {}),
  };
}

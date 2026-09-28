// Canonical live-preview adapter for Quick Figure Builder G3. It consumes the
// same PlotPayload and ErrorSpan contracts as the Graph Builder and Stage.

import { groupLevelLabel, levelOrderFor } from "./categorical";
import { buildErrorSpans } from "./errorbars";
import { applyGroupSplit } from "./plotGroupSplit";
import { effectiveChannels, buildColumns } from "./plotdata";
import type { SpecRender } from "./plotspec";
import { mappingReady, type QuickFigureMapping } from "./quickFigureMapping";
import { quickFigureOverlay } from "./quickFigureSeriesX";
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
  // Per-series X: preview the SAME overlay the created figure binds to
  // (lib/quickFigureSeriesX.ts). Role-filtered Y columns are dropped first,
  // exactly as `previewedChannels` drops them below (creation is gated on
  // there being none, so the figure never has to).
  const own = quickFigureOverlay(data, { ...mapping, yKeys: mapping.yKeys.filter((y) => !channelRoles?.[y]) });
  if (own) return quickFigurePreview(own.data, own.mapping, style);
  const plotted = previewedChannels(data, mapping, channelRoles);
  const flat = buildColumns(data, null, mapping.xKey, plotted);
  // Grouping role: the SAME split, with the SAME arguments, the created
  // window's Stage applies (`Stage/usePlotPayload.ts` -> `applyGroupSplit`),
  // so preview legend entries are exactly the figure's -- including its
  // degrade-to-ungrouped when the group column has no finite level. The
  // Stage also draws no error spans for a grouped view (a per-level series
  // has no 1:1 error column), so neither does the preview.
  const g = mapping.groupKey ?? null;
  const payload = g === null
    ? flat
    : applyGroupSplit(
        flat,
        data.values.map((row) => row[g]),
        data.labels[g] ?? `col ${g}`,
        (code) => groupLevelLabel(data, g, code),
        levelOrderFor(data, g),
      );
  const errorSpans = g === null ? buildErrorSpans(data, plotted, mapping.errorBindings) : null;
  return {
    kind: "xy",
    payload,
    mark: style === "scatter" ? "scatter" : "line",
    grouped: g !== null,
    ...(style === "line-symbol" ? { showMarkers: true } : {}),
    ...(errorSpans && errorSpans.size > 0 ? { errorSpans } : {}),
  };
}

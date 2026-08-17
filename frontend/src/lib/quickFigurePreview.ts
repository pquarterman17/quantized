// Canonical live-preview adapter for Quick Figure Builder G3. It consumes the
// same PlotPayload and ErrorSpan contracts as the Graph Builder and Stage.

import { buildErrorSpans } from "./errorbars";
import { buildColumns } from "./plotdata";
import type { SpecRender } from "./plotspec";
import { mappingReady, type QuickFigureMapping } from "./quickFigureMapping";
import type { DataStruct } from "./types";

export type QuickPlotStyle = "line" | "scatter" | "line-symbol";

export function quickFigurePreview(
  data: DataStruct,
  mapping: QuickFigureMapping,
  style: QuickPlotStyle,
): SpecRender {
  if (!mappingReady(mapping)) {
    return { kind: "message", tone: "hint", message: "Assign at least one Y series to preview the figure." };
  }
  const payload = buildColumns(data, null, mapping.xKey, mapping.yKeys);
  const errorSpans = buildErrorSpans(data, mapping.yKeys, mapping.errorBindings);
  return {
    kind: "xy",
    payload,
    mark: style === "scatter" ? "scatter" : "line",
    grouped: false,
    ...(style === "line-symbol" ? { showMarkers: true } : {}),
    ...(errorSpans.size > 0 ? { errorSpans } : {}),
  };
}

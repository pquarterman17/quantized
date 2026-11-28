// The export request of a faceted item 20 variant: one `facets[]` panel per settled draw, each
// carrying the same `kind`, `data`, `labels` and `dist3` options the flat plot would post for
// that panel's rows (`dist3ExportSpec`, `groupHistogramSpec`), so a panel exports as the plot
// drawn alone. The titles and the bin rule are shared, as the grid shares its axes labels.

import type { StatplotFacetSpec, StatplotFigureSpec } from "../../lib/api/figures";
import { dist2ExportSpec } from "./statDist2Draw";
import { dist3ExportSpec } from "./statDist3Draw";
import { groupHistogramSpec, stackWire } from "./statHistMulti";
import type { StatDrawData } from "./statRender";
import type { FacetDraw } from "./useStatStageCompute";

/** The panel's request, or null for a draw that is not an item 20 variant. */
function panelSpec(d: StatDrawData, bins: string, fmt: string): StatplotFigureSpec | null {
  const flat = dist3ExportSpec(d, fmt);
  if (flat) return flat;
  const ridge = dist2ExportSpec(d, bins, fmt);
  if (ridge?.kind === "ridgeline") {
    const { ridgeline, ...rest } = ridge; // a panel's options ride on the panel (`dist3`), not the request
    return { ...rest, dist3: { type: "ridgeline", ...ridgeline! } };
  }
  const hist = groupHistogramSpec(d, bins, fmt);
  return hist && { ...hist, ...stackWire(d) };
}

/** The facet request for these panels (null when none is a variant draw). */
export function variantFacetSpec(facets: readonly FacetDraw[], bins: string, fmt: string): StatplotFigureSpec | null {
  const specs = facets.map((f) => ({ label: f.label, spec: panelSpec(f.draw, bins, fmt) }));
  const panels: StatplotFacetSpec[] = [];
  for (const { label, spec } of specs) {
    if (!spec) continue;
    panels.push({ label, kind: spec.kind, data: spec.data as number[][], labels: spec.labels ?? null, dist3: spec.dist3 ?? null });
  }
  const first = specs.find((s) => s.spec)?.spec;
  if (!first || !panels.length) return null;
  return {
    kind: first.kind, data: panels[0].data, labels: panels[0].labels, fmt, bins: first.kind === "histogram" ? bins : undefined,
    x_label: first.x_label, y_label: first.y_label, filename: `${first.filename ?? first.kind}_faceted`, facets: panels,
  };
}

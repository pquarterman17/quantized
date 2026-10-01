// The axis titles' right-click Format (size / bold / italic) and dragged
// offsets on the export wire. The canvas draws both (`uplotRichLabels`); the
// request used to carry neither, so a resized, bolded or moved title exported
// as the preset's plain one (`tests/fixtures/wire/axis_titles.json`). Values
// ride in the screen's own CSS px; the backend reads them as points, the rule
// an annotation's `size` and a marker's `marker_size` already follow
// (`calc/figure_axis_titles.py`). A facet grid sends neither: the Stage's
// facet canvas draws plain titles. An x-axis break view still sends both (the
// backend may decline the break and draw the flat figure), and the break
// renderer skips them, as the break panels do.

import type { FigureSpec } from "./api/figures";
import type { PlotView } from "./plotview";
import type { AxisKey, AxisLabelStyle } from "./types";

type AxisTitleWire = Pick<FigureSpec, "axis_label_styles" | "axis_label_offsets">;

const AXES: readonly AxisKey[] = ["x", "y", "y2"];

/** The request fields for `st`'s axis-title Format and offsets; `{}` when no
 *  title is formatted or moved. */
export function axisTitleWire(st: Pick<PlotView, "axisLabelStyles" | "axisLabelOffsets">): AxisTitleWire {
  const styles: Partial<Record<AxisKey, AxisLabelStyle>> = {};
  const offsets: Partial<Record<AxisKey, [number, number]>> = {};
  for (const axis of AXES) {
    const s = st.axisLabelStyles[axis];
    const entry: AxisLabelStyle = {
      ...(s?.size != null && Number.isFinite(s.size) ? { size: s.size } : {}),
      ...(s?.bold ? { bold: true } : {}),
      ...(s?.italic ? { italic: true } : {}),
    };
    if (Object.keys(entry).length > 0) styles[axis] = entry;
    const o = st.axisLabelOffsets[axis];
    if (o && o.every(Number.isFinite) && (o[0] !== 0 || o[1] !== 0)) offsets[axis] = [o[0], o[1]];
  }
  return {
    ...(Object.keys(styles).length > 0 ? { axis_label_styles: styles } : {}),
    ...(Object.keys(offsets).length > 0 ? { axis_label_offsets: offsets } : {}),
  };
}

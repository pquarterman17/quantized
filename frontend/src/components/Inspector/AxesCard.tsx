// The Inspector's Axes card: scale, grid, frame, legend, template, limits and
// tick format. Split out of Inspector.tsx (UX-A) when the Inspector grew its
// selection-driven layout; the controls are unchanged.

import AxisLimits from "./AxisLimits";
import AxisScaleControls from "./AxisScaleControls";
import LegendControls from "./LegendControls";
import TickFormat from "./TickFormat";
import { PLOT_TEMPLATES } from "../../lib/plotTemplates";
import { Select } from "../primitives";
import Card from "../primitives/Card";
import { useApp } from "../../store/useApp";

export default function AxesCard() {
  const showGrid = useApp((s) => s.showGrid);
  const setShowGrid = useApp((s) => s.setShowGrid);
  const plotTemplate = useApp((s) => s.plotTemplate);
  const setPlotTemplate = useApp((s) => s.setPlotTemplate);
  const showAxisBox = useApp((s) => s.showAxisBox);
  const setShowAxisBox = useApp((s) => s.setShowAxisBox);
  return (
    <Card title="Axes" defaultOpen={false} helpTopic="axis scale">
      <AxisScaleControls />
      <label className="qz-check">
        <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
        Grid lines
      </label>
      <label className="qz-check">
        <input type="checkbox" checked={showAxisBox} onChange={(e) => setShowAxisBox(e.target.checked)} />
        Axis box (frame)
      </label>
      <LegendControls />
      <label className="qzk-field-lbl" style={{ marginTop: 2 }}>
        Plot template
        <Select
          options={PLOT_TEMPLATES.map((t) => ({ value: t.value, label: t.label }))}
          value={plotTemplate}
          onChange={(e) => setPlotTemplate(e.target.value)}
        />
      </label>
      <AxisLimits />
      <TickFormat />
    </Card>
  );
}

// The Inspector's Axes card: scale, grid, frame, legend, template, limits and
// tick format. Split out of Inspector.tsx (UX-A) when the Inspector grew its
// selection-driven layout; the controls are unchanged.
//
// Plan item 50 (OG23): in "popup" mode the per-axis controls (scale, limits,
// tick format, legend corner) are replaced by launchers for the axis popups;
// the plot-wide ones (grid, axis box, template, show legend) stay.

import AxisLimits from "./AxisLimits";
import AxisScaleControls from "./AxisScaleControls";
import LegendControls from "./LegendControls";
import TickFormat from "./TickFormat";
import { objectEditorIsPopup } from "../../lib/objectEditorMode";
import { PLOT_TEMPLATES } from "../../lib/plotTemplates";
import { Select } from "../primitives";
import Card from "../primitives/Card";
import { openFigureDialog, type AxisId } from "../../store/figureDialogs";
import { useApp } from "../../store/useApp";

/** One launcher per axis popup, so it opens without selecting the axis first. */
function AxisLaunchers() {
  const hasY2 = useApp((s) => (s.y2Keys?.length ?? 0) > 0);
  const hasY3 = useApp((s) => s.yAxes.length > 0);
  const open = (axis: AxisId) => () => openFigureDialog({ kind: "axis", axis });
  return (
    <div className="qzk-sel-row" role="group" aria-label="Axis settings">
      <button type="button" className="qz-btn" onClick={open("x")}>
        X axis…
      </button>
      <button type="button" className="qz-btn" onClick={open("y")}>
        Y axis…
      </button>
      {hasY2 && (
        <button type="button" className="qz-btn" onClick={open("y2")}>
          Y2 axis…
        </button>
      )}
      {hasY3 && (
        <button
          type="button"
          className="qz-btn"
          title="The extra right-hand axes (Y3 and up)"
          onClick={() => void import("../../lib/multiYCommands").then((m) => m.editExtraYAxes(useApp.getState))}
        >
          Y3+ axes…
        </button>
      )}
    </div>
  );
}

export default function AxesCard() {
  const popup = objectEditorIsPopup();
  const showGrid = useApp((s) => s.showGrid);
  const setShowGrid = useApp((s) => s.setShowGrid);
  const plotTemplate = useApp((s) => s.plotTemplate);
  const setPlotTemplate = useApp((s) => s.setPlotTemplate);
  const showAxisBox = useApp((s) => s.showAxisBox);
  const setShowAxisBox = useApp((s) => s.setShowAxisBox);
  return (
    <Card title="Axes" defaultOpen={false} helpTopic="axis scale">
      {popup ? <AxisLaunchers /> : <AxisScaleControls />}
      <label className="qz-check">
        <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
        Grid lines
      </label>
      <label className="qz-check">
        <input type="checkbox" checked={showAxisBox} onChange={(e) => setShowAxisBox(e.target.checked)} />
        Axis box (frame)
      </label>
      <LegendControls corner={!popup} />
      <label className="qzk-field-lbl" style={{ marginTop: 2 }}>
        Plot template
        <Select
          options={PLOT_TEMPLATES.map((t) => ({ value: t.value, label: t.label }))}
          value={plotTemplate}
          onChange={(e) => setPlotTemplate(e.target.value)}
        />
      </label>
      {!popup && <AxisLimits />}
      {!popup && <TickFormat />}
    </Card>
  );
}

// Right panel: stacked collapsible Cards (start collapsed). Corrections posts to
// /api/corrections/apply via the store. Appearance lives in the title-bar menu.

import AnnotationsCard from "./AnnotationsCard";
import AxisLimits from "./AxisLimits";
import AxisScaleControls from "./AxisScaleControls";
import ChannelsCard from "./ChannelsCard";
import CorrectionsCard from "./CorrectionsCard";
import MacroCard from "./MacroCard";
import MapCard from "./MapCard";
import MetadataCard from "./MetadataCard";
import NotesCard from "./NotesCard";
import OriginProvenanceCard from "./OriginProvenanceCard";
import RefLinesCard from "./RefLinesCard";
import SeriesStyleCard from "./SeriesStyleCard";
import ShapesCard from "./ShapesCard";
import StatsCard from "./StatsCard";
import TickFormat from "./TickFormat";
import TitlesCard from "./TitlesCard";
import { folderPathLabel } from "../../lib/foldertree";
import { PLOT_TEMPLATES } from "../../lib/plotTemplates";
import { Card, Select } from "../primitives";
import { useActiveDataset, useApp, type LegendPos } from "../../store/useApp";

export default function Inspector() {
  const active = useActiveDataset();
  // "Folder › Subfolder" breadcrumb for the active dataset (GUI_INTERACTION
  // #13 sub-item 2) — the Inspector is the Library's existing selection-
  // details surface, so the caption lives here rather than a new panel.
  const folders = useApp((s) => s.folders);
  const breadcrumb = active ? folderPathLabel(folders, active.folderId) : undefined;
  const stageTab = useApp((s) => s.stageTab);
  const showGrid = useApp((s) => s.showGrid);
  const setShowGrid = useApp((s) => s.setShowGrid);
  const showLegend = useApp((s) => s.showLegend);
  const setShowLegend = useApp((s) => s.setShowLegend);
  const legendPos = useApp((s) => s.legendPos);
  const setLegendPos = useApp((s) => s.setLegendPos);
  const plotTemplate = useApp((s) => s.plotTemplate);
  const setPlotTemplate = useApp((s) => s.setPlotTemplate);
  const showAxisBox = useApp((s) => s.showAxisBox);
  const setShowAxisBox = useApp((s) => s.setShowAxisBox);

  return (
    <aside className="qzk-inspector">
      {breadcrumb && (
        <div className="qzk-ds-breadcrumb" title={breadcrumb}>
          {breadcrumb}
        </div>
      )}

      {stageTab === "map" && <MapCard />}

      <NotesCard active={active} />

      <ChannelsCard active={active} />

      <CorrectionsCard key={active?.id ?? "none"} active={active} />

      <StatsCard active={active} />

      <MetadataCard active={active} />

      <OriginProvenanceCard active={active} />

      <Card title="Axes" defaultOpen={false}>
        <AxisScaleControls />
        <label className="qz-check">
          <input
            type="checkbox"
            checked={showGrid}
            onChange={(e) => setShowGrid(e.target.checked)}
          />
          Grid lines
        </label>
        <label className="qz-check">
          <input
            type="checkbox"
            checked={showAxisBox}
            onChange={(e) => setShowAxisBox(e.target.checked)}
          />
          Axis box (frame)
        </label>
        <label className="qz-check">
          <input
            type="checkbox"
            checked={showLegend}
            onChange={(e) => setShowLegend(e.target.checked)}
          />
          Legend
        </label>
        {showLegend && (
          <label className="qzk-field-lbl" style={{ marginTop: 2 }}>
            Legend position
            <Select
              options={[
                { value: "ne", label: "Top right" },
                { value: "nw", label: "Top left" },
                { value: "se", label: "Bottom right" },
                { value: "sw", label: "Bottom left" },
              ]}
              value={legendPos}
              onChange={(e) => setLegendPos(e.target.value as LegendPos)}
            />
          </label>
        )}
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

      <TitlesCard />

      <RefLinesCard />

      <AnnotationsCard />

      <ShapesCard />

      <SeriesStyleCard active={active} />

      <MacroCard />
    </aside>
  );
}

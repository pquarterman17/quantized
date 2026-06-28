// Right panel: stacked collapsible Cards (start collapsed). Corrections posts to
// /api/corrections/apply via the store. Appearance lives in the title-bar menu.

import AnnotationsCard from "./AnnotationsCard";
import AxisLimits from "./AxisLimits";
import ChannelsCard from "./ChannelsCard";
import CorrectionsCard from "./CorrectionsCard";
import MetadataCard from "./MetadataCard";
import RefLinesCard from "./RefLinesCard";
import SeriesStyleCard from "./SeriesStyleCard";
import StatsCard from "./StatsCard";
import TickFormat from "./TickFormat";
import { Card, MetaRow } from "../primitives";
import { useActiveDataset, useApp } from "../../store/useApp";

export default function Inspector() {
  const active = useActiveDataset();
  const yLog = useApp((s) => s.yLog);
  const setYLog = useApp((s) => s.setYLog);
  const xLog = useApp((s) => s.xLog);
  const setXLog = useApp((s) => s.setXLog);
  const showGrid = useApp((s) => s.showGrid);
  const setShowGrid = useApp((s) => s.setShowGrid);
  const showLegend = useApp((s) => s.showLegend);
  const setShowLegend = useApp((s) => s.setShowLegend);

  return (
    <aside className="qzk-inspector">
      <Card title="Scan metadata" defaultOpen={false}>
        {active ? (
          <>
            <MetaRow label="Name" value={active.name} title={active.name} />
            <MetaRow label="Points" value={active.data.time.length} />
            <MetaRow label="Channels" value={active.data.labels.length} />
            <MetaRow label="Units" value={active.data.units.join(", ") || "—"} />
          </>
        ) : (
          <MetaRow label="—" value="no dataset" />
        )}
      </Card>

      <MetadataCard active={active} />

      <ChannelsCard active={active} />

      <CorrectionsCard key={active?.id ?? "none"} active={active} />

      <StatsCard active={active} />

      <Card title="Axes" defaultOpen={false}>
        <label className="qz-check">
          <input
            type="checkbox"
            checked={xLog}
            onChange={(e) => setXLog(e.target.checked)}
          />
          Log X axis
        </label>
        <label className="qz-check">
          <input
            type="checkbox"
            checked={yLog}
            onChange={(e) => setYLog(e.target.checked)}
          />
          Log Y axis
        </label>
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
            checked={showLegend}
            onChange={(e) => setShowLegend(e.target.checked)}
          />
          Legend
        </label>
        <AxisLimits />
        <TickFormat />
      </Card>

      <RefLinesCard />

      <AnnotationsCard />

      <SeriesStyleCard active={active} />
    </aside>
  );
}

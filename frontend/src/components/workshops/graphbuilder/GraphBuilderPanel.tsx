// Graph Builder (ORIGIN_GAP_PLAN #51 phase 2, durable artifact GUI_INTERACTION
// #11) — view. A draggable ToolWindow: drop channels from the Channels card /
// legend (the #49 CHANNEL_DND drag) into the X / Y / Group / Facet wells (or
// click-to-assign for keyboard/AT); the mark morphs as columns land (scatter
// ⇄ line ⇄ box ⇄ violin ⇄ bar); a live preview updates; "Send to Stage"
// applies the spec to the main plot; "Export" sends it, then exports via the
// existing figure-export path. PlotSpecBar (the Save/Open/Duplicate/Rename/
// Delete toolbar) sits ABOVE the wells and stays visible even with no dataset
// selected, so saved graphs are always reachable. Thin — all state and the
// plot-spec grammar live in useGraphBuilder / lib/plotspec.

import { useApp } from "../../../store/useApp";
import ToolWindow from "../../overlays/ToolWindow";
import { Button } from "../../primitives";
import GraphPreview from "./GraphPreview";
import PlotSpecBar from "./PlotSpecBar";
import { useGraphBuilder } from "./useGraphBuilder";
import ZoneWell from "./ZoneWell";

const MARK_GLYPH: Record<string, string> = {
  scatter: "⣿ scatter",
  line: "╱ line",
  box: "▯ box",
  violin: "◈ violin",
  bar: "▭ bar",
};

export default function GraphBuilderPanel() {
  const setOpen = useApp((s) => s.setGraphBuilderOpen);
  const g = useGraphBuilder();
  const faint = { color: "var(--text-faint)" } as const;

  return (
    <ToolWindow id="graphbuilder" title="Graph Builder" width={420} onClose={() => setOpen(false)}>
      <PlotSpecBar
        specs={g.savedSpecs}
        activeSpec={g.activeSpec}
        dirty={g.dirty}
        canSave={g.canSend}
        onSaveActive={g.saveActive}
        onSaveAs={g.saveAs}
        onOpen={g.openSpec}
        onDuplicate={g.duplicateSpec}
        onRename={g.renameSpec}
        onDelete={g.deleteSpec}
      />
      {!g.hasData ? (
        <div className="qzk-ds-meta" style={faint}>
          Select a dataset to build a graph.
        </div>
      ) : (
        <>
          <div className="qzk-zone-wells">
            <ZoneWell
              title="X"
              hint="continuous → scatter/line · categorical → box"
              datasetId={g.datasetId}
              options={g.options}
              assigned={g.chips("x")}
              onAssign={(c) => g.assign("x", c)}
              onRemove={(c) => g.remove("x", c)}
            />
            <ZoneWell
              title="Y"
              hint="value axis (one or more)"
              multiple
              datasetId={g.datasetId}
              options={g.options}
              assigned={g.chips("y")}
              onAssign={(c) => g.assign("y", c)}
              onRemove={(c) => g.remove("y", c)}
            />
            <ZoneWell
              title="Group"
              hint="colour split by category"
              datasetId={g.datasetId}
              options={g.options}
              assigned={g.chips("group")}
              onAssign={(c) => g.assign("group", c)}
              onRemove={(c) => g.remove("group", c)}
            />
            <ZoneWell
              title="Facet"
              datasetId={g.datasetId}
              options={g.options}
              assigned={g.chips("facet")}
              note={
                <span style={faint}>
                  scatter/line: previews as small multiples below and "Send to Stage" carries it to
                  the main plot as a facet grid. Box/violin/bar don't facet yet.
                </span>
              }
              onAssign={(c) => g.assign("facet", c)}
              onRemove={(c) => g.remove("facet", c)}
            />
          </div>

          <div className="qzk-graph-mark-row">
            <span className="qzk-graph-mark-label">
              {MARK_GLYPH[g.mark] ?? g.mark}
              {g.family && <span style={faint}> · {g.family}</span>}
            </span>
            {g.marks.length > 1 && (
              <Button size="sm" onClick={g.cycle} title="Cycle through the marks valid for these columns">
                cycle ↻
              </Button>
            )}
          </div>

          <GraphPreview render={g.render} />

          <div className="qzk-graph-actions">
            <Button variant="primary" size="sm" disabled={!g.canSend} onClick={g.sendToStage} style={{ flex: 1 }}>
              Send to Stage
            </Button>
            <Button
              size="sm"
              disabled={!g.canOpenFigureBuilder}
              onClick={g.openInFigureBuilder}
              title={g.figureBuilderReason ?? "Continue this XY plot in Figure Builder"}
            >
              Figure Builder
            </Button>
            <Button
              size="sm"
              disabled={!g.canSend}
              onClick={() => void g.exportPlot()}
              title="Send to Stage, then export via the Export figure dialog"
            >
              Export
            </Button>
            <Button size="sm" onClick={g.reset}>
              Reset
            </Button>
          </div>
        </>
      )}
    </ToolWindow>
  );
}

// Graph Builder (ORIGIN_GAP_PLAN #51 phase 2, durable artifact GUI_INTERACTION
// #11) — view. A draggable ToolWindow: drop channels from the Channels card /
// legend (the #49 CHANNEL_DND drag) into the X / Y / Group / Facet wells (or
// click-to-assign for keyboard/AT); the mark morphs as columns land (scatter
// ⇄ line ⇄ step ⇄ box ⇄ violin ⇄ bar); a live preview updates; explicit Create
// New Plot / Apply to Current Plot actions commit the spec; Export applies it
// to the current plot, then exports through the
// existing figure-export path. line/step marks also expose a "Markers"
// toggle (Origin's "Line + Symbol") and step exposes its pre/post/mid
// alignment (GAP_PLOTTYPES) — both are spec-level defaults, translated onto
// the plotted channels' own styles at commit time (see useGraphBuilder's
// `markSeriesStyle`). PlotSpecBar (the Save/Open/Duplicate/Rename/Delete
// toolbar) sits ABOVE the wells and stays visible even with no dataset
// selected, so saved graphs are always reachable. Thin — all state and the
// plot-spec grammar live in useGraphBuilder / lib/plotspec.

import type { StepMode } from "../../../lib/plotspec";
import { useApp } from "../../../store/useApp";
import ToolWindow from "../../overlays/ToolWindow";
import { Button, Checkbox, SegmentedControl } from "../../primitives";
import GraphPreview from "./GraphPreview";
import PlotSpecBar from "./PlotSpecBar";
import { useGraphBuilder } from "./useGraphBuilder";
import ZoneWell from "./ZoneWell";

const MARK_GLYPH: Record<string, string> = {
  scatter: "⣿ scatter",
  line: "╱ line",
  step: "▤ step",
  box: "▯ box",
  violin: "◈ violin",
  bar: "▭ bar",
};

const STEP_MODE_OPTS: { value: StepMode; label: string }[] = [
  { value: "pre", label: "pre" },
  { value: "post", label: "post" },
  { value: "mid", label: "mid" },
];

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
        canSave={g.canPlot}
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
              onMove={g.moveY}
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
                  scatter/line: previews as small multiples below and either plot action carries it to
                  the main plot as a facet grid. Box/violin/bar don't facet yet.
                </span>
              }
              onAssign={(c) => g.assign("facet", c)}
              onRemove={(c) => g.remove("facet", c)}
            />
            {g.family === "xy" && (
              <>
                <ZoneWell
                  title="Y error"
                  hint="± uncertainty, paired by position with Y"
                  multiple
                  datasetId={g.datasetId}
                  options={g.options}
                  assigned={g.chips("yErr")}
                  onAssign={(c) => g.assign("yErr", c)}
                  onRemove={(c) => g.remove("yErr", c)}
                />
                <ZoneWell
                  title="X error"
                  hint="± uncertainty on the x axis"
                  datasetId={g.datasetId}
                  options={g.options}
                  assigned={g.chips("xErr")}
                  onAssign={(c) => g.assign("xErr", c)}
                  onRemove={(c) => g.remove("xErr", c)}
                />
              </>
            )}
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

          {(g.mark === "line" || g.mark === "step") && (
            <div className="qzk-graph-mark-row">
              <Checkbox checked={g.showMarkers} onChange={g.setShowMarkers}>
                Markers
              </Checkbox>
              {g.mark === "step" && (
                <SegmentedControl<StepMode> options={STEP_MODE_OPTS} value={g.stepMode} onChange={g.setStepMode} />
              )}
            </div>
          )}

          <GraphPreview render={g.render} />

          <div className="qzk-graph-actions">
            <Button
              variant="primary"
              size="sm"
              disabled={!g.canPlot}
              onClick={g.createNewPlot}
              title="Create and focus a new editable plot"
              style={{ flex: 1 }}
            >
              Create New Plot
            </Button>
            <Button
              size="sm"
              disabled={!g.canApplyToCurrent}
              onClick={g.applyToCurrent}
              title={g.canApplyToCurrent ? "Apply this data mapping to the focused editable plot" : "Focus an editable plot first"}
              style={{ flex: 1 }}
            >
              Apply to Current Plot
            </Button>
          </div>
          <div className="qzk-graph-actions">
            <Button
              size="sm"
              disabled={!g.canOpenFigureBuilder}
              onClick={() => void g.openInFigureBuilder()}
              title={
                g.figureBuilderReason ??
                (g.figureBuilderLosses.length > 0
                  ? `Preview requires confirmation: ${g.figureBuilderLosses.join(", ")}`
                  : "Preview publication output; changes will not update the Stage plot")
              }
            >
              Publication Preview
            </Button>
            <Button
              size="sm"
              disabled={!g.canApplyToCurrent}
              onClick={() => void g.exportPlot()}
              title="Apply to the current plot, then open the Export figure dialog"
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

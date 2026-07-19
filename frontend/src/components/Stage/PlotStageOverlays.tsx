// The overlay cluster mounted on top of the plot canvas: the floating
// tool-dock (PlotToolbar) + active-tool resting hint (ToolHud) + the
// magnifier inset + the "no dataset" placeholder + readout/result chips +
// the interactive legend. Extracted out of PlotStage to keep it under its
// line-ceiling ratchet (component-ceiling guard in architecture.test.ts) —
// same reasoning as PlotStageMenus/useLiveSnapshotPublish's own extractions.
// Pure presentational: every value PlotStage already computed comes in as a
// prop, except `onSnapshotWindow` (snapshotToNewWindow) — a plain
// zero-argument command function, imported directly here rather than
// threaded through just to forward a stable reference (mirrors
// PlotStageMenus mounting SelectionMiniToolbar, which reads its own store
// slice instead of taking it as a prop).

import type { ColorScatterSpec } from "../../lib/colorscatter";
import type { Measurement } from "../../lib/measure";
import type { FwhmResult } from "../../lib/peakwidth";
import type { PlotPayload } from "../../lib/plotdata";
import type { RegionStats } from "../../lib/regionStats";
import type { Dataset, SeriesStyle } from "../../lib/types";
import type { PlotTool } from "../../lib/uplotOpts";
import type { Readout } from "../../lib/uplotTools";
import type { IntegralResult } from "../../store/useApp";
import { snapshotToNewWindow } from "../windows/useWindowCommands";
import InsetPlot from "./InsetPlot";
import PlotLegend from "./PlotLegend";
import PlotReadouts from "./PlotReadouts";
import PlotResultChips from "./PlotResultChips";
import PlotToolbar from "./PlotToolbar";
import ToolHud from "./ToolHud";
import type { PlotStageActions } from "./usePlotStageActions";
import type { GadgetChipState } from "./useGadgetChip";

export interface PlotStageOverlaysProps {
  displayPayload: PlotPayload | null;
  active: Dataset | null;
  tool: PlotTool;
  insetMode: boolean;
  showLegend: boolean;
  // Matches usePlotPayload's own return type exactly — PlotStage passes
  // these straight through from that hook.
  styleList: (SeriesStyle | undefined)[] | undefined;
  plotted: number[];
  hidden: boolean[] | undefined;
  colorByColumns: Map<number, ColorScatterSpec>;
  isDarkBg: boolean;
  inkColor: string;
  defaultTrace: string;
  actions: PlotStageActions;
  readout: Readout | null;
  measurement: Measurement | null;
  stats: RegionStats | null;
  integral: IntegralResult | null;
  fwhm: FwhmResult | null;
  onClearIntegral: () => void;
  onClearFwhm: () => void;
  gadget: GadgetChipState;
}

export default function PlotStageOverlays(p: PlotStageOverlaysProps) {
  return (
    <>
      {p.displayPayload && (
        <PlotToolbar
          onReset={p.actions.resetView}
          onSmartScale={p.actions.smartScale}
          onSavePng={p.actions.savePng}
          onCopyData={p.actions.copyData}
          onSnapshot={p.actions.snapshot}
          onSnapshotWindow={snapshotToNewWindow}
        />
      )}
      {p.displayPayload && <ToolHud tool={p.tool} />}

      {p.insetMode && p.displayPayload && <InsetPlot payload={p.displayPayload} styleList={p.styleList} />}

      {!p.active && (
        <div
          className="qzk-ds-meta"
          style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}
        >
          Select a dataset to plot
        </div>
      )}

      <PlotReadouts tool={p.tool} readout={p.readout} measurement={p.measurement} stats={p.stats} />
      <PlotResultChips
        integral={p.integral}
        fwhm={p.fwhm}
        onClearIntegral={p.onClearIntegral}
        onClearFwhm={p.onClearFwhm}
        gadget={p.gadget}
      />
      {p.displayPayload && p.showLegend && (
        <PlotLegend
          series={p.displayPayload.series}
          styleList={p.styleList}
          plotted={p.plotted}
          hidden={p.hidden}
          colorByColumns={p.colorByColumns}
          isDarkBg={p.isDarkBg}
          inkColor={p.inkColor}
          defaultTrace={p.defaultTrace}
        />
      )}
    </>
  );
}

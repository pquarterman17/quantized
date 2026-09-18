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

import { lazy, Suspense } from "react";

import type { ColorScatterSpec } from "../../lib/colorscatter";
import type { Measurement } from "../../lib/measure";
import type { FwhmResult } from "../../lib/peakwidth";
import type { PlotPayload } from "../../lib/plotdata";
import type { RegionStats } from "../../lib/regionStats";
import type { SeriesCycle } from "../../lib/seriesStyleCycle";
import type { Dataset, DefaultTrace, SeriesStyle } from "../../lib/types";
import type { PlotTool } from "../../lib/uplotOpts";
import type { Readout } from "../../lib/uplotTools";
import type { IntegralResult } from "../../store/useApp";
import { snapshotToNewWindow } from "../windows/useWindowCommands";
import InsetPlot from "./InsetPlot";
import PlotLegend from "./PlotLegend";
import PlotReadouts from "./PlotReadouts";
import PlotToolbar from "./PlotToolbar";
import { resultChipsVisible } from "./resultChipsVisible";
import ToolHud from "./ToolHud";
import type { PlotStageActions } from "./usePlotStageActions";
import type { GadgetChipState } from "./useGadgetChip";

// Bundle diet slice 4 (plans/BUNDLE_HEADROOM.md): the chips render only once
// an on-plot analysis tool has COMMITTED a result (∫ / ∩ / the ROI gadget),
// which is strictly a user action on the canvas — a freshly painted plot and
// a plot restored from a project both have none (the store holds these per
// dataset and the workspace format never serializes them). The gate below is
// the component's OWN visibility predicate, shared through
// `resultChipsVisible` so the gate and the component cannot drift apart.
const PlotResultChips = lazy(() => import("./PlotResultChips"));

export interface PlotStageOverlaysProps {
  displayPayload: PlotPayload | null;
  active: Dataset | null;
  tool: PlotTool;
  insetMode: boolean;
  showLegend: boolean;
  // Matches usePlotPayload's own return type exactly — PlotStage passes
  // these straight through from that hook.
  styleList: (SeriesStyle | undefined)[] | undefined;
  /** P3.3 (`lib/seriesStyleCycle.ts`): the display positions PlotStage opted
   *  this view's canvas into, so the legend swatch and the magnifier inset
   *  resolve the same dash/glyph the plot behind them drew. */
  seriesCycle: SeriesCycle;
  plotted: number[];
  hidden: boolean[] | undefined;
  colorByColumns: Map<number, ColorScatterSpec>;
  isDarkBg: boolean;
  inkColor: string;
  defaultTrace: DefaultTrace;
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

      {p.insetMode && p.displayPayload && (
        <InsetPlot payload={p.displayPayload} styleList={p.styleList} seriesCycle={p.seriesCycle} />
      )}

      {!p.active && (
        <div
          className="qzk-ds-meta"
          style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}
        >
          Select a dataset to plot
        </div>
      )}

      <PlotReadouts tool={p.tool} readout={p.readout} measurement={p.measurement} stats={p.stats} />
      {resultChipsVisible({ integral: p.integral, fwhm: p.fwhm, gadget: p.gadget }) && (
        <Suspense fallback={null}>
          <PlotResultChips
            integral={p.integral}
            fwhm={p.fwhm}
            onClearIntegral={p.onClearIntegral}
            onClearFwhm={p.onClearFwhm}
            gadget={p.gadget}
          />
        </Suspense>
      )}
      {p.displayPayload && p.showLegend && (
        <PlotLegend
          series={p.displayPayload.series}
          styleList={p.styleList}
          seriesCycle={p.seriesCycle}
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

// The multi-panel stage hook's result types, split out of
// `useMultiPanelStage.ts` (its module-size pin) so the hook module holds the
// hook. Re-exported from there, so no importer changed.

import type { CSSProperties, RefObject } from "react";

import type { Readout } from "../../lib/uplotTools";
import type { SpatialLegendEntry } from "./SpatialPanelLegend";

export interface SpatialLegendPortal {
  key: string;
  target: HTMLDivElement;
  entries: SpatialLegendEntry[];
  title?: string;
  frameXY?: [number, number];
}

export interface MultiPanelStageState {
  hostRef: RefObject<HTMLDivElement | null>;
  hostStyle: CSSProperties;
  readout: Readout | null;
  tool: string;
  spatialLegends: SpatialLegendPortal[];
}

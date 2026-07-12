// The three plot-canvas context menus (series/axis, annotation object, shape
// object) — extracted out of PlotStage to keep it under its line ceiling
// (MAIN #27 offset; same reasoning as the useShape*/useLiveSnapshotPublish
// extractions). Pure presentational — every menu's open/closed state and
// item list is computed by the caller's hooks.

import type { RefObject } from "react";
import type uPlot from "uplot";

import type { PlotPayload } from "../../lib/plotdata";
import ContextMenu, { type ContextMenuItem } from "../overlays/ContextMenu";
import PlotContextMenu from "./PlotContextMenu";
import type { PlotStageActions } from "./usePlotStageActions";

interface ObjectMenu {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

export interface PlotStageMenusProps {
  menu: { x: number; y: number } | null;
  onCloseMenu: () => void;
  displayPayload: PlotPayload | null;
  plotRef: RefObject<uPlot | null>;
  plotted: number[];
  hidden: boolean[] | undefined;
  actions: PlotStageActions;
  annotationMenu: ObjectMenu | null;
  onCloseAnnotationMenu: () => void;
  shapeMenu: ObjectMenu | null;
  onCloseShapeMenu: () => void;
}

export default function PlotStageMenus(p: PlotStageMenusProps) {
  return (
    <>
      {p.menu && p.displayPayload && (
        <PlotContextMenu
          x={p.menu.x}
          y={p.menu.y}
          plotRef={p.plotRef}
          payload={p.displayPayload}
          plotted={p.plotted}
          hidden={p.hidden}
          actions={p.actions}
          onClose={p.onCloseMenu}
        />
      )}
      {p.annotationMenu && (
        <ContextMenu
          x={p.annotationMenu.x}
          y={p.annotationMenu.y}
          items={p.annotationMenu.items}
          onClose={p.onCloseAnnotationMenu}
        />
      )}
      {p.shapeMenu && (
        <ContextMenu x={p.shapeMenu.x} y={p.shapeMenu.y} items={p.shapeMenu.items} onClose={p.onCloseShapeMenu} />
      )}
    </>
  );
}

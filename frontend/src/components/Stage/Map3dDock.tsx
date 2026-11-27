// The 3-D panel docked beside the scene (`map3dDockFit.ts` says when): the same panel,
// pinned to the stage's right edge below the toolbar, and the scene gives up that strip.

import type { RefObject } from "react";

import { lazyRegion } from "../../lib/lazyRegion";
import { PANEL_W } from "./map3dDockFit";
import { setMap3dPanelOpen } from "./useMap3dPanelOpen";

const Map3dPanel = lazyRegion(() => import("./Map3dPanel"), "3-D view");

export default function Map3dDock({ datasetId, top, host }: { datasetId: string | null; top: number; host: RefObject<HTMLElement | null> }) {
  const close = () => {
    setMap3dPanelOpen(false);
    const root = host.current?.parentElement;
    (root?.querySelector<HTMLElement>("[data-map3d-btn]") ?? root?.querySelector<HTMLElement>("[data-map-menu]"))?.focus();
  };
  return (
    <Map3dPanel
      datasetId={datasetId}
      onClose={close}
      placement={{ position: "absolute", top, right: 8, bottom: 8, width: PANEL_W, overflowY: "auto", alignContent: "start", zIndex: 3 }}
    />
  );
}

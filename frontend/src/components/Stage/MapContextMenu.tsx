// The 2-D map's context menu (UX menus audit M4); opened by useMapContextMenu.

import { COLORMAPS, type ColormapName } from "../../lib/colormap";
import { copyImage } from "../../lib/clipboard";
import { useAnalysisExtras } from "../../store/analysisExtras";
import { useApp } from "../../store/useApp";
import ContextMenu, { type ContextMenuItem } from "../overlays/ContextMenu";

export interface MapMenuProps {
  x: number;
  y: number;
  datasetId: string | null;
  canvas: HTMLCanvasElement | null;
  cmap: string;
  logZ: boolean;
  contourOn: boolean;
  /** Explicit colour limits are set (Reset range has something to reset). */
  hasColorLimits: boolean;
  /** The displayed axes are an RSM pair (cuts are meaningful), or null. */
  cutSpace: string | null;
  /** The vector export (the toolbar's ⤓). */
  onExport: () => void;
  onClose: () => void;
}

/** Copy the canvas the map is painted on, as a PNG image. */
async function copyCanvas(canvas: HTMLCanvasElement | null, say: (message: string, tone?: "danger") => void): Promise<void> {
  const blob = await new Promise<Blob | null>((resolve) => (canvas ? canvas.toBlob(resolve, "image/png") : resolve(null)));
  say(blob && (await copyImage(blob)) ? "copied the map figure" : "can't copy the map figure: clipboard images are unavailable here", blob ? undefined : "danger");
}

export default function MapContextMenu({ x, y, datasetId, canvas, cmap, logZ, contourOn, hasColorLimits, cutSpace, onExport, onClose }: MapMenuProps) {
  const setMapColormap = useApp((s) => s.setMapColormap);
  const setMapLogZ = useApp((s) => s.setMapLogZ);
  const setContourOn = useApp((s) => s.setContourOn);
  const setMapColorLimits = useApp((s) => s.setMapColorLimits);
  const setRoiCutsOpen = useApp((s) => s.setRoiCutsOpen);
  const setStatus = useApp((s) => s.setStatus);
  const items: ContextMenuItem[] = [
    { label: "Map operations…", run: () => useAnalysisExtras.getState().show("map-ops") },
    { label: "Fit a map stack…", run: () => useAnalysisExtras.getState().show("map-stack-fit") },
    {
      label: "ROI cuts…",
      run: () => setRoiCutsOpen(true),
      disabled: cutSpace == null,
      title: cutSpace == null ? "Needs a 2-D map plotted against 2θ/ω or Qx/Qz." : undefined,
    },
    { separator: true },
    { label: "Color map", submenu: Object.keys(COLORMAPS).map((n) => ({ label: n, checked: n === cmap, run: () => setMapColormap(datasetId, n as ColormapName) })) },
    { label: "Log color scale", checked: logZ, run: () => setMapLogZ(datasetId, !logZ) },
    { label: "Contour lines", checked: contourOn, run: () => setContourOn(!contourOn) },
    {
      label: "Reset color range",
      run: () => setMapColorLimits(datasetId, null),
      disabled: !hasColorLimits,
      title: hasColorLimits ? undefined : "The color range is already automatic.",
    },
    { separator: true },
    { label: "Copy figure", run: () => void copyCanvas(canvas, setStatus) },
    { label: "Export figure…", run: onExport },
  ];
  return <ContextMenu x={x} y={y} items={items} help={{ label: "2-D maps", query: "map operations" }} onClose={onClose} />;
}

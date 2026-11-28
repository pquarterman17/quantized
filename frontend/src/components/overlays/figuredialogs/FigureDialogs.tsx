// The lazy host for the figures-audit dialogs (#6 Axis, #8 Plot type, and gap
// audit 2 #8's per-curve Plot Details, gap audit 3's Layer Contents and #15's
// Layer properties),
// mounted by AppOverlays only while `store/figureDialogs.ts` has one open.
// A modal on the app's escape stack, focus-trapped like every other modal.

import { useId, useRef } from "react";

import { useEscapeSurface } from "../../../lib/escapeStack";
import { sanitizeLayers } from "../../../lib/graphLayers";
import { useFigureDialog } from "../../../store/figureDialogs";
import { useApp } from "../../../store/useApp";
import { useDialogFocus } from "../useDialogFocus";
import AxisDialog from "./AxisDialog";
import { DiscardBar, useDiscardGuard } from "./DiscardGuard";
import ColorGradientDialog from "./ColorGradientDialog";
import GraphLayerDialog from "./GraphLayerDialog";
import LegendDialog from "./LegendDialog";
import LayerContentsDialog from "./LayerContentsDialog";
import PlotDetailsDialog from "./PlotDetailsDialog";
import PlotSetupDialog from "./PlotSetupDialog";
import PlotTypeGallery from "./PlotTypeGallery";

const LAYER_TITLES = { inset: "Inset graph", image: "Image", table: "Table" } as const;

export default function FigureDialogs() {
  const open = useFigureDialog((s) => s.open);
  const close = () => useFigureDialog.setState({ open: null });
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const layers = useApp((s) => s.layers);
  const guard = useDiscardGuard(open, close);
  useEscapeSurface("modal", () => { close(); return true; }, open !== null);
  useDialogFocus(dialogRef, open !== null);
  if (!open) return null;
  // UX10-D: a layer dialog is named for what the Insert command made ("Table",
  // like Insert ▸ Table…), not the generic "Layer properties".
  const layerKind = open.kind === "graphLayer" ? (open.draft ?? sanitizeLayers(layers).find((l) => l.id === open.id))?.kind : undefined;
  const title = open.kind === "axis" ? "Axis" : open.kind === "plotDetails" ? "Plot details" : open.kind === "layerContents" ? "Layer contents" : open.kind === "plotSetup" ? "Plot setup" : open.kind === "graphLayer" ? (layerKind ? LAYER_TITLES[layerKind] : "Graph layer") : open.kind === "colorGradient" ? "Color gradient" : open.kind === "legend" ? "Legend" : "Plot type";
  return (
    <div className="qz-overlay-backdrop" onMouseDown={guard.onBackdrop}>
      <div
        className="qzk-glass qz-dialog"
        role="dialog"
        aria-labelledby={titleId}
        ref={dialogRef}
        tabIndex={-1}
        style={{ maxWidth: open.kind === "plotSetup" ? 640 : 480, maxHeight: "78vh", display: "flex", flexDirection: "column", overflow: "hidden" }}
        onMouseDown={(e) => e.stopPropagation()}
        {...guard.editProps}
      >
        {/* The fields scroll; the "Discard your changes?" bar sits below them, so it never covers a row. */}
        <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" }} data-testid="figure-dialog-body">
        <h2 id={titleId}>{title}</h2>
        {open.kind === "axis" ? <AxisDialog key={open.axis} axis={open.axis} onClose={close} />
          : open.kind === "plotDetails" ? <PlotDetailsDialog key={open.channel} channel={open.channel} onClose={close} />
          : open.kind === "plotSetup" ? <PlotSetupDialog seed={open.seed} onClose={close} />
          : open.kind === "layerContents" ? <LayerContentsDialog onClose={close} />
          : open.kind === "legend" ? <LegendDialog onClose={close} />
          : open.kind === "colorGradient" ? <ColorGradientDialog onClose={close} />
          : open.kind === "graphLayer" ? <GraphLayerDialog key={open.id} id={open.id} draft={open.draft} onClose={close} />
          : <PlotTypeGallery onClose={close} />}
        </div>
        {guard.asking && <DiscardBar onKeep={guard.keepEditing} onDiscard={close} />}
      </div>
    </div>
  );
}

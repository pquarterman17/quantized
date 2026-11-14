// The lazy host for the figures-audit dialogs (#6 Axis, #8 Plot type, and gap
// audit 2 #8's per-curve Plot Details),
// mounted by AppOverlays only while `store/figureDialogs.ts` has one open.
// A modal on the app's escape stack, focus-trapped like every other modal.

import { useId, useRef } from "react";

import { useEscapeSurface } from "../../../lib/escapeStack";
import { useFigureDialog } from "../../../store/figureDialogs";
import { useDialogFocus } from "../useDialogFocus";
import AxisDialog from "./AxisDialog";
import PlotDetailsDialog from "./PlotDetailsDialog";
import PlotTypeGallery from "./PlotTypeGallery";

export default function FigureDialogs() {
  const open = useFigureDialog((s) => s.open);
  const close = () => useFigureDialog.setState({ open: null });
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  useEscapeSurface("modal", () => { close(); return true; }, open !== null);
  useDialogFocus(dialogRef, open !== null);
  if (!open) return null;
  const title = open.kind === "axis" ? "Axis" : open.kind === "plotDetails" ? "Plot Details" : "Plot type";
  return (
    <div className="qz-overlay-backdrop" onMouseDown={close}>
      <div
        className="qzk-glass qz-dialog"
        role="dialog"
        aria-labelledby={titleId}
        ref={dialogRef}
        tabIndex={-1}
        style={{ maxWidth: 480, maxHeight: "78vh", overflowY: "auto" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id={titleId}>{title}</h2>
        {open.kind === "axis" ? <AxisDialog key={open.axis} axis={open.axis} onClose={close} />
          : open.kind === "plotDetails" ? <PlotDetailsDialog key={open.channel} channel={open.channel} onClose={close} />
          : <PlotTypeGallery onClose={close} />}
      </div>
    </div>
  );
}

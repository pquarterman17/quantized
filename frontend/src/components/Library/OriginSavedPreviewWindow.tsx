// Movable reference view for an Origin graph's file-saved PNG. The preview
// stays independent of the editable renderer: users can park it beside the
// Stage while they inspect or remake the native graph. No reconstruction
// state is inferred from the bitmap.

import { useEffect } from "react";
import { createPortal } from "react-dom";

import { Button } from "../primitives";
import ToolWindow from "../overlays/ToolWindow";
import { figureLabel, type OriginFigureEntry } from "../../lib/originFigures";
import { useApp } from "../../store/useApp";

export default function OriginSavedPreviewWindow({
  entry,
  src,
  onClose,
}: {
  entry: OriginFigureEntry;
  src: string;
  onClose: () => void;
}) {
  const applyOriginFigure = useApp((s) => s.applyOriginFigure);
  const preview = entry.figure.saved_preview;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  if (!preview) return null;
  const attribution = preview.confidence === "exact_page"
    ? "Exact graph-page attribution"
    : "Ambiguous page attribution";

  return createPortal(
    <ToolWindow
      id={`origin-preview-${entry.id}`}
      title={`Saved Origin preview · ${figureLabel(entry)}`}
      x={Math.max(24, window.innerWidth - 640)}
      y={72}
      width={600}
      onClose={onClose}
    >
      <figure className="qzk-origin-preview-window" aria-label={`Saved Origin preview of ${figureLabel(entry)}`}>
        <div className="qzk-origin-preview-meta">
          <span className="qz-badge qz-accent">Origin file reference</span>
          <span>{preview.width} × {preview.height} PNG</span>
          <span>{attribution}</span>
        </div>
        <div className="qzk-origin-preview-canvas">
          <img
            src={src}
            width={preview.width}
            height={preview.height}
            alt={`Saved Origin preview of ${figureLabel(entry)}`}
          />
        </div>
        <figcaption>
          Keep this reference window beside the editable Stage to compare layout and styling.
        </figcaption>
        <small>
          This image was saved inside the Origin project and may be stale or low resolution.
          It is a visual reference, not decoded plot data.
        </small>
        <div className="qz-btn-row">
          <Button
            variant="primary"
            size="sm"
            disabled={entry.datasetId == null}
            onClick={() => applyOriginFigure(entry.id)}
          >
            Restore editable graph on Stage
          </Button>
          <Button size="sm" onClick={onClose}>Close reference</Button>
        </div>
      </figure>
    </ToolWindow>,
    document.body,
  );
}

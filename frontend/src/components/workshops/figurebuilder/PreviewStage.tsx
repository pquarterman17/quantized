// The Publication preview's picture (UX audit 7, lane UX-H): the rendered
// figure at its true aspect, large, in a fixed-height pane, with a
// "Fit / 100 %" toggle, cm rulers along the top and left edges and a size
// readout. "Fit" fills the pane; "100 %" shows the figure at its physical
// size (96 CSS px per inch) and scrolls when it is bigger than the pane.
//
// Sizing is CSS-only: the pane height is a fixed expression, so the fit width
// is `min(pane width, pane height × aspect)` without measuring the DOM. The
// rulers share the figure's grid track, so they are exactly as long as the
// picture in either mode. Their ticks are placed in % of the figure's own cm
// size (previewSizing.renderedSizeCm), never in screen pixels.

import { useState, type ComponentProps, type CSSProperties } from "react";

import { formatSizeCm } from "./figurePresets";
import PreviewOverlay from "./PreviewOverlay";
import PreviewWarnings from "./PreviewWarnings";
import { renderedSizeCm, rulerSteps, trueSizeCssPx } from "./previewSizing";
import { SegmentedControl } from "../../primitives/SegmentedControl";
import { toInches } from "../../../lib/pageGeometry";
import type { FigureHitmap } from "../../../lib/previewmap";

type Zoom = "fit" | "100";
type OverlayProps = Omit<ComponentProps<typeof PreviewOverlay>, "src" | "map">;

const PANE_H = "min(680px, calc(100vh - 220px))";
const PAD = 12;
const RULER = 18;

const TEXT: CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-faint)", lineHeight: 1 };

/** One edge's ruler: a tick every `minor` cm, a numbered one every `major`. */
export function FigureRuler({ lengthCm, vertical = false }: { lengthCm: number; vertical?: boolean }) {
  const { major, minor } = rulerSteps(lengthCm);
  const count = Math.floor(lengthCm / minor + 1e-6);
  const ticks = Array.from({ length: count + 1 }, (_, i) => i * minor);
  return (
    <div
      aria-hidden="true"
      data-ruler={vertical ? "y" : "x"}
      style={{
        position: "relative",
        [vertical ? "borderRight" : "borderBottom"]: "1px solid var(--border)",
      }}
    >
      {ticks.map((cm) => {
        const isMajor = Math.abs(cm / major - Math.round(cm / major)) < 1e-6;
        const at = `${(cm / lengthCm) * 100}%`;
        const len = isMajor ? 8 : 4;
        return (
          <span key={cm}>
            <span
              style={{
                position: "absolute",
                background: "var(--text-faint)",
                ...(vertical
                  ? { top: at, right: 0, width: len, height: 1 }
                  : { left: at, bottom: 0, height: len, width: 1 }),
              }}
            />
            {isMajor && cm > 0 && (
              <span
                style={{
                  position: "absolute",
                  ...TEXT,
                  ...(vertical ? { top: at, left: 1, transform: "translateY(-50%)" } : { left: at, top: 1, transform: "translateX(-50%)" }),
                }}
              >
                {cm}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

export default function PreviewStage({
  preview, hitmap, previewDpi, error, busy, overlay,
}: {
  preview: string | null;
  hitmap: FigureHitmap | null;
  previewDpi: number | null;
  error: string | null;
  busy: boolean;
  overlay: OverlayProps;
}) {
  const [zoom, setZoom] = useState<Zoom>("fit");
  const ready = !error && preview && hitmap && previewDpi && hitmap.width > 0 && hitmap.height > 0;
  const size = ready ? renderedSizeCm(hitmap.width, hitmap.height, previewDpi) : null;

  let body;
  if (error) {
    body = (
      <div role="alert" aria-live="polite" className="qzk-msg" style={{ color: "var(--danger)", margin: "auto", maxWidth: 420 }}>
        {error}
      </div>
    );
  } else if (ready && size) {
    const aspect = hitmap.width / hitmap.height;
    const width = zoom === "100"
      ? `${trueSizeCssPx(size.widthCm) + RULER}px`
      : `min(100%, calc((${PANE_H} - ${2 * PAD + RULER}px) * ${aspect.toFixed(4)} + ${RULER}px))`;
    body = (
      <div
        data-testid="figure-preview-frame"
        data-zoom={zoom}
        style={{
          width,
          // auto on both axes centres the figure in the pane; an overflowing
          // "100 %" figure gets zero margins and scrolls from its top-left.
          margin: "auto",
          flexShrink: 0,
          display: "grid",
          gridTemplateColumns: `${RULER}px 1fr`,
          gridTemplateRows: `${RULER}px auto`,
        }}
      >
        <span style={{ ...TEXT, alignSelf: "center" }}>cm</span>
        <FigureRuler lengthCm={size.widthCm} />
        <FigureRuler lengthCm={size.heightCm} vertical />
        <div style={{ boxShadow: "var(--shadow)", minWidth: 0 }}>
          <PreviewOverlay src={preview} map={hitmap} {...overlay} />
        </div>
      </div>
    );
  } else {
    body = (
      <div style={{ ...TEXT, fontSize: "var(--font-size-sm)", margin: "auto" }}>
        {busy ? "rendering…" : "preview"}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <SegmentedControl<Zoom>
          aria-label="Preview zoom"
          options={[
            { value: "fit", label: "Fit" },
            { value: "100", label: "100 %", ariaLabel: "Actual size (100 %)" },
          ]}
          value={zoom}
          onChange={setZoom}
        />
        {size && (
          <span
            aria-label="Figure size"
            title="The exported figure's physical size; 100 % shows it at that size on screen."
            style={{ ...TEXT, fontSize: "var(--font-size-sm)", color: "var(--text-dim)" }}
          >
            {formatSizeCm(size.widthCm, size.heightCm)} · {toInches(size.widthCm, "cm").toFixed(2)} × {toInches(size.heightCm, "cm").toFixed(2)} in
          </span>
        )}
        {busy && ready && <span style={{ ...TEXT, fontSize: "var(--font-size-sm)" }}>updating…</span>}
      </div>
      <div
        data-testid="figure-preview-pane"
        style={{
          height: PANE_H,
          boxSizing: "border-box",
          padding: PAD,
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
          background: "var(--surface-1)",
          borderRadius: "var(--radius-sm)",
        }}
      >
        {body}
      </div>
      {ready && <PreviewWarnings warnings={hitmap.warnings} />}
    </div>
  );
}

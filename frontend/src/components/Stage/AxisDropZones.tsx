// Drag-to-axis (ORIGIN_GAP_PLAN #49) drop-target shim. Wraps PlotStage's outer
// element: listens for a CHANNEL_DND drag anywhere over the stage (events
// bubble up from any descendant — the uPlot canvas, toolbar, legend — so this
// one listener set is enough, no per-band handlers needed) and shows three
// edge bands (bottom = X, left = Y, right = Y2) while it's in progress, with
// the band under the cursor highlighted. The band overlay is purely visual
// (`pointer-events: none`) so it never intercepts normal plot interaction;
// zone geometry is the pure `resolveAxisZone` (lib/dragaxis.ts) against this
// element's own bounding rect. Dropping decodes the chip payload and hands
// (zone, datasetId, channel) to the caller — this component makes no store
// calls itself, keeping it testable without the store or a real drag gesture
// (jsdom has no native DnD; see the .test file for the synthetic-event +
// getBoundingClientRect-mock pattern).

import { useRef, useState } from "react";

import { CHANNEL_DND, decodeChannelDrag, resolveAxisZone, type AxisZone } from "../../lib/dragaxis";

interface Props {
  className: string;
  /** Inline style passthrough (item 18 — a per-window background override
   *  paints THIS window's plot area a fixed colour, independent of the
   *  `--axes-bg` the CSS class already sets). Omitted/undefined renders no
   *  `style` attribute at all — the default ("theme") path stays
   *  byte-identical to pre-item-18 markup. */
  style?: React.CSSProperties;
  onContextMenu: (e: React.MouseEvent) => void;
  /** Fires once per valid drop with the decoded payload. A drop in the dead
   *  interior (no zone) or a malformed/foreign payload never reaches here. */
  onAxisDrop: (zone: AxisZone, datasetId: string, channel: number) => void;
  children: React.ReactNode;
}

export default function AxisDropZones({ className, style, onContextMenu, onAxisDrop, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // Nested-element enter/leave counter (the standard DnD pattern): entering
  // any descendant bubbles dragenter to us too, so depth only reaches 0 when
  // the pointer truly leaves the whole stage subtree.
  const [depth, setDepth] = useState(0);
  const [zone, setZone] = useState<AxisZone | null>(null);

  const isChannelDrag = (e: React.DragEvent): boolean => e.dataTransfer.types.includes(CHANNEL_DND);

  const zoneAt = (e: React.DragEvent): AxisZone | null => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return null;
    return resolveAxisZone(
      { width: rect.width, height: rect.height },
      { x: e.clientX - rect.left, y: e.clientY - rect.top },
    );
  };

  return (
    <div
      ref={ref}
      className={className}
      style={style}
      onContextMenu={onContextMenu}
      onDragEnter={(e) => {
        if (!isChannelDrag(e)) return;
        e.preventDefault();
        setDepth((d) => d + 1);
      }}
      onDragOver={(e) => {
        if (!isChannelDrag(e)) return;
        e.preventDefault(); // required every dragover to keep the drop legal
        setZone(zoneAt(e));
      }}
      onDragLeave={(e) => {
        if (!isChannelDrag(e)) return;
        setDepth((d) => Math.max(0, d - 1));
      }}
      onDrop={(e) => {
        if (!isChannelDrag(e)) return;
        e.preventDefault();
        const landedZone = zoneAt(e);
        setDepth(0);
        setZone(null);
        if (!landedZone) return; // dropped in the dead interior — cancel
        const payload = decodeChannelDrag(e.dataTransfer.getData(CHANNEL_DND));
        if (payload) onAxisDrop(landedZone, payload.datasetId, payload.channel);
      }}
    >
      {children}
      {depth > 0 && (
        <div className="qzk-axis-drop-zones" aria-hidden="true">
          <div className={`qzk-axis-zone x${zone === "x" ? " active" : ""}`} />
          <div className={`qzk-axis-zone y${zone === "y" ? " active" : ""}`} />
          <div className={`qzk-axis-zone y2${zone === "y2" ? " active" : ""}`} />
        </div>
      )}
    </div>
  );
}

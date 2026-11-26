// The Peaks panel's "Align to peak…" button and its lazily loaded window
// (kept out of PeaksPanel.tsx for the component-size ceiling). The panel renders
// the window as a SIBLING of its own frame, never inside it: a floating window is
// absolutely positioned, so nested in the docked Peaks panel it was placed from
// that panel's corner and opened off the right edge of the screen.

import { lazyRegion } from "../../../lib/lazyRegion";
import { Button } from "../../primitives";

// Opened on demand only: its chunk loads on the first click.
export const AlignPeaksWindow = lazyRegion(() => import("./AlignPeaksWindow"), "Align to peak");

/** The row of buttons that open the panel's two windows (Batch integrate, Align to peak). */
export default function PeakWindowButtons({ onBatch, onAlign }: { onBatch: () => void; onAlign: () => void }) {
  return (
    <div style={{ marginTop: 6 }}>
      <Button size="sm" title="Integrate windows across many datasets." onClick={onBatch}>Batch integrate…</Button>
      <Button size="sm" title="Shift the X of several datasets so a chosen peak lines up." onClick={onAlign}
        style={{ marginLeft: 6 }}>
        Align to peak…
      </Button>
    </div>
  );
}

// The Peaks panel's "Align to peak…" button and its lazily loaded window
// (kept out of PeaksPanel.tsx for the component-size ceiling).

import { lazyRegion } from "../../../lib/lazyRegion";
import { Button } from "../../primitives";
import { useBatchWindowOpen } from "./useBatchWindowOpen";

// Opened on demand only: its chunk loads on the first click.
const AlignPeaksWindow = lazyRegion(() => import("./AlignPeaksWindow"), "Align to peak");

export default function AlignPeaksLauncher({ seedPeaks }: { seedPeaks: readonly { center: number; fwhm: number }[] }) {
  // Also opens for "Open in Align to peak" on an aligned output.
  const [open, setOpen] = useBatchWindowOpen("peak-align");
  return (
    <>
      <Button size="sm" title="Shift the X of several datasets so a chosen peak lines up." onClick={() => setOpen(true)}
        style={{ marginLeft: 6 }}>
        Align to peak…
      </Button>
      {open && <AlignPeaksWindow seedPeaks={seedPeaks} onClose={() => setOpen(false)} />}
    </>
  );
}

// The Peaks panel's "Align to peak…" button and its lazily loaded window
// (kept out of PeaksPanel.tsx for the component-size ceiling).

import { useState } from "react";

import { lazyRegion } from "../../../lib/lazyRegion";
import { Button } from "../../primitives";

// Opened on demand only: its chunk loads on the first click.
const AlignPeaksWindow = lazyRegion(() => import("./AlignPeaksWindow"), "Align to peak");

export default function AlignPeaksLauncher({ seedPeaks }: { seedPeaks: readonly { center: number; fwhm: number }[] }) {
  const [open, setOpen] = useState(false);
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

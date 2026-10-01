// The ONE lazy chunk both aux-figure workshops (ternary diagram, vector
// field) mount through. AppOverlays gates it on either open flag, so the
// eager bundle pays one preload stub and one chunk-name entry for the pair
// rather than two (measured 2026-09-30: the second stub, its deps array and
// the shared-chunk names it forced cost ~0.3 kB eager against a pin with
// 0.1 kB of headroom). Inside the chunk each panel stays gated on its own
// flag, so opening one never mounts the other.

import FieldPlotPanel from "../fieldplot/FieldPlotPanel";
import { useAuxFigureStore } from "./auxFigureStore";
import TernaryPanel from "./TernaryPanel";

export default function AuxFigurePanels() {
  const ternaryOpen = useAuxFigureStore((s) => s.ternaryOpen);
  const fieldOpen = useAuxFigureStore((s) => s.fieldOpen);
  return (
    <>
      {ternaryOpen && <TernaryPanel />}
      {fieldOpen && <FieldPlotPanel />}
    </>
  );
}

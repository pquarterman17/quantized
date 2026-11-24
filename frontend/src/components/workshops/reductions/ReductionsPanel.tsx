// Reductions workshop — view. A draggable ToolWindow with a method picker
// (Williamson-Hall / FFT film thickness / Reflectivity FFT); each method is a
// self-contained section (its own hook + inputs + results). The Analyze-menu
// commands ("Williamson-Hall…", "Film thickness (FFT)…", "Reflectivity
// FFT…") open this SAME window pre-set to their method via the store's
// `reductionsMethod` (see store/reductions.ts, appCommands.ts's
// `openReductions`). Thin — logic lives in the per-method hooks.

import ToolWindow from "../../overlays/ToolWindow";
import { Select } from "../../primitives";
import type { ReductionsMethod } from "../../../store/reductions";
import { useApp } from "../../../store/useApp";
import { useReopenScope } from "../resultcommit/useReopenSession";
import FftThicknessSection from "./FftThicknessSection";
import PawleySection from "./PawleySection";
import ReferencePatternSection from "./ReferencePatternSection";
import ReflectivityFftSection from "./ReflectivityFftSection";
import WilliamsonHallSection from "./WilliamsonHallSection";

/** The window title per method, so it matches the Analyze command that opened
 *  it (UX10-D: "Williamson-Hall…" used to open a window titled "Reductions"). */
const TITLES: Record<ReductionsMethod, string> = {
  "williamson-hall": "Williamson-Hall",
  pawley: "Pawley refinement",
  "xrd-reference": "XRD reference pattern",
  "fft-thickness": "Film thickness (FFT)",
  "reflectivity-fft": "Reflectivity FFT",
};

const METHODS: { value: ReductionsMethod; label: string }[] = [
  { value: "williamson-hall", label: "Williamson-Hall (size + strain)" },
  { value: "pawley", label: "Pawley refinement (unit cell)" },
  { value: "xrd-reference", label: "XRD reference pattern (sticks)" },
  { value: "fft-thickness", label: "Film thickness (XRD FFT)" },
  { value: "reflectivity-fft", label: "Reflectivity FFT (Kiessig / superlattice)" },
];

export default function ReductionsPanel() {
  const setOpen = useApp((s) => s.setReductionsOpen);
  const method = useApp((s) => s.reductionsMethod);
  const setMethod = useApp((s) => s.setReductionsMethod);
  // A new "Open in" session remounts its method's section so it seeds afresh.
  const fftScope = useReopenScope("fft-thickness");
  const reflScope = useReopenScope("reflectivity-fft");
  const pawleyScope = useReopenScope("pawley");

  return (
    <ToolWindow id="reductions" title={TITLES[method] ?? "Reductions"} width={380} dockable onClose={() => setOpen(false)}>
      <label className="qzk-field-lbl">Method</label>
      <Select
        options={METHODS}
        value={method}
        onChange={(e) => setMethod(e.target.value as ReductionsMethod)}
      />
      {method === "williamson-hall" && <WilliamsonHallSection />}
      {method === "pawley" && <PawleySection key={pawleyScope} />}
      {method === "xrd-reference" && <ReferencePatternSection />}
      {method === "fft-thickness" && <FftThicknessSection key={fftScope} />}
      {method === "reflectivity-fft" && <ReflectivityFftSection key={reflScope} />}
    </ToolWindow>
  );
}

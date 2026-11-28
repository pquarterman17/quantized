// Design of experiments (GAP_AUDIT_9 J16, JMP DOE / Minitab Create Factorial
// Design / Origin DOE): generate a factorial, fractional, Plackett-Burman or
// response-surface design as a worksheet with coded and actual factor
// columns, a run order and an empty response column; then analyze it in Fit
// Model. Thin view: the form is DoeSetup, the active design DoeActive, the
// numbers are calc/doe.py.

import { lazyRegion } from "../../../lib/lazyRegion";
import ToolWindow from "../../overlays/ToolWindow";
import { useDoeStore } from "../../../store/doe";
import DoeActive from "./DoeActive";
import DoeSetup from "./DoeSetup";
import { useDoe } from "./useDoe";

const DoePresetBar = lazyRegion(() => import("./DoePresetBar"), "Presets");

export default function DoePanel() {
  const setOpen = useDoeStore((s) => s.setOpen);
  const d = useDoe();
  return (
    <ToolWindow id="doe" title="Design of experiments" width={560} onClose={() => setOpen(false)}>
      <DoePresetBar d={d} />
      <DoeSetup d={d} />
      <DoeActive generated={d.generated} />
    </ToolWindow>
  );
}

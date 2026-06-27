// Calculators workshop — a draggable ToolWindow that routes between calculator
// tabs (Units / X-ray / Crystal / Elements / Constants). Thin shell: each tab is
// its own sub-component; shared state/logic lives in the useCalculators hook, and
// the math is golden in calc.{unit_convert,xray,crystallography,constants,element_data}.

import ToolWindow from "../../overlays/ToolWindow";
import { SegmentedControl } from "../../primitives";
import { useApp } from "../../../store/useApp";
import ConstantsTab from "./ConstantsTab";
import CrystalTab from "./CrystalTab";
import ElementsTab from "./ElementsTab";
import UnitsTab from "./UnitsTab";
import XrayTab from "./XrayTab";
import { useCalculators, type CalcTab } from "./useCalculators";

const TABS: { value: CalcTab; label: string }[] = [
  { value: "units", label: "Units" },
  { value: "xray", label: "X-ray" },
  { value: "crystal", label: "Crystal" },
  { value: "elements", label: "Elements" },
  { value: "constants", label: "Constants" },
];

export default function CalculatorsPanel() {
  const setOpen = useApp((s) => s.setCalculatorsOpen);
  const c = useCalculators();

  return (
    <ToolWindow title="Calculators" width={360} onClose={() => setOpen(false)}>
      <SegmentedControl<CalcTab> options={TABS} value={c.tab} onChange={c.setTab} />

      {c.tab === "units" && <UnitsTab c={c} />}
      {c.tab === "xray" && <XrayTab c={c} />}
      {c.tab === "crystal" && <CrystalTab c={c} />}
      {c.tab === "elements" && <ElementsTab />}
      {c.tab === "constants" && <ConstantsTab c={c} />}
    </ToolWindow>
  );
}

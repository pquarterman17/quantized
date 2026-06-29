// Calculators workshop — a draggable ToolWindow that routes between calculator
// tabs grouped by domain. Thin shell: each tab is its own sub-component. The
// original tabs share state via the useCalculators hook; newer domain tabs are
// self-contained (own local state). The math is golden in calc.* on the backend.

import ToolWindow from "../../overlays/ToolWindow";
import { useApp } from "../../../store/useApp";
import ConstantsTab from "./ConstantsTab";
import CrystalTab from "./CrystalTab";
import ElectricalTab from "./ElectricalTab";
import ElementsTab from "./ElementsTab";
import SldTab from "./SldTab";
import UnitsTab from "./UnitsTab";
import XrayTab from "./XrayTab";
import { useCalculators, type CalcTab } from "./useCalculators";

// Domain groups — render as <optgroup>s so the selector scales past a flat
// segmented control as more calculator domains are ported.
const TAB_GROUPS: { group: string; tabs: { value: CalcTab; label: string }[] }[] = [
  {
    group: "Conversion",
    tabs: [
      { value: "units", label: "Units" },
      { value: "constants", label: "Constants" },
    ],
  },
  {
    group: "Structure",
    tabs: [
      { value: "xray", label: "X-ray / Neutron" },
      { value: "crystal", label: "Crystal" },
      { value: "sld", label: "SLD" },
      { value: "elements", label: "Elements" },
    ],
  },
  {
    group: "Transport",
    tabs: [{ value: "electrical", label: "Electrical" }],
  },
];

export default function CalculatorsPanel() {
  const setOpen = useApp((s) => s.setCalculatorsOpen);
  const c = useCalculators();

  return (
    <ToolWindow title="Calculators" width={360} onClose={() => setOpen(false)}>
      <select
        className="qz-select"
        style={{ width: "100%" }}
        value={c.tab}
        onChange={(e) => c.setTab(e.target.value as CalcTab)}
        aria-label="calculator"
      >
        {TAB_GROUPS.map((g) => (
          <optgroup key={g.group} label={g.group}>
            {g.tabs.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {c.tab === "units" && <UnitsTab c={c} />}
      {c.tab === "xray" && <XrayTab c={c} />}
      {c.tab === "crystal" && <CrystalTab c={c} />}
      {c.tab === "sld" && <SldTab c={c} />}
      {c.tab === "elements" && <ElementsTab />}
      {c.tab === "constants" && <ConstantsTab c={c} />}
      {c.tab === "electrical" && <ElectricalTab />}
    </ToolWindow>
  );
}

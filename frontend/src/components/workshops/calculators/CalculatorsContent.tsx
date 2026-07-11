// Calculators content — the tab selector + active tab body, extracted from
// CalculatorsPanel (MAIN_PLAN #22 standalone DiraCulator launcher) so the
// calc-only SPA view (CalcOnlyApp, ?view=calc) can mount the SAME content
// full-window without the draggable ToolWindow chrome. CalculatorsPanel
// wraps this in a ToolWindow for the in-app workshop mount.

import ConstantsTab from "./ConstantsTab";
import CrystalTab from "./CrystalTab";
import DiffusionTab from "./DiffusionTab";
import ElectricalTab from "./ElectricalTab";
import ElectrochemistryTab from "./ElectrochemistryTab";
import ElementsTab from "./ElementsTab";
import FavoritesTab from "./FavoritesTab";
import HistoryTab from "./HistoryTab";
import HomeTab from "./HomeTab";
import MagneticTab from "./MagneticTab";
import OpticsTab from "./OpticsTab";
import SemiconductorTab from "./SemiconductorTab";
import SldTab from "./SldTab";
import SubstratesTab from "./SubstratesTab";
import SuperconductorTab from "./SuperconductorTab";
import ThermalTab from "./ThermalTab";
import ThinFilmTab from "./ThinFilmTab";
import UnitsTab from "./UnitsTab";
import VacuumTab from "./VacuumTab";
import XrayTab from "./XrayTab";
import { useCalculators, type CalcTab } from "./useCalculators";

// Domain groups — render as <optgroup>s so the selector scales past a flat
// segmented control as more calculator domains are ported. Exported so the Home
// tab can render the same grouped index without the two drifting apart.
export const TAB_GROUPS: { group: string; tabs: { value: CalcTab; label: string }[] }[] = [
  {
    group: "Session",
    tabs: [
      { value: "home", label: "Home" },
      { value: "history", label: "History" },
      { value: "favorites", label: "Favorites" },
    ],
  },
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
      { value: "substrates", label: "Substrates" },
    ],
  },
  {
    group: "Transport",
    tabs: [
      { value: "electrical", label: "Electrical" },
      { value: "thermal", label: "Thermal" },
      { value: "diffusion", label: "Diffusion" },
    ],
  },
  {
    group: "Optics & Vacuum",
    tabs: [
      { value: "optics", label: "Optics" },
      { value: "vacuum", label: "Vacuum" },
    ],
  },
  {
    group: "Devices",
    tabs: [
      { value: "semiconductor", label: "Semiconductor" },
      { value: "superconductor", label: "Superconductor" },
      { value: "thinfilm", label: "Thin Film" },
    ],
  },
  {
    group: "Magnetism",
    tabs: [{ value: "magnetic", label: "Magnetic" }],
  },
  {
    group: "Electrochemistry",
    tabs: [{ value: "electrochemistry", label: "Electrochemistry" }],
  },
];

export default function CalculatorsContent() {
  const c = useCalculators();

  return (
    <>
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

      {c.tab === "home" && <HomeTab onPick={c.setTab} />}
      {c.tab === "history" && <HistoryTab />}
      {c.tab === "favorites" && <FavoritesTab />}
      {c.tab === "units" && <UnitsTab c={c} />}
      {c.tab === "xray" && <XrayTab c={c} />}
      {c.tab === "crystal" && <CrystalTab c={c} />}
      {c.tab === "sld" && <SldTab c={c} />}
      {c.tab === "elements" && <ElementsTab />}
      {c.tab === "constants" && <ConstantsTab c={c} />}
      {c.tab === "electrical" && <ElectricalTab />}
      {c.tab === "thermal" && <ThermalTab />}
      {c.tab === "diffusion" && <DiffusionTab />}
      {c.tab === "optics" && <OpticsTab />}
      {c.tab === "vacuum" && <VacuumTab />}
      {c.tab === "electrochemistry" && <ElectrochemistryTab />}
      {c.tab === "substrates" && <SubstratesTab />}
      {c.tab === "semiconductor" && <SemiconductorTab />}
      {c.tab === "superconductor" && <SuperconductorTab />}
      {c.tab === "thinfilm" && <ThinFilmTab />}
      {c.tab === "magnetic" && <MagneticTab />}
    </>
  );
}

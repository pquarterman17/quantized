// Calculators workshop — the composing state hook. The four shared-state
// domains each live in their own bounded hook (DIRACULATOR_AUDIT P3 split:
// useUnitsCalc / useXrayCalc / useCrystalCalc / useSldCalc — every setter
// carries the P1 provenance contract); this file owns only the tab selector,
// the constants fetch, the composition, and the cross-panel handoffs. The
// facade is stable: consumers keep importing `useCalculators`,
// `CalculatorsState`, and the domain metadata from THIS module.

import { useEffect, useState } from "react";

import { getConstants } from "../../../lib/api";
import { useCrystalCalc, type CrystalCalcState } from "./useCrystalCalc";
import { useSldCalc, type SldCalcState } from "./useSldCalc";
import { useUnitsCalc, type UnitsCalcState } from "./useUnitsCalc";
import { useXrayCalc, type XrayCalcState } from "./useXrayCalc";

// Facade re-exports — the domain metadata/type surface tabs have always
// imported from "./useCalculators" (kept working across the P3 split).
export { QUICK_PAIRS } from "./useUnitsCalc";
export { ANODE_PRESETS, XRAY_MODES, type XrayResult } from "./useXrayCalc";
export {
  assembleCell,
  CRYSTAL_SYSTEMS,
  type CellAngle,
  type CrystalForm,
} from "./useCrystalCalc";
export { NEUTRON_WAVELENGTHS, SLD_PRESETS, WAVELENGTHS, type SldForm } from "./useSldCalc";

// Original shared-state tabs + self-contained domain tabs (each owns its own
// hook; only the union member is needed here for the panel's tab selector).
export type CalcTab =
  | "home"
  | "history"
  | "favorites"
  | "units"
  | "constants"
  | "xray"
  | "crystal"
  | "sld"
  | "elements"
  | "electrical"
  | "thermal"
  | "diffusion"
  | "optics"
  | "vacuum"
  | "electrochemistry"
  | "substrates"
  | "semiconductor"
  | "superconductor"
  | "thinfilm"
  | "magnetic";

export interface CalculatorsState
  extends UnitsCalcState,
    XrayCalcState,
    CrystalCalcState,
    SldCalcState {
  tab: CalcTab;
  setTab: (t: CalcTab) => void;
  // Constants
  constants: Record<string, number> | null;
  // Cross-panel hooks — hand a computed value to a related shared-state tab.
  sendDToXray: () => void; // Crystal d-spacing → X-ray tab (d → 2θ → Q)
  sendFormulaToCrystal: () => void; // SLD formula → Crystal cell-volume/density (molar mass)
  sendCellToSld: () => void; // Crystal formula + theoretical density → SLD tab
}

export function useCalculators(): CalculatorsState {
  const [tab, setTab] = useState<CalcTab>("units");
  const [constants, setConstants] = useState<Record<string, number> | null>(null);

  const units = useUnitsCalc();
  const xray = useXrayCalc();
  const crystal = useCrystalCalc();
  const sldCalc = useSldCalc();

  useEffect(() => {
    let cancelled = false;
    getConstants()
      .then((r) => {
        if (!cancelled) setConstants(r.constants);
      })
      .catch(() => {
        /* offline — constants tab shows a notice */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Cross-panel hooks ──────────────────────────────────────────────────────
  // The target-domain setters already invalidate their panel's shown result
  // (the P1 provenance contract), so a handoff never leaves a stale display.

  // Crystal d-spacing → X-ray tab: seed the d→2θ conversion with the computed d
  // (then 2θ→Q is one more click). No-op until a d has been computed. Lossless:
  // String(d), never the fmtNum display text.
  const sendDToXray = (): void => {
    if (!crystal.crResult) return;
    xray.setXrayValue(String(crystal.crResult.d));
    xray.setXrayMode("2theta_from_d");
    xray.setXrayOrder("1");
    setTab("xray");
  };

  // SLD formula → Crystal tab: the same material's molar mass feeds the
  // cell-volume/theoretical-density calc (molar-mass → cell-vol).
  const sendFormulaToCrystal = (): void => {
    const formula = sldCalc.sld.formula.trim();
    if (!formula) return;
    crystal.updCrystal({ formula });
    setTab("crystal");
  };

  // Crystal formula + theoretical density → SLD tab: use the crystallographic
  // density in the SLD calc instead of a literature value. Lossless handoff.
  const sendCellToSld = (): void => {
    if (!crystal.cellResult || crystal.cellResult.density == null) return;
    const formula = crystal.crystal.formula.trim();
    sldCalc.updSld({
      ...(formula ? { formula } : {}),
      density: String(crystal.cellResult.density),
    });
    setTab("sld");
  };

  return {
    ...units,
    ...xray,
    ...crystal,
    ...sldCalc,
    tab,
    setTab,
    constants,
    sendDToXray,
    sendFormulaToCrystal,
    sendCellToSld,
  };
}

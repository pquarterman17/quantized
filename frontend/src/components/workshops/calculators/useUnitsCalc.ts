// Calculators — Units domain hook (extracted from useCalculators.ts,
// DIRACULATOR_AUDIT P3 split): the unit converter (/api/reference/convert →
// calc.unit_convert), its category → unit table, and the photon/thermal
// energy panel. Carries the P1 provenance contract: every setter that feeds
// a displayed or pending conversion invalidates it (bump the request id,
// clear result + error, drop busy), and a completion whose id is no longer
// current is discarded outright — display and history alike.

import { useEffect, useRef, useState } from "react";

import { convertUnits, getUnitCategories } from "../../../lib/api/reference";
import type { UnitCategoryDef } from "../../../lib/api/reference";
import { fmtNum } from "../../../lib/format";
import { useCalcHistory } from "../../../store/calcHistory";

// Fallback used only until the categories fetch resolves (offline-safe
// default matching the backend's "photon_energy" category, so the panel is
// usable immediately rather than blank on first paint).
const PHOTON_ENERGY_FALLBACK = ["eV", "nm", "cm^-1", "THz", "K"];

/** Common conversions offered as one-click chips (all supported by the backend).
 *  `category` switches the active category so the from/to pickers land on
 *  units that are actually offered together. */
export const QUICK_PAIRS: { label: string; from: string; to: string; category: string }[] = [
  { label: "Oe → T", from: "Oe", to: "T", category: "magnetic_field" },
  { label: "emu → A·m²", from: "emu", to: "A*m^2", category: "magnetization" },
  { label: "eV → nm", from: "eV", to: "nm", category: "photon_energy" },
  { label: "Ang → nm", from: "Ang", to: "nm", category: "length" },
  { label: "Pa → Torr", from: "Pa", to: "Torr", category: "pressure" },
  { label: "K → C", from: "K", to: "C", category: "temperature" },
  { label: "GPa → Pa", from: "GPa", to: "Pa", category: "pressure" },
  { label: "deg → rad", from: "deg", to: "rad", category: "angle" },
];

/** A live (chip / Swap) run needs a real number — "" would coerce to 0. */
const isNumeric = (s: string): boolean => s.trim() !== "" && Number.isFinite(Number(s));

export interface UnitsCalcState {
  value: string;
  from: string;
  to: string;
  result: number | null;
  description: string | null;
  latex: string | null;
  error: string | null;
  busy: boolean;
  setValue: (v: string) => void;
  setFrom: (v: string) => void;
  setTo: (v: string) => void;
  setPair: (from: string, to: string, category?: string) => void;
  convert: () => Promise<void>;
  unitCategories: UnitCategoryDef[] | null;
  category: string;
  setCategory: (id: string) => void;
  swapUnits: () => void;
  peValue: string;
  peFrom: string;
  peResults: Record<string, number> | null;
  peError: string | null;
  peBusy: boolean;
  setPeValue: (v: string) => void;
  setPeFrom: (u: string) => void;
  peCompute: () => Promise<void>;
}

export function useUnitsCalc(): UnitsCalcState {
  const [value, setValueRaw] = useState("1");
  const [from, setFromRaw] = useState("Oe");
  const [to, setToRaw] = useState("T");
  const [result, setResult] = useState<number | null>(null);
  const [description, setDescription] = useState<string | null>(null);
  const [latex, setLatex] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [unitCategories, setUnitCategories] = useState<UnitCategoryDef[] | null>(null);
  const [category, setCategoryState] = useState("magnetic_field"); // matches from="Oe"/to="T"
  const [peValue, setPeValueRaw] = useState("1");
  const [peFrom, setPeFromRaw] = useState("eV");
  const [peResults, setPeResults] = useState<Record<string, number> | null>(null);
  const [peError, setPeError] = useState<string | null>(null);
  const [peBusy, setPeBusy] = useState(false);

  // Monotonic request ids — one per compute family. Bumping disowns any
  // pending request; a disowned completion writes nothing.
  const convSeq = useRef(0);
  const peSeq = useRef(0);

  const invalidateConvert = (): void => {
    convSeq.current++;
    setResult(null);
    setDescription(null);
    setLatex(null);
    setError(null);
    setBusy(false);
  };
  const invalidatePe = (): void => {
    peSeq.current++;
    setPeResults(null);
    setPeError(null);
    setPeBusy(false);
  };

  useEffect(() => {
    let cancelled = false;
    getUnitCategories()
      .then((r) => {
        if (!cancelled) setUnitCategories(r.categories);
      })
      .catch(() => {
        /* offline — from/to Selects fall back to free-text-less empty lists */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setValue = (v: string): void => {
    setValueRaw(v);
    invalidateConvert();
  };
  const setFrom = (v: string): void => {
    setFromRaw(v);
    invalidateConvert();
  };
  const setTo = (v: string): void => {
    setToRaw(v);
    invalidateConvert();
  };

  // Quick-pick chips and Swap convert LIVE (readout only): a live run records
  // no Calc History entry — only an explicit "=" does — and a live failure
  // (e.g. an empty / half-typed custom expression) just clears the readout.
  const setPair = (f: string, t: string, cat?: string): void => {
    setFromRaw(f);
    setToRaw(t);
    if (cat) setCategoryState(cat);
    if (cat === "photon_energy") {
      setPeFromRaw(f);
      invalidateConvert();
      void peComputeSnapshot(peValue, f, true);
    } else {
      void convertSnapshot(value, f, t, true);
    }
  };

  const setCategory = (id: string): void => {
    setCategoryState(id);
    const units = unitCategories?.find((c) => c.id === id)?.units;
    if (units && units.length > 0) {
      setFromRaw(units[0].value);
      setToRaw(units[1]?.value ?? units[0].value);
    }
    invalidateConvert();
  };

  const swapUnits = (): void => {
    setFromRaw(to);
    setToRaw(from);
    void convertSnapshot(value, to, from, true);
  };

  const setPeValue = (v: string): void => {
    setPeValueRaw(v);
    invalidatePe();
  };
  const setPeFrom = (u: string): void => {
    setPeFromRaw(u);
    invalidatePe();
  };

  async function convertSnapshot(
    rawValue: string,
    fromUnit: string,
    toUnit: string,
    live = false,
  ): Promise<void> {
    if (live && (!isNumeric(rawValue) || !fromUnit.trim() || !toUnit.trim())) {
      invalidateConvert(); // nothing convertible yet — clear the readout, no error
      return;
    }
    const id = ++convSeq.current;
    setResult(null);
    setDescription(null);
    setLatex(null);
    setBusy(true);
    setError(null);
    try {
      const v = Number(rawValue);
      if (!Number.isFinite(v)) throw new Error("enter a numeric value");
      const res = await convertUnits(v, fromUnit, toUnit);
      if (convSeq.current !== id) return; // superseded — a newer run/edit owns this panel
      const out = typeof res.result === "number" ? res.result : null;
      setResult(out);
      setDescription(typeof res.info?.description === "string" ? res.info.description : null);
      setLatex(typeof res.info?.latex === "string" && res.info.latex ? res.info.latex : null);
      if (out != null && !live) {
        useCalcHistory.getState().record({
          domain: "Units",
          label: "Unit conversion",
          summary: `${rawValue} ${fromUnit} = ${fmtNum(out)} ${toUnit}`,
          inputs: `value=${rawValue}, from=${fromUnit}, to=${toUnit}`,
        });
      }
    } catch (e) {
      if (convSeq.current !== id) return;
      setResult(null);
      if (!live) setError(e instanceof Error ? e.message : "conversion failed");
    } finally {
      if (convSeq.current === id) setBusy(false);
    }
  }

  async function convert(): Promise<void> {
    await convertSnapshot(value, from, to);
  }

  // Photon/thermal energy: show all 5 interchangeable quantities (eV, nm,
  // cm^-1, THz, K) for one entered value at once, rather than one from/to
  // pair at a time — every non-`peFrom` unit is converted independently
  // (the backend routes each through a common energy hub, so this works
  // regardless of which quantity was entered).
  async function peComputeSnapshot(rawValue: string, sourceUnit: string, live = false): Promise<void> {
    if (live && !isNumeric(rawValue)) {
      invalidatePe();
      return;
    }
    const id = ++peSeq.current;
    setPeResults(null);
    setPeBusy(true);
    setPeError(null);
    try {
      const v = Number(rawValue);
      if (!Number.isFinite(v)) throw new Error("enter a numeric value");
      const photonUnits =
        unitCategories?.find((c) => c.id === "photon_energy")?.units.map((u) => u.value) ??
        PHOTON_ENERGY_FALLBACK;
      const targets = photonUnits.filter((u) => u !== sourceUnit);
      const responses = await Promise.all(targets.map((u) => convertUnits(v, sourceUnit, u)));
      if (peSeq.current !== id) return;
      const out: Record<string, number> = { [sourceUnit]: v };
      targets.forEach((u, i) => {
        const r = responses[i].result;
        if (typeof r === "number") out[u] = r;
      });
      setPeResults(out);
      if (!live) {
        useCalcHistory.getState().record({
          domain: "Units",
          label: "Photon/thermal energy",
          summary: Object.entries(out)
            .map(([u, val]) => `${u}=${fmtNum(val)}`)
            .join(" · "),
          inputs: `value=${rawValue}, from=${sourceUnit}`,
        });
      }
    } catch (e) {
      if (peSeq.current !== id) return;
      setPeResults(null);
      if (!live) setPeError(e instanceof Error ? e.message : "conversion failed");
    } finally {
      if (peSeq.current === id) setPeBusy(false);
    }
  }

  async function peCompute(): Promise<void> {
    await peComputeSnapshot(peValue, peFrom);
  }

  return {
    value,
    from,
    to,
    result,
    description,
    latex,
    error,
    busy,
    setValue,
    setFrom,
    setTo,
    setPair,
    convert,
    unitCategories,
    category,
    setCategory,
    swapUnits,
    peValue,
    peFrom,
    peResults,
    peError,
    peBusy,
    setPeValue,
    setPeFrom,
    peCompute,
  };
}

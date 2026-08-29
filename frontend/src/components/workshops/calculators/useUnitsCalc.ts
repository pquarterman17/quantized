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
  { label: "T → G", from: "T", to: "G", category: "magnetic_field" },
  { label: "eV → nm", from: "eV", to: "nm", category: "photon_energy" },
  { label: "eV → THz", from: "eV", to: "THz", category: "photon_energy" },
  { label: "K → C", from: "K", to: "C", category: "temperature" },
  { label: "J → eV", from: "J", to: "eV", category: "energy" },
  { label: "GPa → bar", from: "GPa", to: "bar", category: "pressure" },
  { label: "Ang → nm", from: "Ang", to: "nm", category: "length" },
];

export interface UnitsCalcState {
  value: string;
  from: string;
  to: string;
  result: number | null;
  description: string | null;
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

  const setPair = (f: string, t: string, cat?: string): void => {
    setFromRaw(f);
    setToRaw(t);
    if (cat) setCategoryState(cat);
    invalidateConvert();
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
    invalidateConvert();
  };

  const setPeValue = (v: string): void => {
    setPeValueRaw(v);
    invalidatePe();
  };
  const setPeFrom = (u: string): void => {
    setPeFromRaw(u);
    invalidatePe();
  };

  async function convert(): Promise<void> {
    const id = ++convSeq.current;
    setBusy(true);
    setError(null);
    try {
      const v = Number(value);
      if (!Number.isFinite(v)) throw new Error("enter a numeric value");
      const res = await convertUnits(v, from, to);
      if (convSeq.current !== id) return; // superseded — a newer run/edit owns this panel
      const out = typeof res.result === "number" ? res.result : null;
      setResult(out);
      setDescription(typeof res.info?.description === "string" ? res.info.description : null);
      if (out != null) {
        useCalcHistory.getState().record({
          domain: "Units",
          label: "Unit conversion",
          summary: `${value} ${from} = ${fmtNum(out)} ${to}`,
          inputs: `value=${value}, from=${from}, to=${to}`,
        });
      }
    } catch (e) {
      if (convSeq.current !== id) return;
      setResult(null);
      setError(e instanceof Error ? e.message : "conversion failed");
    } finally {
      if (convSeq.current === id) setBusy(false);
    }
  }

  // Photon/thermal energy: show all 5 interchangeable quantities (eV, nm,
  // cm^-1, THz, K) for one entered value at once, rather than one from/to
  // pair at a time — every non-`peFrom` unit is converted independently
  // (the backend routes each through a common energy hub, so this works
  // regardless of which quantity was entered).
  async function peCompute(): Promise<void> {
    const id = ++peSeq.current;
    setPeBusy(true);
    setPeError(null);
    try {
      const v = Number(peValue);
      if (!Number.isFinite(v)) throw new Error("enter a numeric value");
      const photonUnits =
        unitCategories?.find((c) => c.id === "photon_energy")?.units.map((u) => u.value) ??
        PHOTON_ENERGY_FALLBACK;
      const targets = photonUnits.filter((u) => u !== peFrom);
      const responses = await Promise.all(targets.map((u) => convertUnits(v, peFrom, u)));
      if (peSeq.current !== id) return;
      const out: Record<string, number> = { [peFrom]: v };
      targets.forEach((u, i) => {
        const r = responses[i].result;
        if (typeof r === "number") out[u] = r;
      });
      setPeResults(out);
      useCalcHistory.getState().record({
        domain: "Units",
        label: "Photon/thermal energy",
        summary: Object.entries(out)
          .map(([u, val]) => `${u}=${fmtNum(val)}`)
          .join(" · "),
        inputs: `value=${peValue}, from=${peFrom}`,
      });
    } catch (e) {
      if (peSeq.current !== id) return;
      setPeResults(null);
      setPeError(e instanceof Error ? e.message : "conversion failed");
    } finally {
      if (peSeq.current === id) setPeBusy(false);
    }
  }

  return {
    value,
    from,
    to,
    result,
    description,
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

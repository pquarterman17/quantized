// Calculators workshop — state hook. Two tools backed by golden calc helpers:
// a unit converter (/api/reference/convert → calc.unit_convert, with dimensional,
// temperature-offset, and energy↔wavelength / H↔B bridges) and a physical-constants
// reference (/api/reference/constants → calc.constants, CODATA). Pure orchestration.

import { useEffect, useState } from "react";

import { convertUnits, getConstants } from "../../../lib/api";

export type CalcTab = "units" | "constants";

/** Common conversions offered as one-click chips (all supported by the backend). */
export const QUICK_PAIRS: { label: string; from: string; to: string }[] = [
  { label: "Oe → T", from: "Oe", to: "T" },
  { label: "T → G", from: "T", to: "G" },
  { label: "eV → nm", from: "eV", to: "nm" },
  { label: "eV → THz", from: "eV", to: "THz" },
  { label: "K → C", from: "K", to: "C" },
  { label: "J → eV", from: "J", to: "eV" },
  { label: "GPa → bar", from: "GPa", to: "bar" },
  { label: "Ang → nm", from: "Ang", to: "nm" },
];

export interface CalculatorsState {
  tab: CalcTab;
  setTab: (t: CalcTab) => void;
  // Unit converter
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
  setPair: (from: string, to: string) => void;
  convert: () => Promise<void>;
  // Constants
  constants: Record<string, number> | null;
}

export function useCalculators(): CalculatorsState {
  const [tab, setTab] = useState<CalcTab>("units");
  const [value, setValue] = useState("1");
  const [from, setFrom] = useState("Oe");
  const [to, setTo] = useState("T");
  const [result, setResult] = useState<number | null>(null);
  const [description, setDescription] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [constants, setConstants] = useState<Record<string, number> | null>(null);

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

  const setPair = (f: string, t: string): void => {
    setFrom(f);
    setTo(t);
    setResult(null);
    setDescription(null);
    setError(null);
  };

  async function convert(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const v = Number(value);
      if (!Number.isFinite(v)) throw new Error("enter a numeric value");
      const res = await convertUnits(v, from, to);
      const out = typeof res.result === "number" ? res.result : null;
      setResult(out);
      setDescription(typeof res.info?.description === "string" ? res.info.description : null);
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : "conversion failed");
    } finally {
      setBusy(false);
    }
  }

  return {
    tab,
    setTab,
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
    constants,
  };
}

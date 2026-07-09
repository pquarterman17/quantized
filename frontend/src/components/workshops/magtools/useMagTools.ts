// Magnetometry tools workshop — state hook. Two transforms backed by golden
// calc.magnetometry helpers that had no frontend: high-T background subtraction
// from M(T) (subtract_mag_background) and sample-aware field/moment unit
// conversion (convert_mag_units). Each writes a new dataset to the library.

import { useState } from "react";

import { convertMagUnits, subtractMagBackground } from "../../../lib/api";
import type { Dataset, DataStruct } from "../../../lib/types";
import { useActiveDataset, useApp } from "../../../store/useApp";

export type MagTab = "background" | "units";

export const FIELD_UNITS = ["Oe", "T", "mT", "A/m"];
export const MOMENT_UNITS = ["emu", "emu/g", "emu/cm³", "A·m²", "kA/m"];

export interface UnitParams {
  fromField: string;
  toField: string;
  toMoment: string; // source moment is always "emu" (the only supported source)
  sampleMass: number; // g (for emu/g)
  sampleVolume: number; // cm³ (for emu/cm³, kA/m)
}

const DEFAULT_UNITS: UnitParams = {
  fromField: "Oe",
  toField: "T",
  toMoment: "emu",
  sampleMass: 0,
  sampleVolume: 0,
};

let _counter = 0;

export interface MagToolsState {
  active: Dataset | null;
  tab: MagTab;
  setTab: (t: MagTab) => void;
  autoFraction: number;
  setAutoFraction: (v: number) => void;
  units: UnitParams;
  setUnits: (patch: Partial<UnitParams>) => void;
  fit: { slope: number; intercept: number } | null;
  warning: string | null;
  busy: boolean;
  error: string | null;
  subtractBackground: () => Promise<void>;
  convert: () => Promise<void>;
}

export function useMagTools(): MagToolsState {
  const active = useActiveDataset();
  const addDataset = useApp((s) => s.addDataset);
  const setStatus = useApp((s) => s.setStatus);
  const [tab, setTab] = useState<MagTab>("background");
  const [autoFraction, setAutoFraction] = useState(0.1);
  const [units, setUnitsState] = useState<UnitParams>(DEFAULT_UNITS);
  const [fit, setFit] = useState<{ slope: number; intercept: number } | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setUnits = (patch: Partial<UnitParams>): void =>
    setUnitsState((u) => ({ ...u, ...patch }));

  const stem = (): string => (active ? active.name.replace(/\.[^.]+$/, "") : "data");

  async function subtractBackground(): Promise<void> {
    if (!active) return;
    setBusy(true);
    setError(null);
    setWarning(null);
    try {
      // #38 deferred edge: resolve the active dataset's full data first.
      const ds = await useApp.getState().resolveDataset(active.id);
      if (!ds) return;
      const temperature = ds.data.time;
      const moment = ds.data.values.map((row) => row[0]);
      const res = await subtractMagBackground({ temperature, moment, auto_fraction: autoFraction });
      setFit({ slope: res.slope, intercept: res.intercept });
      const data: DataStruct = {
        ...ds.data,
        values: res.corrected.map((v) => [v ?? Number.NaN]),
        metadata: { ...ds.data.metadata, mag_bg_subtracted: true },
      };
      addDataset({ id: `magbg-${++_counter}`, name: `${stem()} (bg-sub)`, data });
      setStatus(`subtracted high-T background (slope ${res.slope.toExponential(2)})`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "background subtraction failed");
    } finally {
      setBusy(false);
    }
  }

  async function convert(): Promise<void> {
    if (!active) return;
    setBusy(true);
    setError(null);
    setWarning(null);
    try {
      // #38 deferred edge: resolve the active dataset's full data first.
      const ds = await useApp.getState().resolveDataset(active.id);
      if (!ds) return;
      const x = ds.data.time;
      const y = ds.data.values.map((row) => row[0]);
      const res = await convertMagUnits({
        x,
        y,
        from_field: units.fromField,
        to_field: units.toField,
        from_moment: "emu",
        to_moment: units.toMoment,
        sample_mass: units.sampleMass,
        sample_volume: units.sampleVolume,
      });
      if (res.warning) setWarning(res.warning);
      const data: DataStruct = {
        time: res.x.map((v) => v ?? Number.NaN),
        values: res.y.map((v) => [v ?? Number.NaN]),
        labels: [ds.data.labels[0] ?? "Moment"],
        units: [res.y_unit],
        metadata: {
          ...ds.data.metadata,
          x_column_name: ds.data.metadata?.["x_column_name"] ?? "Field",
          x_column_unit: res.x_unit,
        },
      };
      addDataset({ id: `magunit-${++_counter}`, name: `${stem()} (${res.y_unit})`, data });
      setStatus(`converted to ${res.x_unit} / ${res.y_unit}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "unit conversion failed");
    } finally {
      setBusy(false);
    }
  }

  return {
    active,
    tab,
    setTab,
    autoFraction,
    setAutoFraction,
    units,
    setUnits,
    fit,
    warning,
    busy,
    error,
    subtractBackground,
    convert,
  };
}

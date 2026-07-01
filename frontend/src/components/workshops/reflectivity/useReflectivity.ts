// Reflectivity workshop — state hook (the React analogue of the MATLAB workshop
// pattern). Owns the layer-stack model + Q grid; calls /api/reflectivity and
// adds the simulated R(Q) to the library as a new dataset (which then plots
// through the normal pipeline). The math (Parratt recursion) lives in calc/.

import { useEffect, useMemo, useState } from "react";

import { reflPresets, reflSimulate, reflSldProfile, type ReflLayer } from "../../../lib/api";
import type { DataStruct, SldPreset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";

export type Radiation = "xray" | "neutron";

/** One editable layer row: a material (by preset name) + geometry. SLD is
 *  derived from the preset and the selected radiation at simulate time. */
export interface ModelLayer {
  preset: string; // preset name; "" = manual SLD
  thickness: number; // Å (ignored for incident medium + substrate)
  roughness: number; // Å
  sld: number; // manual SLD (Å⁻²), used only when preset === ""
}

export interface QGrid {
  qMin: number;
  qMax: number;
  nPoints: number;
  resolution: number; // dQ/Q; 0 = off
}

const DEFAULT_GRID: QGrid = { qMin: 0.005, qMax: 0.25, nPoints: 400, resolution: 0 };

// A sensible starter stack: vacuum / 200 Å Nickel film / Silicon substrate.
const DEFAULT_LAYERS: ModelLayer[] = [
  { preset: "Air / Vacuum", thickness: 0, roughness: 0, sld: 0 },
  { preset: "Nickel", thickness: 200, roughness: 5, sld: 0 },
  { preset: "Silicon", thickness: 0, roughness: 3, sld: 0 },
];

let _simCounter = 0;

export interface ReflectivityState {
  presets: SldPreset[];
  layers: ModelLayer[];
  radiation: Radiation;
  grid: QGrid;
  busy: boolean;
  error: string | null;
  setRadiation: (r: Radiation) => void;
  setGrid: (patch: Partial<QGrid>) => void;
  updateLayer: (index: number, patch: Partial<ModelLayer>) => void;
  addLayer: () => void;
  removeLayer: (index: number) => void;
  simulate: () => Promise<void>;
  sldProfile: () => Promise<void>;
}

/** Resolve a row's real SLD from its preset + the radiation type. */
function layerSld(row: ModelLayer, presets: SldPreset[], radiation: Radiation): number {
  if (row.preset === "") return row.sld;
  const p = presets.find((x) => x.name === row.preset);
  if (!p) return row.sld;
  return radiation === "xray" ? p.sldX : p.sldN;
}

export function useReflectivity(): ReflectivityState {
  const addDataset = useApp((s) => s.addDataset);
  const setStatus = useApp((s) => s.setStatus);
  const reflectivitySeed = useApp((s) => s.reflectivitySeed);
  const clearReflectivitySeed = useApp((s) => s.clearReflectivitySeed);
  const [presets, setPresets] = useState<SldPreset[]>([]);
  const [layers, setLayers] = useState<ModelLayer[]>(DEFAULT_LAYERS);
  const [radiation, setRadiation] = useState<Radiation>("xray");
  const [grid, setGridState] = useState<QGrid>(DEFAULT_GRID);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    reflPresets()
      .then((r) => {
        if (!cancelled) setPresets(r.presets);
      })
      .catch(() => {
        /* offline — manual SLD entry still works */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Cross-panel hook: consume a one-shot SLD seed from the calculators SLD tab,
  // inserting it as a manual-SLD film just above the substrate, then clear it.
  useEffect(() => {
    if (!reflectivitySeed) return;
    const { sld, label } = reflectivitySeed;
    setLayers((ls) => {
      const film: ModelLayer = { preset: "", thickness: 50, roughness: 3, sld };
      return [...ls.slice(0, -1), film, ls[ls.length - 1]];
    });
    setStatus(`added ${label ?? "calculated"} SLD layer from the SLD calculator`);
    clearReflectivitySeed();
  }, [reflectivitySeed, clearReflectivitySeed, setStatus]);

  // [thickness, sld_real, sld_imag, roughness] rows for the API. X-ray carries
  // the preset's imaginary SLD (absorption); neutron treats it as ~0.
  const toApiLayers = useMemo(
    () => (): ReflLayer[] =>
      layers.map((row) => {
        const sldR = layerSld(row, presets, radiation);
        const p = presets.find((x) => x.name === row.preset);
        const sldI = radiation === "xray" && p ? p.sldImag : 0;
        return [row.thickness, sldR, sldI, row.roughness];
      }),
    [layers, presets, radiation],
  );

  const setGrid = (patch: Partial<QGrid>): void =>
    setGridState((g) => ({ ...g, ...patch }));

  const updateLayer = (index: number, patch: Partial<ModelLayer>): void =>
    setLayers((ls) => ls.map((l, i) => (i === index ? { ...l, ...patch } : l)));

  const addLayer = (): void =>
    // Insert a fresh film just above the substrate (keep the last row as substrate).
    setLayers((ls) => {
      const film: ModelLayer = { preset: "Silicon Oxide", thickness: 50, roughness: 3, sld: 0 };
      return [...ls.slice(0, -1), film, ls[ls.length - 1]];
    });

  const removeLayer = (index: number): void =>
    setLayers((ls) => (ls.length <= 2 ? ls : ls.filter((_, i) => i !== index)));

  async function simulate(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await reflSimulate({
        layers: toApiLayers(),
        q_min: grid.qMin,
        q_max: grid.qMax,
        n_points: grid.nPoints,
        resolution: grid.resolution > 0 ? grid.resolution : null,
      });
      const n = ++_simCounter;
      const data: DataStruct = {
        time: res.q,
        values: res.r.map((v) => [v ?? Number.NaN]),
        labels: ["Reflectivity"],
        units: ["a.u."],
        metadata: { source: "reflectivity-sim", radiation, layers: layers.length },
      };
      addDataset({ id: `refl-model-${n}`, name: `Reflectivity model ${n}`, data });
      setStatus(`simulated R(Q) — ${res.q.length} points`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "simulation failed");
    } finally {
      setBusy(false);
    }
  }

  // The standard companion view to R(Q): the model's SLD(z) depth profile, added
  // as its own dataset (z in Å, SLD in Å⁻²).
  async function sldProfile(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await reflSldProfile({ layers: toApiLayers() });
      const n = ++_simCounter;
      const data: DataStruct = {
        time: res.z,
        values: res.sld.map((v) => [v ?? Number.NaN]),
        labels: ["SLD"],
        units: ["Å⁻²"],
        metadata: { source: "reflectivity-sld", radiation, layers: layers.length },
      };
      addDataset({ id: `refl-sld-${n}`, name: `SLD profile ${n}`, data });
      setStatus(`SLD profile — ${res.z.length} points`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "SLD profile failed");
    } finally {
      setBusy(false);
    }
  }

  return {
    presets,
    layers,
    radiation,
    grid,
    busy,
    error,
    setRadiation,
    setGrid,
    updateLayer,
    addLayer,
    removeLayer,
    simulate,
    sldProfile,
  };
}

// Reflectivity workshop — state hook (the React analogue of the MATLAB workshop
// pattern). Owns the layer-stack model + Q grid; calls /api/reflectivity and
// adds the simulated R(Q) to the library as a new dataset (which then plots
// through the normal pipeline). The math (Parratt recursion) lives in calc/.

import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";

import { reflPresets, reflSimulate, reflSldProfile, type ReflLayer } from "../../../lib/api/reflectivity";
import { addModelOutput } from "../../../store/commitModelOutput";
import { askConfirm } from "../../../store/confirmDialog";
import type { DataStruct, SldPreset } from "../../../lib/types";
import { useActiveDataset, useApp } from "../../../store/useApp";
import { probeRadiation } from "./reflFitData";
import { resolveLayer } from "./reflFitModel";
import { expandGraded, type GradedProfile } from "./reflGraded";
import { SEED_ROUGHNESS_A, seededModelBlock, stackToModelLayers } from "./reflStackSeed";

export type Radiation = "xray" | "neutron";

/** One editable layer row: a material (by preset name) + geometry. SLD is
 *  derived from the preset and the selected radiation at simulate time. */
export interface ModelLayer {
  preset: string; // preset name; "" = manual SLD
  thickness: number; // Å (ignored for incident medium + substrate)
  roughness: number; // Å
  sld: number; // manual SLD (Å⁻²), used only when preset === ""
  isld?: number; // manual absorption (Å⁻², POSITIVE = absorption), preset === "" only; default 0
  msld?: number; // magnetic SLD (Å⁻²), read only by polarised-neutron fits; default 0
  sldPending?: boolean; // film-stack seed: SLD could not be computed (blank, flagged; blocks simulate/fit)
  sldProbe?: Radiation; // film-stack seed: the radiation the seeded manual SLD was computed for
  fitRoughness?: boolean; // film-stack seed: roughness is a placeholder, vary it in a fit by default
  graded?: GradedProfile; // film only: a spline SLD(z) profile instead of a slab (knots fit as L{i}.knot{j}.sld)
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
  /** Replace the whole stack (the fit's parameter edits and "apply to model"). */
  replaceLayers: (layers: ModelLayer[]) => void;
  /** Bumped by every film-stack hand-off; the fit resets its parameter overrides on a change. */
  seedEpoch: number;
  /** Written by the fit: true while it holds parameter overrides (a touched model). */
  fitOverridesDirty: MutableRefObject<boolean>;
  simulate: () => Promise<void>;
  sldProfile: () => Promise<void>;
}

export function useReflectivity(): ReflectivityState {
  const setStatus = useApp((s) => s.setStatus);
  const reflectivitySeed = useApp((s) => s.reflectivitySeed);
  const clearReflectivitySeed = useApp((s) => s.clearReflectivitySeed);
  const [presets, setPresets] = useState<SldPreset[]>([]);
  const [layers, setLayers] = useState<ModelLayer[]>(DEFAULT_LAYERS);
  // Opens on the active file's own probe (ORSO / NCNR metadata), else X-ray.
  const active = useActiveDataset();
  const [radiation, setRadiation] = useState<Radiation>(() => probeRadiation(active?.data.metadata) ?? "xray");
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

  // Cross-panel hook: consume a one-shot seed, then clear it. An SLD seed (the
  // calculators SLD tab) inserts a manual-SLD film just above the substrate. A
  // stack seed (the Film stack tab) is a whole new model: it never silently
  // replaces one the user has touched (it asks first; declining keeps the model).
  const live = useRef({ layers, radiation });
  live.current = { layers, radiation };
  const [seedEpoch, setSeedEpoch] = useState(0);
  const fitOverridesDirty = useRef(false);
  // Only the latest hand-off may act: an earlier one still awaiting its confirm
  // (answered "no" when a newer question replaces it), or one outliving the hook, is stale.
  const seedToken = useRef(0);
  useEffect(() => () => { seedToken.current = -1; }, []);
  useEffect(() => {
    if (!reflectivitySeed) return;
    const seed = reflectivitySeed;
    clearReflectivitySeed();
    if (seed.stack) {
      const { layers: cur, radiation: rad } = live.current;
      const untouched = JSON.stringify(cur) === JSON.stringify(DEFAULT_LAYERS) && !fitOverridesDirty.current;
      const token = ++seedToken.current;
      void (async () => {
        const ok =
          untouched ||
          (await askConfirm(
            "Replace the reflectivity model?",
            `Seeding from the film stack builds a new ${seed.stack.length + 1}-row model and replaces the ` +
              `${cur.length}-row model in this workshop. Layers, roughness and any unfitted edits are not kept.`,
            "Replace",
          ));
        if (seedToken.current !== token) return;
        if (!ok) {
          setStatus("film stack hand-off cancelled: reflectivity model kept");
          return;
        }
        setLayers(stackToModelLayers(seed, rad));
        setSeedEpoch((n) => n + 1);
        setStatus(`seeded reflectivity model from ${seed.label ?? "the film stack"} (${rad} SLDs, roughness ${SEED_ROUGHNESS_A} Å to fit)`);
      })();
      return;
    }
    const { sld, label } = seed;
    setLayers((ls) => {
      const film: ModelLayer = { preset: "", thickness: 50, roughness: 3, sld };
      return [...ls.slice(0, -1), film, ls[ls.length - 1]];
    });
    setStatus(`added ${label ?? "calculated"} SLD layer from the SLD calculator`);
  }, [reflectivitySeed, clearReflectivitySeed, setStatus]);

  // [thickness, sld_real, sld_imag, roughness] rows for the API. X-ray carries
  // the preset's imaginary SLD (absorption); neutron treats it as ~0; a manual
  // row carries its own (reflFitModel.resolveLayer, shared with the fit).
  const toApiLayers = useMemo(
    () => (): ReflLayer[] =>
      layers.map((row) => {
        const r = resolveLayer(row, presets, radiation);
        return [r.thickness, r.sld, r.isld, r.roughness];
      }),
    [layers, presets, radiation],
  );

  const gradedCount = layers.filter((l) => l.graded).length;

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
    const block = seededModelBlock(layers, radiation);
    if (block) {
      setError(block);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await reflSimulate({
        layers: await expandGraded(toApiLayers(), layers),
        q_min: grid.qMin,
        q_max: grid.qMax,
        n_points: grid.nPoints,
        resolution: grid.resolution > 0 ? grid.resolution : null,
      });
      const data: DataStruct = {
        time: res.q,
        values: res.r.map((v) => [v ?? Number.NaN]),
        labels: ["Reflectivity"],
        units: ["a.u."],
        metadata: { source: "reflectivity-sim", radiation, layers: layers.length, graded: gradedCount },
      };
      addModelOutput("reflectivity-sim", "reflectivity model", data, `simulated R(Q) — ${res.q.length} points`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "simulation failed");
    } finally {
      setBusy(false);
    }
  }

  // The standard companion view to R(Q): the model's SLD(z) depth profile, added
  // as its own dataset (z in Å, SLD in Å⁻²).
  async function sldProfile(): Promise<void> {
    const block = seededModelBlock(layers, radiation);
    if (block) {
      setError(block);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await reflSldProfile({ layers: await expandGraded(toApiLayers(), layers) });
      const data: DataStruct = {
        time: res.z,
        values: res.sld.map((v) => [v ?? Number.NaN]),
        labels: ["SLD"],
        units: ["Å⁻²"],
        metadata: { source: "reflectivity-sld", radiation, layers: layers.length, graded: gradedCount },
      };
      addModelOutput("reflectivity-sld", "SLD profile", data, `SLD profile — ${res.z.length} points`);
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
    replaceLayers: setLayers,
    seedEpoch,
    fitOverridesDirty,
    simulate,
    sldProfile,
  };
}

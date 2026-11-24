// State for the Film stack tab (plan G4, calc.film_stack): the substrate, an
// ordered list of layers as text fields, the conditions, and one result card.
// Every edit invalidates the result through the card's `touch`, so a shown
// table always matches the inputs above it.

import { useState } from "react";

import { evaluateStack, type StackResult } from "../../../../lib/api/filmStack";
import type { PhaseInfo } from "../../../../lib/api/reference";
import { isCalcOnlyView } from "../../../../lib/viewMode";
import { toast } from "../../../../store/toasts";
import { useApp } from "../../../../store/useApp";
import { useCard } from "../shared";
import { buildStackSeed } from "./stackReflectivitySeed";

export interface LayerRow {
  id: number;
  name: string;
  a: string;
  c: string;
  thickness: string;
  nu: string;
  cte: string;
  /** Optional, for the Reflectivity hand-off only (never sent to the strain model). */
  formula: string;
  density: string; // g/cm³
}

let nextId = 1;
export const newLayer = (patch: Partial<LayerRow> = {}): LayerRow => ({
  id: nextId++,
  name: "",
  a: "",
  c: "",
  thickness: "10",
  nu: "0.3",
  cte: "0",
  formula: "",
  density: "",
  ...patch,
});

function num(text: string, label: string): number {
  const v = Number(text);
  if (text.trim() === "" || !Number.isFinite(v)) throw new Error(`${label}: enter a number`);
  return v;
}

/** "1 3" or "1,3" → [H, L]; blank skips the RSM prediction. */
export function parseHL(text: string): number[] {
  const parts = text.trim().split(/[\s,]+/).filter(Boolean).map(Number);
  if (parts.length !== 2 || parts.some((n) => !Number.isInteger(n)) || parts[1] < 1) {
    throw new Error(`RSM reflection: enter "H L" with integer H and L ≥ 1 (got "${text}")`);
  }
  return parts;
}

export function useFilmStack() {
  const [subA, setSubA] = useState("3.905");
  const [subCte, setSubCte] = useState("11");
  const [layers, setLayers] = useState<LayerRow[]>(() => [
    newLayer({ name: "LSMO", a: "3.876", thickness: "20", nu: "0.33", cte: "11.5" }),
  ]);
  const [subFormula, setSubFormula] = useState("");
  const [subDensity, setSubDensity] = useState("");
  const [growthT, setGrowthT] = useState("973");
  const [wavelength, setWavelength] = useState("1.5406");
  const [rsmHL, setRsmHL] = useState("1 3");
  const [result, setResult] = useState<StackResult | null>(null);
  const card = useCard("Film stack");

  const edit = <T,>(set: (v: T) => void) => (v: T): void => {
    set(v);
    card.touch();
  };
  const updateLayer = (id: number, patch: Partial<LayerRow>): void => {
    setLayers((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    card.touch();
  };
  const addLayer = (patch: Partial<LayerRow> = {}): void => {
    setLayers((ls) => [...ls, newLayer(patch)]);
    card.touch();
  };
  const addPhase = (p: PhaseInfo): void =>
    addLayer({ name: p.name, a: String(p.a), c: p.c !== p.a ? String(p.c) : "", formula: p.formula });
  const removeLayer = (id: number): void => {
    setLayers((ls) => ls.filter((l) => l.id !== id));
    card.touch();
  };
  const moveLayer = (id: number, dir: -1 | 1): void => {
    setLayers((ls) => {
      const i = ls.findIndex((l) => l.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= ls.length) return ls;
      const next = [...ls];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    card.touch();
  };

  const run = (): void => {
    void card.run(
      "Film stack",
      `substrate a=${subA} Å, CTE=${subCte}; layers=${JSON.stringify(layers.map(({ id: _id, formula: _f, density: _d, ...l }) => l))}; T_growth=${growthT} K; λ=${wavelength} Å; RSM (H 0 L)=${rsmHL || "none"}`,
      async (isCurrent) => {
        if (layers.length === 0) throw new Error("add at least one layer");
        const body = {
          substrate: { a: num(subA, "substrate a"), cte: num(subCte, "substrate CTE") },
          layers: layers.map((l, i) => {
            const label = l.name || `layer ${i + 1}`;
            return {
              name: label,
              a: num(l.a, `${label} a`),
              ...(l.c.trim() ? { c: num(l.c, `${label} c`) } : {}),
              thickness: num(l.thickness, `${label} thickness`),
              nu: num(l.nu, `${label} ν`),
              cte: num(l.cte, `${label} CTE`),
            };
          }),
          growth_temperature: num(growthT, "growth T"),
          room_temperature: 300,
          wavelength: num(wavelength, "λ"),
          max_order: 4,
          ...(rsmHL.trim() ? { rsm_reflection: parseHL(rsmHL) } : {}),
        };
        const r = await evaluateStack(body);
        if (isCurrent()) setResult(r);
        const coherent = r.layers.filter((l) => l.state === "coherent").length;
        const text = `${r.layers.length} layers: ${coherent} coherent, ${r.layers.length - coherent} relaxed`;
        return { text, copyValue: JSON.stringify(r) };
      },
    );
  };

  // Hand-off (G4): a new Parratt model in the Reflectivity workshop. The
  // seed is built (and validated) before anything opens; an error opens nothing.
  const seedReflectivity = useApp((st) => st.seedReflectivityLayer);
  const sendToReflectivity = async (): Promise<void> => {
    if (isCalcOnlyView()) {
      toast("use ↗ in the title bar to open the full app");
      return;
    }
    try {
      const seed = await buildStackSeed({ formula: subFormula, density: subDensity }, layers, Number(wavelength));
      seedReflectivity(seed);
    } catch (e) {
      toast(`Reflectivity hand-off: ${e instanceof Error ? e.message : "failed"}`);
    }
  };

  const shown = card.result != null && !("err" in card.result) ? result : null;
  return {
    subA, setSubA: edit(setSubA), subCte, setSubCte: edit(setSubCte),
    growthT, setGrowthT: edit(setGrowthT), wavelength, setWavelength: edit(setWavelength),
    rsmHL, setRsmHL: edit(setRsmHL),
    subFormula, setSubFormula: edit(setSubFormula), subDensity, setSubDensity: edit(setSubDensity),
    layers, updateLayer, addLayer, addPhase, removeLayer, moveLayer,
    run, sendToReflectivity, card, shown,
  };
}

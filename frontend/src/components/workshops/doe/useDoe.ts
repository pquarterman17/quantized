// Design of experiments workshop (GAP_AUDIT_9 J16): setup state and the
// generate action. The server builds the worksheet (calc/doe.py); this keeps
// the form, sends it, and adds the returned dataset to the project (one undo
// step, the same addDataset every import uses).
//
// Defaults are PROVISIONAL, owner to confirm (this note lives here, not in the
// window): randomized run order (JMP and
// Minitab randomize by default), CCD alpha "rotatable", and the published
// center-point counts (NIST Table 3.28) for response-surface designs, 0 for
// two-level designs.

import { useCallback, useEffect, useState } from "react";

import {
  doeFractions, doeGenerate, type DoeAlphaChoice, type DoeDesignType, type DoeFactorBody,
  type DoeFractionsResponse, type DoeOptModel,
} from "../../../lib/api/doe";
import { designTitle, doeMeta } from "../../../lib/doe";
import { addDatasetsOneStep } from "../../../store/addDatasetsOneStep";
import { useApp } from "../../../store/useApp";
import { useDoeReopen, type GeneratedDesign } from "./useDoeResultBridge";

export interface FactorRow {
  name: string;
  low: string;
  high: string;
  unit: string;
  /** D-optimal only: comma-separated level names make the factor categorical. */
  levels: string;
}

export const DESIGN_OPTIONS: { value: DoeDesignType; label: string }[] = [
  { value: "full_factorial", label: "2-level full factorial" },
  { value: "fractional_factorial", label: "2-level fractional factorial (2^(k-p))" },
  { value: "plackett_burman", label: "Plackett-Burman screening" },
  { value: "ccd", label: "Response surface: central composite" },
  { value: "box_behnken", label: "Response surface: Box-Behnken" },
  { value: "d_optimal", label: "Custom: D-optimal (exchange algorithm)" },
];

const LETTERS = "ABCDEFGHJKLMNOPQRSTUVWXYZ";

export function factorRows(k: number, prev: readonly FactorRow[]): FactorRow[] {
  return Array.from({ length: k }, (_, i) => prev[i] ?? { name: LETTERS[i] ?? `F${i + 1}`, low: "-1", high: "1", unit: "", levels: "" });
}

export interface DoeSetup {
  design: DoeDesignType;
  k: number;
  factors: FactorRow[];
  responseName: string;
  p: number | null;
  runs: number;
  replicates: string;
  center: string;
  alpha: DoeAlphaChoice;
  alphaCustom: string;
  ccdFractional: boolean;
  inscribed: boolean;
  randomize: boolean;
  seed: string;
  /** Blocking (factorial designs): number of blocks, and the generators as words ("ABC, BCD"; blank = standard). */
  blocks: string;
  blockGens: string;
  /** D-optimal: model, runs, method, grid levels per continuous factor (blank = default), optimiser seed. */
  optModel: DoeOptModel;
  nRuns: string;
  method: "coordinate" | "fedorov";
  gridLevels: string;
  optSeed: string;
}

export const INITIAL_SETUP: DoeSetup = {
  design: "full_factorial", k: 3, factors: factorRows(3, []), responseName: "Response", p: null, runs: 12,
  replicates: "1", center: "", alpha: "rotatable", alphaCustom: "1.5", ccdFractional: false, inscribed: false,
  randomize: true, seed: "", blocks: "1", blockGens: "", optModel: "interaction", nRuns: "12", method: "coordinate",
  gridLevels: "", optSeed: "0",
};

const MIN_K: Record<DoeDesignType, number> = {
  full_factorial: 2, fractional_factorial: 3, plackett_burman: 2, ccd: 2, box_behnken: 3, d_optimal: 2,
};
const MAX_K: Record<DoeDesignType, number> = {
  full_factorial: 8, fractional_factorial: 11, plackett_burman: 23, ccd: 8, box_behnken: 5, d_optimal: 8,
};
export const kRange = (d: DoeDesignType): [number, number] => [MIN_K[d], MAX_K[d]];

// levels-allowlist: user-typed level NAMES of a new categorical DOE factor, not a column's category levels
export const levelList = (f: FactorRow): string[] => f.levels.split(",").map((x) => x.trim()).filter((x) => x !== "");
export const isFactorial = (d: DoeDesignType): boolean => d === "full_factorial" || d === "fractional_factorial";
const blockGenList = (s: DoeSetup): string[] => s.blockGens.split(/[,\s]+/).filter((x) => x !== "");

function blockingProblem(s: DoeSetup): string | null {
  const n = Number(s.blocks);
  if (n === 1 || !isFactorial(s.design)) return null; // the block choice is ignored (not sent) for other designs
  const gens = blockGenList(s);
  if (gens.length > 0 && gens.length !== Math.log2(n)) return `${n} blocks need ${Math.log2(n)} generator${n === 2 ? "" : "s"} (or leave blank for the standard choice).`;
  if (gens.some((g) => !/^[A-Za-z]+$/.test(g))) return "Block generators are words of factor letters, e.g. ABC.";
  return null;
}

/** Why the form cannot be sent (client-side; the server refuses the rest), or null. */
export function setupProblem(s: DoeSetup): string | null {
  const [lo, hi] = kRange(s.design);
  if (s.k < lo || s.k > hi) return `This design needs ${lo} to ${hi} factors.`;
  const names = s.factors.map((f) => f.name.trim());
  if (names.some((n) => !n)) return "Every factor needs a name.";
  const all = [...names, s.responseName.trim()];
  if (all.some((n, i) => all.indexOf(n) !== i)) return "Factor and response names must be different.";
  for (const f of s.factors) {
    if (s.design === "d_optimal" && f.levels.trim() !== "") {
      const lv = levelList(f);
      // levels-allowlist: duplicate check on typed level names, not a column's levels
      if (lv.length < 2 || new Set(lv).size !== lv.length) return `Factor ${f.name}: give two or more different levels, separated by commas.`;
      continue;
    }
    const a = Number(f.low), b = Number(f.high);
    if (f.low.trim() === "" || f.high.trim() === "" || !Number.isFinite(a) || !Number.isFinite(b) || a === b) {
      return `Factor ${f.name}: low and high must be two different numbers.`;
    }
  }
  if (s.design === "plackett_burman" && s.k > s.runs - 1) return `${s.runs} runs fit at most ${s.runs - 1} factors.`;
  if (s.design === "fractional_factorial" && s.p === null) return "No published fraction for this number of factors.";
  if (s.design === "ccd" && s.alpha === "custom" && !(Number(s.alphaCustom) > 0)) return "Alpha must be a positive number.";
  const bProblem = blockingProblem(s);
  if (bProblem) return bProblem;
  if (s.design === "d_optimal") {
    if (!/^\d+$/.test(s.nRuns.trim()) || Number(s.nRuns) < 1) return "Runs must be a whole number of 1 or more.";
    if (s.gridLevels.trim() !== "" && !/^[2-9]$/.test(s.gridLevels.trim())) return "Levels per factor must be 2 to 9.";
    if (!/^\d+$/.test(s.optSeed.trim())) return "Seed must be a whole number.";
  }
  if (!/^\d+$/.test(s.replicates) || Number(s.replicates) < 1) return "Replicates must be a whole number of 1 or more.";
  if (s.center.trim() !== "" && !/^\d+$/.test(s.center.trim())) return "Center points must be a whole number.";
  if (s.seed.trim() !== "" && !/^\d+$/.test(s.seed.trim())) return "Seed must be a whole number.";
  return null;
}

export function setupBody(s: DoeSetup) {
  const opt = s.design === "d_optimal";
  const factors: DoeFactorBody[] = s.factors.map((f) => {
    const cat = opt && f.levels.trim() !== "";
    return {
      name: f.name.trim(), low: cat ? -1 : Number(f.low), high: cat ? 1 : Number(f.high), unit: f.unit.trim(),
      ...(cat ? { levels: levelList(f) } : {}),
    };
  });
  const twoLevel = s.design === "full_factorial" || s.design === "fractional_factorial" || s.design === "plackett_burman";
  return {
    design: s.design, factors, response_name: s.responseName.trim(),
    p: s.design === "fractional_factorial" ? s.p : null,
    runs: s.design === "plackett_burman" ? s.runs : null,
    replicates: twoLevel ? Number(s.replicates) : 1,
    center_points: s.center.trim() === "" || opt ? null : Number(s.center),
    alpha: s.alpha === "custom" ? Number(s.alphaCustom) : s.alpha,
    ccd_fractional: s.design === "ccd" && s.ccdFractional,
    ccd_inscribed: s.design === "ccd" && s.inscribed,
    randomize: s.randomize,
    // D-optimal shows ONE seed (provisional, owner to confirm): it seeds the optimizer and the run-order shuffle.
    seed: s.randomize ? (opt ? Number(s.optSeed) : s.seed.trim() !== "" ? Number(s.seed) : null) : null,
    ...(isFactorial(s.design) && Number(s.blocks) > 1
      ? { blocks: Number(s.blocks), block_generators: blockGenList(s).length > 0 ? blockGenList(s) : null } : {}),
    ...(opt ? {
      model: s.optModel, n_runs: Number(s.nRuns), method: s.method, opt_seed: Number(s.optSeed),
      grid_levels: s.gridLevels.trim() === "" ? null : Number(s.gridLevels),
    } : {}),
  };
}

export function useDoe() {
  const [setup, setSetup] = useState<DoeSetup>(INITIAL_SETUP);
  const [fractions, setFractions] = useState<DoeFractionsResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setStatus = useApp((s) => s.setStatus);
  const [generated, setGenerated] = useState<GeneratedDesign | null>(null);
  useDoeReopen(setSetup);

  useEffect(() => {
    let live = true;
    doeFractions(setup.k).then((r) => { if (live) setFractions(r); }, () => { if (live) setFractions(null); });
    return () => { live = false; };
  }, [setup.k]);

  // Keep the chosen fraction valid for the factor count (default: the first listed = fewest aliases).
  useEffect(() => {
    if (!fractions || fractions.k !== setup.k) return;
    const ok = fractions.fractions.some((f) => f.p === setup.p);
    if (!ok) setSetup((s) => ({ ...s, p: fractions.fractions.find((f) => f.runs <= 2 ** (s.k - 1))?.p ?? fractions.fractions[0]?.p ?? null }));
  }, [fractions, setup.k, setup.p]);

  const update = useCallback((patch: Partial<DoeSetup>) => setSetup((s) => {
    const next = { ...s, ...patch };
    if (patch.design) {
      const [lo, hi] = kRange(patch.design);
      next.k = Math.min(hi, Math.max(lo, next.k));
    }
    next.factors = factorRows(next.k, next.factors);
    return next;
  }), []);
  const setFactor = useCallback((i: number, patch: Partial<FactorRow>) => setSetup((s) => ({
    ...s, factors: s.factors.map((f, j) => (j === i ? { ...f, ...patch } : f)),
  })), []);

  const problem = setupProblem(setup);
  const generate = useCallback(async () => {
    if (problem) return;
    setBusy(true);
    setError(null);
    try {
      const { dataset } = await doeGenerate(setupBody(setup));
      const meta = doeMeta(dataset);
      const name = `DOE ${meta ? designTitle(meta) : "design"}`;
      const [id] = addDatasetsOneStep("generate design", [{ name, data: dataset }]);
      // What "Save result" on this design records: the form as sent, with the seed the server used.
      if (id) setGenerated({ datasetId: id, setup: { ...setup, seed: meta?.randomized && typeof meta.seed === "number" ? String(meta.seed) : setup.seed } });
      setStatus(`generated ${dataset.time.length}-run design: fill in "${setup.responseName.trim()}", then Analyze design`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Design generation failed");
    } finally {
      setBusy(false);
    }
  }, [problem, setStatus, setup]);

  return { setup, update, setFactor, fractions, busy, error, problem, generate, generated };
}
export type DoeState = ReturnType<typeof useDoe>;

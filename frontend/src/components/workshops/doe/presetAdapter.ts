// Design of experiments' preset adapter (plans/PRESET_BAR_CONTRACT.md section
// 6), generic backend. A preset is the design setup: the design type, the
// factor count and each factor's name, low / high settings, unit and (for a
// D-optimal design) its level names, the response name, and the options of the
// design chosen (Plackett-Burman runs, the fraction, the central-composite
// alpha and variants, replicates, centre points, blocking, the D-optimal
// model, runs, method, grid and seed, and the run-order randomisation and
// seed). Nothing here names data: a design has no dataset until it is
// generated. Options the chosen design hides are neither checked nor stored
// (lib/presetShownFields.ts), so a refused value in a knob the user cannot see
// never blocks Save; a factor's low / high are hidden while a D-optimal factor
// is categorical.
// Lazy: loaded with the preset bar and after a successful Generate.

import {
  checkBoolean, checkNumberText, checkOneOf, parseFields,
  type ApplyOutcome, type FieldCheck, type PresetAdapter,
} from "../../../lib/presetAdapter";
import { recordLastUsed } from "../../../lib/presetLastUsed";
import { shownFieldKit } from "../../../lib/presetShownFields";
import { ALPHA_OPTIONS, BLOCK_OPTIONS, METHOD_OPTIONS, MODEL_OPTIONS, PB_RUN_COUNTS } from "./doeOptions";
import { DESIGN_OPTIONS, INITIAL_SETUP, kRange, type DoeSetup, type FactorRow } from "./useDoe";

/** The slice of the panel the adapter reads and writes. */
export interface DoePanelHandle {
  setup: DoeSetup;
  update: (patch: Partial<DoeSetup>) => void;
}

export const DOE_WORKSHOP = "doe";
export const DOE_SCHEMA = 1;

type Flat = Omit<DoeSetup, "factors">;
const values = (options: readonly { value: string }[]): string[] => options.map((o) => o.value);
const whole = (lo: number, hi?: number) => (n: number) =>
  Number.isInteger(n) && n >= lo && (hi === undefined || n <= hi) ? null : `must be a whole number ${hi === undefined ? `of ${lo} or more` : `from ${lo} to ${hi}`}`;
const text = (max: number): FieldCheck => (v) => (typeof v === "string" && v.length <= max ? null : `must be text of at most ${max} characters`);

const STRICT: { [K in keyof Flat]: FieldCheck } = {
  design: checkOneOf(values(DESIGN_OPTIONS)),
  k: (v) => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 30 ? null : "must be a whole number from 1 to 30"),
  responseName: text(60),
  p: (v) => (v === null || (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 11) ? null : "must be empty or a whole number from 1 to 11"),
  runs: (v) => (typeof v === "number" && PB_RUN_COUNTS.includes(v) ? null : `must be one of ${PB_RUN_COUNTS.join(", ")}`),
  replicates: checkNumberText(whole(1)),
  center: checkNumberText(whole(0)),
  alpha: checkOneOf(values(ALPHA_OPTIONS)),
  alphaCustom: checkNumberText((n) => (n > 0 ? null : "must be positive")),
  ccdFractional: checkBoolean,
  inscribed: checkBoolean,
  randomize: checkBoolean,
  seed: checkNumberText(whole(0)),
  blocks: checkOneOf(values(BLOCK_OPTIONS)),
  blockGens: text(80),
  optModel: checkOneOf(values(MODEL_OPTIONS)),
  nRuns: checkNumberText(whole(1)),
  method: checkOneOf(values(METHOD_OPTIONS)),
  gridLevels: checkNumberText(whole(2, 9)),
  optSeed: checkNumberText(whole(0)),
};

const { factors: _f, ...FLAT_DEFAULTS } = INITIAL_SETUP;
void _f;

/** The settings the chosen design shows (everything else is hidden from the user). */
function shown(s: Record<string, unknown>): string[] {
  const d = s["design"];
  const optimal = d === "d_optimal";
  const twoLevel = d === "full_factorial" || d === "fractional_factorial" || d === "plackett_burman";
  return [
    "design", "k", "responseName", "randomize",
    ...(d === "plackett_burman" ? ["runs"] : []),
    ...(d === "fractional_factorial" ? ["p"] : []),
    ...(d === "ccd" ? ["alpha", "inscribed", "ccdFractional", ...(s["alpha"] === "custom" ? ["alphaCustom"] : [])] : []),
    ...(twoLevel ? ["replicates"] : []),
    ...(d === "full_factorial" || d === "fractional_factorial" ? ["blocks", ...(s["blocks"] === "1" ? [] : ["blockGens"])] : []),
    ...(optimal ? ["optModel", "nRuns", "method", "gridLevels", "optSeed"] : ["center", ...(s["randomize"] === true ? ["seed"] : [])]),
  ];
}

const kit = shownFieldKit<Flat>(STRICT, FLAT_DEFAULTS, shown);

const rec = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
/** A D-optimal factor with level names is categorical: its low / high are hidden. */
const categorical = (design: unknown, f: unknown): boolean => design === "d_optimal" && typeof rec(f)["levels"] === "string" && (rec(f)["levels"] as string).trim() !== "";

function factorsProblem(design: unknown, v: unknown): string | null {
  if (!Array.isArray(v) || v.length < 1 || v.length > 30) return "must list 1 to 30 factors";
  for (const [i, f] of v.entries()) {
    const edge = categorical(design, f) ? text(40) : checkNumberText();
    const r = parseFields<FactorRow>(f, { name: text(40), low: edge, high: edge, unit: text(40), levels: text(200) });
    if ("error" in r && Object.keys(r).length === 1) return `is not valid: factor ${i + 1}: ${r.error}`;
  }
  return null;
}

function parseSettings(raw: unknown): DoeSetup | { error: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { error: "the settings are not an object" };
  const { factors, ...rest } = raw as Record<string, unknown>;
  if (!("factors" in raw)) return { error: "setting 'factors' is missing" };
  const flat = kit.parse(rest);
  if ("error" in flat && Object.keys(flat).length === 1) return flat;
  const f = flat as Flat;
  const bad = factorsProblem(f.design, factors);
  if (bad) return { error: `setting 'factors' ${bad}` };
  const list = factors as FactorRow[];
  const [lo, hi] = kRange(f.design);
  if (f.k < lo || f.k > hi) return { error: `setting 'k' must be ${lo} to ${hi} factors for this design` };
  if (list.length !== f.k) return { error: `setting 'factors' must list exactly ${f.k} factors (the factor count 'k')` };
  return { ...f, factors: list.map((x) => ({ ...x })) };
}

const flatOf = (s: DoeSetup): Flat => {
  const { factors: _drop, ...rest } = s;
  void _drop;
  return rest;
};

/** `s` with each hidden knob that fails its strict check taken from `fallback` (a categorical factor's low / high become -1 and 1). */
function storable(s: DoeSetup, fallback: DoeSetup): DoeSetup {
  const flat = kit.storable(flatOf(s), flatOf(fallback));
  const factors = s.factors.map((f, i) => {
    if (!categorical(s.design, f)) return { ...f };
    const spare = fallback.factors[i] ?? { low: "-1", high: "1" };
    const edge = checkNumberText();
    return { ...f, low: edge(f.low) === null ? f.low : spare.low, high: edge(f.high) === null ? f.high : spare.high };
  });
  return { ...flat, factors };
}

const DEFAULTS: DoeSetup = { ...INITIAL_SETUP, factors: INITIAL_SETUP.factors.map((f) => ({ ...f })) };

export function createDoeAdapter(panel: DoePanelHandle): PresetAdapter<DoeSetup> {
  return {
    workshop: DOE_WORKSHOP,
    label: "Design of experiments",
    runLabel: "Generate worksheet",
    schema: DOE_SCHEMA,
    defaults: () => ({ ...DEFAULTS, factors: DEFAULTS.factors.map((f) => ({ ...f })) }),
    parse: parseSettings,
    capture: () => storable(panel.setup, DEFAULTS),
    apply(raw): ApplyOutcome {
      const s = storable(raw, panel.setup); // a refused hidden value is not written into the form
      panel.update({ ...s, factors: s.factors.map((f) => ({ ...f })) });
      return { ok: true, applied: Object.keys(raw), skipped: [], notes: [] };
    },
    describe: (s) => {
      const name = DESIGN_OPTIONS.find((o) => o.value === s.design)?.label ?? s.design;
      return `${name}, ${s.k} factors (${s.factors.map((f) => f.name).join(", ")})`;
    },
  };
}

/** After a successful Generate: remember the setup as last used (only if it would read back). */
export function recordDoeRun(setup: DoeSetup): void {
  if ("error" in parseSettings(setup)) return;
  recordLastUsed({ workshop: DOE_WORKSHOP, schema: DOE_SCHEMA }, setup);
}

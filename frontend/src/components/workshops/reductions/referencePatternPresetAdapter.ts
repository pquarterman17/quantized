// XRD reference pattern's preset adapter (plans/PRESET_BAR_CONTRACT.md section 6),
// generic backend. The Reductions window holds five methods; this adapter is the
// reference-pattern one. A preset is how the sticks are READ and DRAWN: whether
// an unknown first column is taken as 2-theta, the vertical offset, the maximum
// height, the colour and whether reflection labels show. The loaded pattern (its
// reflections, name and source wavelength) is DATA and is never stored (P5):
// Apply says to choose the reference file. The four drawing knobs are hidden
// until a pattern is loaded: while it is not, a value the check refuses is
// replaced by its default when saved rather than blocking Save over a field the
// user cannot see (lib/presetHiddenFields.ts), and a preset never carries one.
// Lazy: loaded with the preset bar and after the sticks are added.

import {
  checkBoolean, checkOneOf, parseFields,
  type ApplyOutcome, type FieldCheck, type PresetAdapter,
} from "../../../lib/presetAdapter";
import { storeHidden } from "../../../lib/presetHiddenFields";
import { recordLastUsed } from "../../../lib/presetLastUsed";
import { REFERENCE_AXIS_MODES, type ReferenceAxisMode } from "../../../lib/xrdReferencePattern";

export interface ReferencePatternPreset {
  axisMode: ReferenceAxisMode;
  /** Vertical offset as a fraction of the plot height, as typed. */
  baseline: string;
  /** Maximum stick height as a fraction of the plot height, as typed. */
  height: string;
  color: string;
  showLabels: boolean;
}

/** What the section holds, and whether a pattern is loaded (which shows the drawing knobs). */
export interface ReferencePatternHandle {
  axisMode: ReferenceAxisMode;
  setAxisMode: (m: ReferenceAxisMode) => void;
  baseline: string;
  setBaseline: (v: string) => void;
  height: string;
  setHeight: (v: string) => void;
  color: string;
  setColor: (v: string) => void;
  showLabels: boolean;
  setShowLabels: (v: boolean) => void;
  patternLoaded: boolean;
}

export const REFERENCE_PATTERN_WORKSHOP = "xrd-reference";
export const REFERENCE_PATTERN_SCHEMA = 1;

const typed = (v: unknown): number => (typeof v === "string" && v.length <= 40 && v.trim() !== "" ? Number(v) : Number.NaN);
const offset: FieldCheck = (v) => { const n = typed(v); return Number.isFinite(n) && n >= 0 && n < 1 ? null : "must be a number from 0 to less than 1"; };
const stickHeight: FieldCheck = (v) => { const n = typed(v); return Number.isFinite(n) && n > 0 && n <= 1 ? null : "must be a number above 0 and at most 1"; };

const STRICT: { [K in keyof ReferencePatternPreset]: FieldCheck } = {
  axisMode: checkOneOf(REFERENCE_AXIS_MODES),
  baseline: offset,
  height: stickHeight,
  color: (v) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? null : "must be a colour such as #d97706"),
  showLabels: checkBoolean,
};

const DEFAULTS: ReferencePatternPreset = { axisMode: "auto", baseline: "0.03", height: "0.18", color: "#d97706", showLabels: false };
const DRAWING: readonly (keyof ReferencePatternPreset)[] = ["baseline", "height", "color", "showLabels"];

function parseSettings(raw: unknown): ReferencePatternPreset | { error: string } {
  const r = parseFields<ReferencePatternPreset>(raw, STRICT);
  if ("error" in r && Object.keys(r).length === 1) return r;
  const s = r as ReferencePatternPreset;
  if (Number(s.baseline) + Number(s.height) > 1) return { error: "setting 'height' must fit above the offset 'baseline'" };
  return s;
}

export function presetFromPanel(p: Pick<ReferencePatternHandle, "axisMode" | "baseline" | "height" | "color" | "showLabels">): ReferencePatternPreset {
  return { axisMode: p.axisMode, baseline: p.baseline, height: p.height, color: p.color, showLabels: p.showLabels };
}

export function createReferencePatternAdapter(panel: ReferencePatternHandle): PresetAdapter<ReferencePatternPreset> {
  return {
    workshop: REFERENCE_PATTERN_WORKSHOP,
    label: "XRD reference pattern",
    runLabel: "Add reference sticks",
    schema: REFERENCE_PATTERN_SCHEMA,
    defaults: () => ({ ...DEFAULTS }),
    parse: parseSettings,
    capture() {
      const now = presetFromPanel(panel);
      if (panel.patternLoaded) return now;
      const hidden = storeHidden(now, STRICT, DRAWING, DEFAULTS);
      return "error" in parseSettings(hidden) ? { ...hidden, baseline: DEFAULTS.baseline, height: DEFAULTS.height } : hidden;
    },
    apply(s): ApplyOutcome {
      if (panel.axisMode !== s.axisMode) panel.setAxisMode(s.axisMode);
      panel.setBaseline(s.baseline);
      panel.setHeight(s.height);
      panel.setColor(s.color);
      panel.setShowLabels(s.showLabels);
      return { ok: true, applied: Object.keys(s), skipped: [], notes: ["choose the reference file: a preset does not store the pattern"] };
    },
    describe: (s) => `${s.axisMode === "two-theta" ? "first column read as 2θ" : "axis detected"}, offset ${s.baseline}, height ${s.height}, ${s.color}${s.showLabels ? ", labelled" : ""}`,
  };
}

/** After the sticks are added: remember the settings as last used (only if they would read back). */
export function recordReferencePatternRun(settings: ReferencePatternPreset): void {
  if ("error" in parseSettings(settings)) return;
  recordLastUsed({ workshop: REFERENCE_PATTERN_WORKSHOP, schema: REFERENCE_PATTERN_SCHEMA }, settings);
}

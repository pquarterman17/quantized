// Surface fit z = f(x, y)'s preset adapter (plans/PRESET_BAR_CONTRACT.md section
// 6), generic backend. A preset is the X, Y and Z columns BY LABEL (P5) and the
// model's name. Settings only: no dataset, no row range, no excluded rows. The
// start values and bounds are NOT stored: the start values are estimated from
// the data (a seeded start the user did not choose is not a setting, section
// 10), and the panel re-estimates them whenever the model or a column changes,
// so Apply leaves that to the panel. A column label this sheet lacks (or has
// twice) is skipped and named, and the current pick stays; a model this build's
// backend does not list is skipped and named. There are no mode-dependent
// knobs, so nothing is hidden.
// Lazy: loaded with the preset bar and after a successful fit.

import {
  parseFields, planColumnFields,
  type ApplyOutcome, type FieldCheck, type PresetAdapter,
} from "../../../lib/presetAdapter";
import { recordLastUsed } from "../../../lib/presetLastUsed";
import type { SurfaceFitState } from "./useSurfaceFit";

export interface SurfaceFitPreset {
  /** The X column, by label. */
  xColumn: string;
  yColumn: string;
  /** The fitted Z column, by label. */
  zColumn: string;
  /** The model's name, as the backend lists it. */
  model: string;
}

/** The slice of the panel the adapter reads and writes. */
export type SurfaceFitHandle = Pick<
  SurfaceFitState,
  "columns" | "xCol" | "yCol" | "zCol" | "setXCol" | "setYCol" | "setZCol" | "models" | "model" | "setModelName"
>;

export const SURFACE_FIT_WORKSHOP = "surface-fit";
export const SURFACE_FIT_SCHEMA = 1;

const label: FieldCheck = (v) => (typeof v === "string" && v.length > 0 && v.length <= 200 ? null : "must be a column label");
const modelName: FieldCheck = (v) => (typeof v === "string" && v.length > 0 && v.length <= 80 ? null : "must be a model name");

const parseSettings = (raw: unknown): SurfaceFitPreset | { error: string } =>
  parseFields<SurfaceFitPreset>(raw, { xColumn: label, yColumn: label, zColumn: label, model: modelName });

export function presetFromPanel(p: Pick<SurfaceFitHandle, "columns" | "xCol" | "yCol" | "zCol" | "model">): SurfaceFitPreset {
  const name = (i: number): string => p.columns.find((c) => c.index === i)?.label ?? "";
  return { xColumn: name(p.xCol), yColumn: name(p.yCol), zColumn: name(p.zCol), model: p.model?.name ?? "" };
}

export function createSurfaceFitAdapter(panel: SurfaceFitHandle): PresetAdapter<SurfaceFitPreset> {
  const adapter: PresetAdapter<SurfaceFitPreset> = {
    workshop: SURFACE_FIT_WORKSHOP,
    label: "Surface fit",
    runLabel: "Fit",
    schema: SURFACE_FIT_SCHEMA,
    columnFields: ["xColumn", "yColumn", "zColumn"],
    fieldNames: { xColumn: "X column", yColumn: "Y column", zColumn: "Z column" },
    defaults: () => ({
      xColumn: panel.columns[0]?.label ?? "x", yColumn: panel.columns[1]?.label ?? "y", zColumn: panel.columns[2]?.label ?? "z", model: panel.models[0]?.name ?? "Plane",
    }),
    parse: parseSettings,
    capture: () => presetFromPanel(panel),
    apply(s): ApplyOutcome {
      const plan = planColumnFields(adapter, s, panel.columns.map((c) => c.label));
      if ("refuse" in plan) return { ok: false, reason: plan.refuse };
      const skipped = [...plan.skipped];
      const pick = (field: "xColumn" | "yColumn" | "zColumn", set: (i: number) => void): void => {
        if (skipped.some((x) => x.field === field)) return;
        const same = panel.columns.filter((c) => c.label === s[field]);
        if (same.length === 1) set(same[0]!.index);
        else if (same.length > 1) skipped.push({ field, reason: `column '${s[field]}' appears more than once on this sheet, so none was picked` });
      };
      pick("xColumn", panel.setXCol);
      pick("yColumn", panel.setYCol);
      pick("zColumn", panel.setZCol);
      if (panel.models.some((m) => m.name === s.model)) panel.setModelName(s.model);
      else skipped.push({ field: "model", reason: panel.models.length ? `model '${s.model}' is not available` : "the model list has not loaded yet" });
      const skippedFields = new Set(skipped.map((f) => f.field));
      return {
        ok: true,
        applied: Object.keys(s).filter((k) => !skippedFields.has(k)),
        skipped,
        notes: ["start values are estimated from the data and bounds are not stored: check them before Fit"],
      };
    },
    describe: (s) => `${s.model}: ${s.zColumn} against ${s.xColumn} and ${s.yColumn}`,
  };
  return adapter;
}

/** After a successful fit: remember the settings as last used (only if they would read back). */
export function recordSurfaceFitRun(settings: SurfaceFitPreset): void {
  if ("error" in parseSettings(settings)) return;
  recordLastUsed({ workshop: SURFACE_FIT_WORKSHOP, schema: SURFACE_FIT_SCHEMA }, settings);
}

// SIMS depth profile, Align tab: its preset adapter (plans/PRESET_BAR_CONTRACT.md
// section 6), generic backend. A preset is what to align on (peak or junction
// depth), the reference species BY LABEL (P5), the junction threshold and the
// extra species to include. The picked profiles are DATA and are never stored:
// Apply says to pick them. A species the picked profiles do not all share is
// skipped and named, and the current choice stays. The junction threshold is
// hidden while aligning on the peak (lib/presetShownFields.ts): neither checked
// nor stored then, and an Apply never writes a refused one.
// Lazy: loaded with the preset bar and after a successful Create aligned worksheet.

import {
  checkOneOf, planColumnFields,
  type ApplyOutcome, type FieldCheck, type PresetAdapter,
} from "../../../lib/presetAdapter";
import { recordLastUsed } from "../../../lib/presetLastUsed";
import { shownFieldKit } from "../../../lib/presetShownFields";
import { checkLabelList, resolveLabels } from "../presets/columnLabels";
import { SIMS_ALIGN_BY_OPTIONS } from "./simsOptions";
import type { SimsAlignState } from "./useSimsAlign";

export interface SimsAlignPreset {
  by: SimsAlignState["by"];
  /** The species whose depth is aligned, by label. */
  reference: string;
  /** Percent of the reference's peak, as typed (junction only). */
  thresholdPct: string;
  /** Other species laid alongside, by label. */
  extra: string[];
}

/** The slice of the Align tab the adapter reads and writes. */
export type SimsAlignHandle = Pick<
  SimsAlignState,
  "by" | "setBy" | "reference" | "setReference" | "commonSpecies" | "thresholdPct" | "setThresholdPct" | "extra" | "setExtra"
>;

export const SIMS_ALIGN_WORKSHOP = "sims-align";
export const SIMS_ALIGN_SCHEMA = 1;

const percent: FieldCheck = (v) => {
  if (typeof v !== "string" || v.length > 40 || v.trim() === "") return "must be a number";
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n < 100 ? null : "must lie strictly between 0 and 100 percent";
};

const STRICT: { [K in keyof SimsAlignPreset]: FieldCheck } = {
  by: checkOneOf(SIMS_ALIGN_BY_OPTIONS.map((o) => o.value)),
  reference: (v) => (typeof v === "string" && v.length > 0 && v.length <= 200 ? null : "must be a species label"),
  thresholdPct: percent,
  extra: checkLabelList(0, 200),
};

const DEFAULTS: SimsAlignPreset = { by: "peak", reference: "species", thresholdPct: "50", extra: [] };

const kit = shownFieldKit<SimsAlignPreset>(STRICT, DEFAULTS, (s) => ["by", "reference", "extra", ...(s["by"] === "junction" ? ["thresholdPct"] : [])]);

const presetFromPanel = (p: SimsAlignHandle): SimsAlignPreset => ({ by: p.by, reference: p.reference, thresholdPct: p.thresholdPct, extra: [...p.extra] });

export function createSimsAlignAdapter(panel: SimsAlignHandle): PresetAdapter<SimsAlignPreset> {
  const adapter: PresetAdapter<SimsAlignPreset> = {
    workshop: SIMS_ALIGN_WORKSHOP,
    label: "SIMS align",
    runLabel: "Create aligned worksheet",
    schema: SIMS_ALIGN_SCHEMA,
    columnFields: ["reference"],
    fieldNames: { reference: "reference species", extra: "extra species" },
    defaults: () => ({ ...DEFAULTS, reference: panel.commonSpecies[0] ?? "species" }),
    parse: (raw) => kit.parse(raw),
    capture: () => kit.storable(presetFromPanel(panel), DEFAULTS),
    apply(raw): ApplyOutcome {
      const s = kit.storable(raw, presetFromPanel(panel)); // a refused hidden value is not written into the panel
      const plan = planColumnFields(adapter, s, panel.commonSpecies);
      if ("refuse" in plan) return { ok: false, reason: plan.refuse };
      const skipped = [...plan.skipped];
      const referenceFound = !skipped.some((x) => x.field === "reference");
      if (referenceFound) panel.setReference(s.reference);
      const options = panel.commonSpecies.map((label, index) => ({ index, label }));
      const found = resolveLabels(s.extra, options);
      for (const name of found.missing) skipped.push({ field: "extra", reason: `species '${name}' is not in every picked profile` });
      panel.setExtra(found.indices.map((i) => options[i]!.label));
      panel.setBy(s.by);
      panel.setThresholdPct(s.thresholdPct);
      const skippedFields = new Set(skipped.map((x) => x.field));
      return { ok: true, applied: Object.keys(raw).filter((k) => !skippedFields.has(k)), skipped, notes: ["pick the profiles to align: a preset does not store them"] };
    },
    describe: (s) => `align on ${s.by === "junction" ? `junction (${s.thresholdPct}% of peak)` : "peak"} depth of ${s.reference}${s.extra.length ? `, also ${s.extra.join(", ")}` : ""}`,
  };
  return adapter;
}

/** After a successful Create: remember the settings as last used (only if they would read back). */
export function recordSimsAlignRun(settings: SimsAlignPreset): void {
  const stored = kit.storable({ ...settings, extra: [...settings.extra] }, DEFAULTS);
  if ("error" in kit.parse(stored)) return;
  recordLastUsed({ workshop: SIMS_ALIGN_WORKSHOP, schema: SIMS_ALIGN_SCHEMA }, stored);
}

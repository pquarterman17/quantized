// Peaks' preset adapter (plans/PRESET_BAR_CONTRACT.md sections 3 and 6). Peak
// recipes ARE this workshop's presets: the bar reads and writes the records the
// Peak analyzer already uses (`peakRecipeBackend`), nothing is migrated, and a
// preset saved here is a valid peak recipe for the old path.
//
// The settings are the detector's `find` fields and the fit controls
// (./peakPresetSettings); no dataset ids, row ranges or peak lists (P5). Apply
// loads the Advanced draft and the fit controls and never runs a find or a fit:
// the committed find settings only change on "Find again".
// Lazy: loaded with the preset bar.

import { checkBoolean, checkOneOf, parseFields, type ApplyOutcome, type FieldCheck, type PresetAdapter } from "../../../lib/presetAdapter";
import { looseChecks, storeHidden } from "../../../lib/presetHiddenFields";
import { recordLastUsed } from "../../../lib/presetLastUsed";
import { PEAK_LINK_MODES, PEAK_SHAPES } from "../../../lib/peakwizard";
import type { PeakFindParams } from "./peakFindParams";
import { DEFAULT_PEAK_SETTINGS, joinSettings, splitSettings, type PeakPresetSettings } from "./peakPresetSettings";
import { peakRecipeBackend } from "./peakRecipeBackend";
import type { PeakFitOptions } from "./peakTypes";

/** The slice of the panel the adapter reads and writes (`usePeakSettings`). */
export interface PeaksPanelHandle {
  getDraft(): PeakFindParams;
  getFitOptions(): PeakFitOptions;
  /** Replace the Advanced draft; does NOT run a find. */
  setDraft(find: PeakFindParams): void;
  setFitOptions(fit: PeakFitOptions): void;
}

export const PEAKS_WORKSHOP = "peaks";
export const PEAKS_SCHEMA = 1;

const nonNegative = (n: number) => (n >= 0 ? null : "must not be negative");
const wholeFrom = (min: number) => (n: number) => (Number.isInteger(n) && n >= min ? null : `must be a whole number of ${min} or more`);

const num = (extra: (n: number) => string | null): FieldCheck => (v) => {
  if (typeof v !== "number" || !Number.isFinite(v)) return "must be a number";
  return extra(v);
};

const STRICT: { [K in keyof PeakPresetSettings]: FieldCheck } = {
  sensitivity: checkOneOf(["low", "medium", "high"]),
  snr_threshold: num(nonNegative),
  min_prominence: num(nonNegative),
  max_peaks: num(wholeFrom(1)),
  min_separation: num(nonNegative),
  min_width_deg: num(nonNegative),
  max_width_deg: num(nonNegative),
  bg_method: checkOneOf(["snip", "polynomial"]),
  max_window_deg: num(nonNegative),
  bg_poly_degree: num(wholeFrom(0)),
  bg_iterative: checkBoolean,
  strict_prominence: checkBoolean,
  finder: checkOneOf(["residual", "derivative1", "derivative2"]),
  smooth_window: num(wholeFrom(0)),
  shape: checkOneOf(PEAK_SHAPES),
  bgDegree: num((n) => (Number.isInteger(n) && n >= 0 && n <= 6 ? null : "must be a whole number from 0 to 6")),
  linkMode: checkOneOf(PEAK_LINK_MODES),
  constrain: checkBoolean,
};
const anyNumber = num(() => null);
const LOOSE = { max_window_deg: anyNumber, bg_poly_degree: anyNumber, smooth_window: anyNumber };

/** The Advanced fields the current finder and background method do not show: the SNIP window under a polynomial
 *  background, the polynomial degree under SNIP, the smoothing window for the residual finder. */
function hiddenFor(settings: unknown): ("max_window_deg" | "bg_poly_degree" | "smooth_window")[] {
  const s = typeof settings === "object" && settings !== null ? (settings as Record<string, unknown>) : {};
  return [s["bg_method"] === "snip" ? "bg_poly_degree" : "max_window_deg", ...(s["finder"] === "residual" ? ["smooth_window" as const] : [])];
}

export function createPeaksAdapter(panel: PeaksPanelHandle): PresetAdapter<PeakPresetSettings> {
  const adapter: PresetAdapter<PeakPresetSettings> = {
    workshop: PEAKS_WORKSHOP,
    label: "Peaks",
    runLabel: "Find again, then Fit",
    schema: PEAKS_SCHEMA,
    defaults: () => ({ ...DEFAULT_PEAK_SETTINGS }),
    parse: (raw) => parseFields<PeakPresetSettings>(raw, looseChecks<PeakPresetSettings>(STRICT, hiddenFor(raw), LOOSE)),
    capture: () => {
      const settings = joinSettings(panel.getDraft(), panel.getFitOptions());
      return storeHidden(settings, STRICT, hiddenFor(settings), DEFAULT_PEAK_SETTINGS); // never a refused value the user cannot see
    },
    apply(settings): ApplyOutcome {
      const { find, fit } = splitSettings(settings);
      panel.setDraft(find);
      panel.setFitOptions(fit);
      return {
        ok: true,
        applied: Object.keys(settings),
        skipped: [],
        notes: ["the detector settings are in Advanced; the baseline and range of a recipe belong to the Peak analyzer and are not applied here"],
      };
    },
    describe: (s) =>
      `${s.shape}, ${s.linkMode === "None" ? "independent widths" : s.linkMode}, background degree ${s.bgDegree}${s.constrain ? ", centres constrained" : ""}; finder ${s.finder}, SNR ${s.snr_threshold}, prominence ${s.min_prominence}, at most ${s.max_peaks} peaks`,
  };
  adapter.backend = peakRecipeBackend(adapter);
  return adapter;
}

/** After a successful fit: remember the find settings it ran on and the fit controls it used. */
export function recordPeaksRun(find: PeakFindParams, fit: PeakFitOptions): void {
  recordLastUsed({ workshop: PEAKS_WORKSHOP, schema: PEAKS_SCHEMA }, joinSettings(find, fit));
}

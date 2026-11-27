// Map operations' preset adapter (plans/PRESET_BAR_CONTRACT.md section 6),
// generic backend. A preset is the operation and the options of the operation
// chosen: the crop bounds (a value-space window, allowed by P5), the flip axis,
// the rotation, the plane-level order, the arithmetic and its number, the 2-D
// FFT output and window, the FFT filter's type and cutoffs, the image filter
// and its edge handling. Settings only (P5): not the second map B (a dataset),
// not the X / Y / value column picks (columns of one map). Options the chosen
// operation hides are neither checked nor stored (lib/presetShownFields.ts), so
// a refused value in a knob the user cannot see never blocks Save.
// Lazy: loaded with the preset bar and after a successful run.

import {
  checkBoolean, checkNumberText, checkOneOf,
  type ApplyOutcome, type FieldCheck, type PresetAdapter,
} from "../../../lib/presetAdapter";
import { recordLastUsed } from "../../../lib/presetLastUsed";
import { shownFieldKit } from "../../../lib/presetShownFields";
import { ARITH_OPTIONS, OP_OPTIONS, emptyForm, type MapOpsForm } from "./mapOpsForm";
import {
  EDGE_MODE_OPTIONS, FFT_OUTPUT_OPTIONS, FFT_WINDOW_OPTIONS, FILTER_MODE_OPTIONS, FLIP_OPTIONS, IMAGE_FILTER_OPTIONS, LEVEL_ORDER_OPTIONS,
  ROTATE_OPTIONS, SOBEL_OPTIONS,
} from "./mapOpsOptions";

export type MapOpsSettings = Omit<MapOpsForm, "otherId">;

/** The slice of the panel the adapter reads and writes. */
export interface MapOpsPanelHandle {
  form: MapOpsForm;
  setForm: (patch: Partial<MapOpsForm>) => void;
}

export const MAP_OPS_WORKSHOP = "map-ops";
export const MAP_OPS_SCHEMA = 1;

const values = (options: readonly { value: string }[]): string[] => options.map((o) => o.value);
const positive = (n: number) => (n > 0 ? null : "must be positive");
const atLeastZero = (n: number) => (n >= 0 ? null : "must be zero or more");
const whole = (n: number) => (Number.isInteger(n) && n >= 1 ? null : "must be a whole number of 1 or more");

export function settingsFromForm(f: MapOpsForm): MapOpsSettings {
  const { otherId: _other, ...rest } = f;
  void _other;
  return rest;
}

const DEFAULTS: MapOpsSettings = settingsFromForm(emptyForm());

const STRICT: { [K in keyof MapOpsSettings]: FieldCheck } = {
  op: checkOneOf(values(OP_OPTIONS)),
  xmin: checkNumberText(), xmax: checkNumberText(), ymin: checkNumberText(), ymax: checkNumberText(),
  flipAxis: checkOneOf(values(FLIP_OPTIONS)),
  degrees: checkOneOf(values(ROTATE_OPTIONS)),
  order: checkOneOf(values(LEVEL_ORDER_OPTIONS)),
  restoreMean: checkBoolean,
  arith: checkOneOf(values(ARITH_OPTIONS)),
  interpolate: checkBoolean,
  allowMismatch: checkBoolean,
  scalar: checkNumberText(),
  reverse: checkBoolean,
  fftOutput: checkOneOf(values(FFT_OUTPUT_OPTIONS)),
  fftWindow: checkOneOf(values(FFT_WINDOW_OPTIONS)),
  fftRemoveMean: checkBoolean,
  fMode: checkOneOf(values(FILTER_MODE_OPTIONS)),
  cutLow: checkNumberText(positive), cutHigh: checkNumberText(positive), edgeSigma: checkNumberText(atLeastZero),
  imgKind: checkOneOf(values(IMAGE_FILTER_OPTIONS)),
  sigma: checkNumberText(positive), size: checkNumberText(whole),
  edgeMode: checkOneOf(values(EDGE_MODE_OPTIONS)),
  cval: checkNumberText(),
  gradient: checkOneOf(values(SOBEL_OPTIONS)),
};

/** The settings the chosen operation shows (everything else is hidden from the user). */
function shown(s: Record<string, unknown>): string[] {
  switch (s["op"]) {
    case "crop": return ["op", "xmin", "xmax", "ymin", "ymax"];
    case "flip": return ["op", "flipAxis"];
    case "rotate": return ["op", "degrees"];
    case "level": return ["op", "order", "restoreMean"];
    case "arith": return ["op", "arith", "interpolate", "allowMismatch"];
    case "scalar": return ["op", "arith", "scalar", "reverse"];
    case "fft": return ["op", "fftOutput", "fftWindow", "fftRemoveMean"];
    case "fftfilter": return ["op", "fMode", "edgeSigma", ...(s["fMode"] === "lowpass" ? [] : ["cutLow"]), ...(s["fMode"] === "highpass" ? [] : ["cutHigh"])];
    case "imgfilter":
      return [
        "op", "imgKind", "edgeMode",
        ...(s["edgeMode"] === "constant" ? ["cval"] : []),
        ...(s["imgKind"] === "gaussian" ? ["sigma"] : []),
        ...(s["imgKind"] === "median" || s["imgKind"] === "uniform" ? ["size"] : []),
        ...(s["imgKind"] === "sobel" ? ["gradient"] : []),
      ];
    default: return ["op"]; // transpose has no options, and an unknown op is refused by its own check
  }
}

const kit = shownFieldKit<MapOpsSettings>(STRICT, DEFAULTS, shown);

export function createMapOpsAdapter(panel: MapOpsPanelHandle): PresetAdapter<MapOpsSettings> {
  return {
    workshop: MAP_OPS_WORKSHOP,
    label: "Map operations",
    runLabel: "Apply → new dataset",
    schema: MAP_OPS_SCHEMA,
    defaults: () => ({ ...DEFAULTS }),
    parse: kit.parse,
    capture: () => kit.storable(settingsFromForm(panel.form), DEFAULTS),
    apply(raw): ApplyOutcome {
      const settings = kit.storable(raw, settingsFromForm(panel.form)); // a refused hidden value is not written into the form
      panel.setForm(settings);
      const notes = settings.op === "arith" ? ["pick map B: a preset does not store datasets"] : [];
      return { ok: true, applied: Object.keys(raw), skipped: [], notes };
    },
    describe: (s) => {
      const name = OP_OPTIONS.find((o) => o.value === s.op)?.label ?? s.op;
      const detail = s.op === "rotate" ? `${s.degrees}°` : s.op === "flip" ? s.flipAxis === "h" ? "horizontal" : "vertical"
        : s.op === "level" ? `order ${s.order}` : s.op === "scalar" ? `${s.arith} ${s.scalar}` : s.op === "arith" ? s.arith
          : s.op === "fft" ? `${s.fftOutput}, ${s.fftWindow} window` : s.op === "fftfilter" ? s.fMode
            : s.op === "imgfilter" ? s.imgKind : s.op === "crop" ? `X ${s.xmin || "…"}:${s.xmax || "…"}, Y ${s.ymin || "…"}:${s.ymax || "…"}` : "";
      return detail ? `${name}: ${detail}` : name;
    },
  };
}

/** After a successful run: remember the form as last used (only if it would read back). */
export function recordMapOpsRun(form: MapOpsForm): void {
  const settings = settingsFromForm(form);
  if ("error" in kit.parse(settings)) return;
  recordLastUsed({ workshop: MAP_OPS_WORKSHOP, schema: MAP_OPS_SCHEMA }, settings);
}

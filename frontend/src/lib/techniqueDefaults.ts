// Standard-plot defaults table (PLOT_WORKFLOW_PLAN item 2): technique ->
// partial view defaults, consumed by store/windows.ts's `datasetViewDefaults`
// (the silent import/switch auto-plot path -- no prompt, fully editable
// after; item 1's `technique` tag is the input). Data, not switch statements
// (the Boson `applyParserAnalysisConfig` lesson): adding a technique's
// default means adding a table row, never an `if`.
//
// Deliberately narrow scope: channel SELECTION (`metadata.default_value_
// channels` -- e.g. reflectometry's R+theory pick, io/ncnr.py) and error-bar
// seeding (`metadata.error_channels`) are ALREADY technique-aware per-parser
// hints consumed downstream (`lib/plotdata.ts`'s `defaultDenseChannels`,
// `lib/errorbars.ts`'s `defaultErrKeys`) -- this table only owns axis scale,
// so it SUBSUMES those hints (adds the axis-scale opinion they don't carry)
// rather than fighting them. No row touches `yKeys`, so `yKeys: null` still
// resolves through the existing hint-or-density-heuristic pipeline.

import type { AxisScale, Dataset, Technique } from "./types";

const TECHNIQUES = new Set<Technique>([
  "magnetometry.mvsh",
  "magnetometry.mvst",
  "xrd.powder",
  "xrd.rsm",
  "reflectometry",
  "sims",
  "transport",
  "spectroscopy",
  "generic",
]);

/** Whether `v` is one of the closed technique-tag strings -- exported so
 *  `lib/techniqueViewMemory.ts`'s `.dwk` sanitizer can validate a persisted
 *  memory map's keys against the SAME vocabulary `techniqueOf` narrows to,
 *  never a second, drifting list. */
export function isValidTechnique(v: string): v is Technique {
  return TECHNIQUES.has(v as Technique);
}

/** Narrow `ds.data.metadata.technique` (`unknown` off the wire) to the closed
 *  vocabulary, defaulting to `"generic"` for a missing/unrecognized tag (an
 *  import predating item 1, a plugin parser, or the manual import-wizard
 *  path -- see `io/registry.py`'s dispatch-chokepoint doc for which paths
 *  stamp it) or a missing dataset. Never guesses beyond the wire value. */
export function techniqueOf(ds: Dataset | undefined): Technique {
  const raw = ds?.data.metadata?.["technique"];
  return typeof raw === "string" && TECHNIQUES.has(raw as Technique)
    ? (raw as Technique)
    : "generic";
}

/** The view-field subset a technique's standard plot silently sets. */
export interface TechniqueViewDefaults {
  yScale?: AxisScale;
  xScale?: AxisScale;
}

// MATLAB defaults (updateControlsForActiveDataset.m:197-228): XRD/SIMS/RSM
// intensity axes are log. Reflectometry log R subsumes ncnr's
// default_value_channels channel hint -- a different axis of the same view,
// not a competing mechanism. Magnetometry/transport are explicitly linear
// (not just "unset") so switching FROM a log-technique window resets it;
// spectroscopy too (an IR spectrum opened after a SIMS profile kept its log
// y). generic (no technique evidence) gets linear x AND y on a technique
// change, so an SLD profile or plain CSV opened after a log-y reflectivity
// or SIMS window no longer inherits log axes; generic -> generic keeps them.
// Shared, frozen rows (the one consumer spreads them; eager-bundle budget).
const LOG_Y: TechniqueViewDefaults = Object.freeze({ yScale: "log" });
const LINEAR_Y: TechniqueViewDefaults = Object.freeze({ yScale: "linear" });
const LINEAR_XY: TechniqueViewDefaults = Object.freeze({ xScale: "linear", yScale: "linear" });
const TECHNIQUE_VIEW_DEFAULTS: Partial<Record<Technique, TechniqueViewDefaults>> = {
  "xrd.powder": LOG_Y,
  "xrd.rsm": LOG_Y,
  sims: LOG_Y,
  reflectometry: LOG_Y,
  "magnetometry.mvsh": LINEAR_Y,
  "magnetometry.mvst": LINEAR_Y,
  transport: LINEAR_Y,
  spectroscopy: LINEAR_Y,
  generic: LINEAR_XY,
};

/** The technique-driven view defaults for `ds` (an unmapped tag reads as
 *  generic). Pure table lookup; see the module doc for why "data,
 *  not switch statements" matters here. */
export function techniqueViewDefaults(ds: Dataset | undefined): TechniqueViewDefaults {
  return TECHNIQUE_VIEW_DEFAULTS[techniqueOf(ds)] ?? {};
}

/** Whether `prevDs` -> `ds` is a genuine technique change. `datasetViewDefaults`
 *  only applies the table above when this is true, so a same-technique
 *  dataset switch never clobbers a manual axis-scale override -- the "log
 *  axes survive a dataset switch" contract (windows.ts). An unknown previous
 *  dataset (fresh import, a split child, a shape-changed reimport) always
 *  counts as a change: there is no prior view worth preserving. */
export function isTechniqueChange(ds: Dataset | undefined, prevDs: Dataset | undefined): boolean {
  return prevDs === undefined || techniqueOf(ds) !== techniqueOf(prevDs);
}

// SIMS depth profile: the option lists the Process tab offers that are not
// already shared (the length, time and smoothing lists live in lib/transformSims),
// in one place so the selects that render them and the preset adapter that
// accepts them cannot drift.

import type { SimsAlignBy } from "../../../lib/transformSimsAlign";
import type { SimsCalMethod } from "../../../lib/transformSims";
import type { SimsForm } from "./simsForm";

export const SIMS_CAL_METHOD_OPTIONS: readonly { value: SimsCalMethod; label: string }[] = [
  { value: "crater", label: "Crater depth (profilometer)" },
  { value: "rate", label: "Known sputter rate" },
  { value: "scale", label: "Scale / divide existing x" },
];

export const SIMS_SCALE_MODE_OPTIONS: readonly { value: SimsForm["scaleMode"]; label: string }[] = [
  { value: "multiply", label: "Multiply x by" },
  { value: "divide", label: "Divide x by" },
];

export const SIMS_ALIGN_BY_OPTIONS: readonly { value: SimsAlignBy; label: string }[] = [
  { value: "peak", label: "peak depth" },
  { value: "junction", label: "junction depth" },
];

export const SIMS_THRESHOLD_MODE_OPTIONS: readonly { value: "fraction" | "absolute"; label: string }[] = [
  { value: "fraction", label: "% of each species' peak" },
  { value: "absolute", label: "absolute value" },
];

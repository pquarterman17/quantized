// What a magnetometry dataset's X axis actually IS — field, or temperature.
//
// WHY. The Background tab unconditionally called
// `/api/magnetometry/subtract-background`, i.e.
// `calc.magnetometry.subtract_mag_background`: a ONE-SIDED linear fit over the
// top `auto_fraction` of the x-range. That is right for the high-temperature
// tail of an M(T) curve and WRONG for a hysteresis loop — its own docstring
// says "Do not use that on a hysteresis loop". On a saturated M(H) loop the
// one-sided window sits entirely in the +H tail, so the intercept it removes
// is `offset + Ms`, not `offset`: the whole loop is sheared down by Ms, the
// plateaus land on `0` and `-2*Ms`, and squareness reads a meaningless 1.0
// (measured, BUG-021). The correct routine, `subtract_hysteresis_background`,
// already exists and is already exposed.
//
// HOW WE DECIDE — DECLARED METADATA ONLY, AND FAIL CLOSED.
//   1. The declared UNIT decides when it is recognisable (Oe/T/mT/A/m/G...
//      ⇒ field; K/°C/°F ⇒ temperature).
//   2. Otherwise the declared LABEL decides ("field"/"applied H" ⇒ field,
//      "temperature"/"sample T" ⇒ temperature) — but a LONE symbol never
//      classifies on its own; see `isLoneSymbol`.
//   3. A unit and a label that DISAGREE yield `unknown`, not a winner.
//   4. Anything else yields `unknown`.
//
// SHAPE HEURISTICS ARE DELIBERATELY NOT A DECIDER. A loop's x is
// non-monotonic and roughly symmetric about zero, which is suggestive — but
// silently guessing the analysis from the shape of the data is precisely the
// failure mode being fixed, in a new costume. `unknown` is surfaced in the UI
// and the user picks; nothing runs until they do.

export type MagXKind = "field" | "temperature" | "unknown";

export interface MagXDetection {
  kind: MagXKind;
  /** One short phrase naming the evidence, for the panel to show. */
  reason: string;
}

const FIELD_UNITS = new Set([
  "oe",
  "koe",
  "moe",
  "t",
  "mt",
  "ut",
  "µt",
  "μt",
  "kt",
  "g",
  "gauss",
  "kg",
  "a/m",
  "ka/m",
  "am^-1",
  "a m^-1",
]);

// Bare "C" and "F" are left out on purpose — they are Coulomb and Farad at
// least as often as they are degrees, and an ambiguous unit must fall through
// to the label rather than decide.
const TEMPERATURE_UNITS = new Set([
  "k",
  "kelvin",
  "°c",
  "degc",
  "deg c",
  "celsius",
  "°f",
  "degf",
  "deg f",
  "fahrenheit",
]);

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

function fromUnit(unit: string): MagXKind {
  const u = normalize(unit);
  if (!u) return "unknown";
  if (FIELD_UNITS.has(u)) return "field";
  if (TEMPERATURE_UNITS.has(u)) return "temperature";
  return "unknown";
}

/** Is `sym` present in `l` as a WHOLE word? `"applied h"` names a field;
 *  `"enthalpy"` does not, and a substring test cannot tell them apart. */
function hasSymbol(l: string, sym: string): boolean {
  return new RegExp(`(^|[^a-z])${sym}([^a-z]|$)`).test(l);
}

/** A LONE symbol — the whole label is one letter — is not evidence of a
 *  quantity, and must not classify on its own.
 *
 *  `io/origin_project/opj.py`'s `_label_for` falls back to the bare Origin
 *  short designation when the worksheet supplied no Long Name, so
 *  `x_column_long` can itself be "B", "H" or "T". Combined with a blank Unit
 *  row that is enough for the whole-word rule below to fire, and an M(T)
 *  curve in Origin column B or H would silently run the hysteresis routine
 *  (or an M(H) loop in column T the M(T) one) — the very defect this module
 *  exists to remove, on its third attempt to come back. A lone letter
 *  therefore yields `unknown` and FAILS CLOSED, the same answer Origin's
 *  "Row" already gets. A recognisable UNIT still decides on its own (it is
 *  consulted first), so "H"/"Oe" and "T"/"K" are unaffected: only a bare
 *  letter with no corroborating unit falls through to the user. */
function isLoneSymbol(l: string): boolean {
  return l.length === 1;
}

function fromLabel(label: string): MagXKind {
  const l = normalize(label).replace(/\s*[([].*$/, ""); // drop a "(Oe)" suffix
  if (!l || isLoneSymbol(l)) return "unknown";
  const temp = l.includes("temp") || l.includes("kelvin") || hasSymbol(l, "t");
  const field =
    l.includes("field") || l.includes("magnetic") || hasSymbol(l, "h") || hasSymbol(l, "b");
  if (temp && field) return "unknown"; // e.g. "T and H" — say nothing, not a guess
  if (temp) return "temperature";
  if (field) return "field";
  return "unknown";
}

/** Classify a magnetometry X axis from its DECLARED label and unit. See the
 *  module header for the precedence rules and for why the data's shape is not
 *  consulted. */
export function detectMagXKind(label: string, unit: string): MagXDetection {
  const byUnit = fromUnit(unit);
  const byLabel = fromLabel(label);

  if (byUnit !== "unknown" && byLabel !== "unknown" && byUnit !== byLabel) {
    return {
      kind: "unknown",
      reason: `x label "${label.trim()}" and unit "${unit.trim()}" disagree`,
    };
  }
  if (byUnit !== "unknown") {
    return {
      kind: byUnit,
      reason: `x unit "${unit.trim()}" is a ${byUnit === "field" ? "magnetic field" : "temperature"}`,
    };
  }
  if (byLabel !== "unknown") {
    return {
      kind: byLabel,
      reason: `x label "${label.trim()}" names a ${byLabel === "field" ? "magnetic field" : "temperature"}`,
    };
  }
  return {
    kind: "unknown",
    reason: label.trim() || unit.trim()
      ? `x axis "${[label.trim(), unit.trim()].filter(Boolean).join(" / ")}" is neither a known field nor a known temperature unit`
      : "the x axis carries no label or unit",
  };
}

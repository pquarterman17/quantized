// The hidden-field rule (lib/presetHiddenFields.ts) for a FLAT settings object,
// written once for the adapters whose form shows different knobs per mode (Map
// operations, Design of experiments, ...). The adapter says which keys its
// current mode SHOWS; the kit derives the rest as hidden. A hidden key is only
// type checked (a wrong KIND of value is still refused, an unknown key still
// is), and a save stores the fallback for a hidden value its strict check
// refuses, so a refused value in a knob the user cannot see never blocks Save.
// Lazy: imported only from workshop preset adapters.

import { parseFields, type FieldCheck } from "./presetAdapter";
import { looseChecks, storeHidden } from "./presetHiddenFields";

const rec = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** A hidden knob is the same kind of value as its default (text, a finite number, a switch). */
const kindOf = (sample: unknown): FieldCheck => (v) => {
  if (typeof sample === "string") return typeof v === "string" && v.length <= 200 ? null : "must be text";
  if (typeof sample === "number") return typeof v === "number" && Number.isFinite(v) ? null : "must be a number";
  if (sample === null) return v === null || (typeof v === "number" && Number.isFinite(v)) ? null : "must be empty or a number";
  if (Array.isArray(sample)) return Array.isArray(v) && v.length <= 200 ? null : "must be a list";
  if (typeof sample === "object" && sample !== null) return typeof v === "object" && v !== null && !Array.isArray(v) ? null : "must be an object";
  if (typeof sample === "boolean") return typeof v === "boolean" ? null : "must be true or false";
  return null;
};

export interface ShownFieldKit<S extends object> {
  /** The strict parser with every hidden key relaxed to its kind. */
  parse(raw: unknown): S | { error: string };
  /** `settings` with each hidden key that fails its strict check replaced from `fallback`. */
  storable(settings: S, fallback: S): S;
  /** The keys the settings' current mode hides. */
  hiddenOf(settings: unknown): (keyof S & string)[];
}

export function shownFieldKit<S extends object>(
  spec: { [K in keyof S & string]: FieldCheck },
  defaults: S,
  shown: (settings: Record<string, unknown>) => readonly string[],
): ShownFieldKit<S> {
  const hiddenOf = (settings: unknown): (keyof S & string)[] => {
    const on = shown(rec(settings));
    return (Object.keys(spec) as (keyof S & string)[]).filter((k) => !on.includes(k));
  };
  return {
    hiddenOf,
    parse(raw) {
      const hidden = hiddenOf(raw);
      const loose = Object.fromEntries(hidden.map((k) => [k, kindOf((defaults as Record<string, unknown>)[k])])) as Partial<{ [K in keyof S & string]: FieldCheck }>;
      return parseFields<S>(raw, looseChecks<S>(spec, hidden, loose));
    },
    storable: (settings, fallback) => storeHidden(settings, spec, hiddenOf(settings), fallback),
  };
}

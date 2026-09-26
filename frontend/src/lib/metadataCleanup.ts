// Metadata cleanup (PRIMARY_SOFTWARE_AUDIT_PLAN P2.5, "metadata cleanup /
// promotion to factors"): unify synonymous keys across datasets and normalize
// their values, as a PLAN that is previewed change by change before anything
// is written. Pure — the commit is lib/metadataRun.ts.
//
//  - UNIFY folds synonyms (`Temp`, `temperature`, `header_fields › T_set`) into
//    one top-level key. Per dataset the first source present (in the rule's
//    order; the target key itself counts first) supplies the value. Two
//    sources that DISAGREE in one dataset are refused for that dataset and
//    reported — the rule never picks a winner. A top-level source is renamed
//    away; a source inside an instrument sidecar dict is copied, never
//    deleted (the sidecar stays as the file had it).
//  - NORMALIZE trims (and collapses inner whitespace), changes case, and
//    parses units: "300 K" becomes 300 with `<key>_unit: "K"`. The unit parse
//    is all-or-nothing per key across the selection and REFUSES when it would
//    have to guess — a value that is not exactly one number and a unit
//    ("300-310 K", "~300 K", "RT"), a comma ("1,5 K": decimal or thousands?),
//    or units that differ between datasets ("300 K" vs "27 C", or "300" beside
//    "300 K"). Refused keys keep their text, and the refusal is shown.
//
// NOTHING IS DESTROYED: every change is appended to the dataset's
// `metadata.metadata_cleanup` log with its before and after value, so a
// renamed key's original name and value, and an original "300 K", stay on
// record (and Ctrl+Z undoes the whole commit).

import { isPresent, isScalar, metaValue, pathLabel, type MetaPath, type MetaScalar } from "./metadataKeys";

export interface UnifyRule {
  to: string;
  from: MetaPath[];
}

export type LetterCase = "keep" | "lower" | "upper";

export interface NormalizeRule {
  key: string;
  trim: boolean;
  letterCase: LetterCase;
  units: boolean;
}

export interface CleanupPlan {
  unify: UnifyRule[];
  normalize: NormalizeRule[];
}

/** One top-level key's change. `after: undefined` = the key is removed. */
export interface MetaChange {
  key: string;
  before: MetaScalar | undefined;
  after: MetaScalar | undefined;
  note: string;
}

export interface DatasetCleanup {
  id: string;
  name: string;
  changes: MetaChange[];
}

export interface CleanupResult {
  datasets: DatasetCleanup[];
  /** What was refused, and why — each one left the values unchanged. */
  refusals: string[];
}

interface Target {
  id: string;
  name: string;
  data: { metadata: Record<string, unknown> };
}

const same = (a: MetaScalar, b: MetaScalar): boolean => String(a).trim() === String(b).trim();

/** One number, optional whitespace, one unit token. */
const QUANTITY = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([A-Za-zµμΩÅ°%][A-Za-z0-9µμΩÅ°%/^·*_-]*)?$/;

export type Quantity = { n: number; unit: string } | { error: string };

/** "300 K" → {300, "K"}; "300" → {300, ""}; a number passes through. */
export function parseQuantity(v: MetaScalar): Quantity {
  if (typeof v === "number") return { n: v, unit: "" };
  if (typeof v !== "string") return { error: "is not a number" };
  const s = v.trim();
  if (s.includes(",")) return { error: "has a comma (decimal or thousands separator?)" };
  const m = QUANTITY.exec(s);
  if (!m) return { error: "is not a single number with a unit" };
  return { n: Number(m[1]), unit: m[2] ?? "" };
}

function normalizeText(v: MetaScalar, rule: NormalizeRule): MetaScalar {
  if (typeof v !== "string") return v;
  let s = rule.trim ? v.trim().replace(/\s+/g, " ") : v;
  if (rule.letterCase === "lower") s = s.toLowerCase();
  else if (rule.letterCase === "upper") s = s.toUpperCase();
  return s;
}

/** Plan `plan` over `targets`: unify rules first, in order, then normalize
 *  rules, each seeing the metadata as the earlier rules left it. */
export function planCleanup(targets: readonly Target[], plan: CleanupPlan): CleanupResult {
  const work = targets.map((t) => ({ ...t.data.metadata }));
  const changes: MetaChange[][] = targets.map(() => []);
  const refusals: string[] = [];
  const set = (i: number, key: string, after: MetaScalar | undefined, note: string) => {
    const before = work[i][key];
    if (before === after) return;
    const prior = changes[i].find((c) => c.key === key);
    if (prior) {
      prior.after = after;
      prior.note += `; ${note}`;
    } else changes[i].push({ key, before: isScalar(before) ? before : undefined, after, note });
    if (after === undefined) delete work[i][key];
    else work[i][key] = after;
  };

  for (const rule of plan.unify) {
    const to = rule.to.trim();
    if (!to) continue;
    const sources = [[to], ...rule.from.filter((p) => !(p.length === 1 && p[0] === to))];
    targets.forEach((t, i) => {
      const found = sources
        .map((p) => ({ p, v: metaValue(work[i], p) }))
        .filter((s): s is { p: MetaPath; v: MetaScalar } => isPresent(s.v));
      if (!found.length) return;
      if (work[i][to] !== undefined && !isScalar(work[i][to])) {
        refusals.push(`${t.name}: “${to}” already holds a collection, not a value — not unified.`);
        return;
      }
      const clash = found.find((s) => !same(s.v, found[0].v));
      if (clash) {
        refusals.push(
          `${t.name}: ${pathLabel(found[0].p)} (${String(found[0].v)}) and ${pathLabel(clash.p)} (${String(clash.v)}) disagree — not unified.`,
        );
        return;
      }
      set(i, to, found[0].v, found[0].p.length === 1 && found[0].p[0] === to ? "kept" : `from ${pathLabel(found[0].p)}`);
      for (const s of found) {
        if (s.p.length === 1 && s.p[0] !== to) set(i, s.p[0], undefined, `renamed to ${to}`);
      }
    });
  }

  for (const rule of plan.normalize) {
    const key = rule.key;
    const unitKey = `${key}_unit`;
    let parsed: (Quantity | null)[] = [];
    if (rule.units) {
      parsed = work.map((m) => {
        if (!isPresent(metaValue(m, [key]))) return null;
        const q = parseQuantity(m[key] as MetaScalar);
        // An already-parsed number keeps the unit its `<key>_unit` records,
        // so a selection mixing cleaned and uncleaned datasets still agrees.
        return "unit" in q && !q.unit && typeof m[unitKey] === "string" ? { n: q.n, unit: m[unitKey] as string } : q;
      });
      const badAt = parsed.findIndex((q) => q !== null && "error" in q);
      const units = [...new Set(parsed.flatMap((q) => (q && "unit" in q ? [q.unit] : [])))];
      const clashAt = work.findIndex((m, i) => {
        const q = parsed[i];
        return q && "unit" in q && typeof m[unitKey] === "string" && m[unitKey] !== q.unit;
      });
      let why = "";
      if (badAt >= 0) why = `“${String(work[badAt][key])}” in ${targets[badAt].name} ${(parsed[badAt] as { error: string }).error}`;
      else if (units.length > 1) why = `the units differ (${units.map((u) => u || "none").join(", ")})`;
      else if (clashAt >= 0) why = `${targets[clashAt].name} already has ${unitKey} = “${String(work[clashAt][unitKey])}”`;
      if (why) {
        refusals.push(`${key}: ${why} — units not parsed.`);
        parsed = [];
      }
    }
    work.forEach((m, i) => {
      const v = metaValue(m, [key]);
      if (v === undefined) return;
      const q = parsed[i];
      if (q && "unit" in q) {
        set(i, key, q.n, q.unit ? `parsed number (unit ${q.unit})` : "parsed number");
        if (q.unit) set(i, unitKey, q.unit, `unit parsed from ${key}`);
        return;
      }
      set(i, key, normalizeText(v, rule), "normalized");
    });
  }

  return {
    datasets: targets.map((t, i) => ({ id: t.id, name: t.name, changes: changes[i] })).filter((d) => d.changes.length),
    refusals,
  };
}

/** `meta` with `changes` applied, each recorded (with its before value) in the
 *  `metadata_cleanup` provenance log. Applied to `data` and `raw` alike. */
export function applyCleanup(meta: Record<string, unknown>, changes: readonly MetaChange[], at: string): Record<string, unknown> {
  const out: Record<string, unknown> = { ...meta };
  for (const c of changes) {
    if (c.after === undefined) delete out[c.key];
    else out[c.key] = c.after;
  }
  const log = Array.isArray(meta.metadata_cleanup) ? meta.metadata_cleanup : [];
  out.metadata_cleanup = [
    ...log,
    ...changes.map((c) => ({ key: c.key, before: c.before ?? null, after: c.after ?? null, note: c.note, at })),
  ];
  return out;
}

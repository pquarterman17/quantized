// Quick Plot template persistence, scopes, and matching (plan PR H, L0.14/
// L0.31/L0.37, "Template-matching contract" ~line 405). Builds directly on
// the merged G-series Quick Figure Builder: a template is a NAMED, SAVED
// `QuickFigureMapping` + `QuickPlotStyle`, captured once explicitly (never
// auto-saved -- L0.31), that a later dataset can try to REAPPLY.
//
// Two concerns live here, both pure (no store/get/set -- store/
// quickPlotTemplates.ts owns the CRUD + apply-delegation):
//
//  1. H1 -- the template OBJECT shape + its `.dwk` sanitizer
//     (`sanitizeQuickPlotTemplates`), following `lib/plotspec.ts`'s
//     `sanitizeSavedPlotSpecs` "drop-malformed-never-throw" shape.
//  2. H4 -- `resolveTemplate`, the matching algorithm: technique equality,
//     scope gating, and a per-channel RE-KEY BY LABEL exactly like
//     `lib/techniqueViewMemory.ts`'s `applyTechniqueMemory` -- except where
//     that function tolerates a PARTIAL resolution (drop what doesn't
//     resolve, keep going), this one is refusal-or-nothing: ANY unresolved
//     mapped column -- X, any Y, any error binding endpoint -- refuses the
//     WHOLE apply, naming every unresolved field. A silently partial figure
//     (three of four Y series, the fourth quietly dropped) is a worse
//     failure mode than an honest "Configure Quick Plot..." refusal (the
//     Template-matching contract's "never falls through to a generic
//     automatic plot").
//
// SIGNATURE SCOPE (deliberately bounded -- distinct from PR F's
// `quickPlotProfile` bounded allowlist, which this system is NOT): captured
// at save time as the FULL column list's normalized labels + per-channel
// error-role classification (`lib/errorRoles.ts`'s `inferErrorBindings`,
// the same inference the builder itself seeds from) + units, in column
// order -- the "recognized data type and schema" fingerprint the plan's
// Template-matching contract names. `resolveTemplate` below uses it for
// exactly one additional check beyond the per-channel label re-key: a
// resolved channel whose SAVED unit was non-empty and no longer matches the
// current dataset's unit at that position is treated as unresolved too (the
// "same label, different quantity" trap -- a column named "B" in Oe at save
// time and "B" in Tesla later must not silently reapply). A full structural
// diff of the ENTIRE schema (column count, grouping) is deliberately out of
// bounds for v1 matching -- the plan's later P1.3 recipe work owns richer
// schema reasoning; see H6's plan-doc note.

import { inferErrorBindings, type ErrorBinding, type ErrorSide } from "./errorRoles";
import type { QuickFigureMapping } from "./quickFigureMapping";
import type { QuickPlotStyle } from "./quickFigurePreview";
import { isValidTechnique, techniqueOf } from "./techniqueDefaults";
import type { Dataset, Technique } from "./types";

// ── H1: the template object ─────────────────────────────────────────────

/** "This workbook only" (a one-off mapping) or "this data type and schema"
 *  (the confirmed L0.31 default -- the normal reusable scope). A future
 *  named/global/exportable scope is explicitly out of bounds for v1 (H6). */
export type QuickPlotTemplateScope = { kind: "workbook"; workbookId: string } | { kind: "schema" };

/** One channel's captured schema fingerprint, in column order at save time.
 *  `label` is NORMALIZED (trim + lowercase + collapsed whitespace, the same
 *  fold `lib/errorRoles.ts`'s internal `norm` applies) -- this is a coarse
 *  "same shape of file" signal, distinct from the EXACT-string `labels`
 *  re-key snapshot on `QuickPlotTemplate` itself. `errorRole` is the
 *  `inferErrorBindings` classification for this channel at save time:
 *  `"value"` for anything not inferred as an uncertainty column. */
export type SignatureErrorRole = "value" | "error-x" | "error-x+" | "error-x-" | "error-y" | "error-y+" | "error-y-";

export interface SignatureChannel {
  label: string;
  unit: string;
  errorRole: SignatureErrorRole;
}

export interface QuickPlotTemplateSignature {
  channels: SignatureChannel[];
}

export interface QuickPlotTemplate {
  id: string;
  name: string;
  createdAt: string;
  modifiedAt: string;
  scope: QuickPlotTemplateScope;
  /** `dataset.data.metadata.technique` at save time (`techniqueOf`). Match
   *  requires EQUALITY, never cross-technique -- see `resolveTemplate`. */
  technique: Technique;
  signature: QuickPlotTemplateSignature;
  /** The saved mapping, index-based, VERBATIM -- re-keyed against a live
   *  dataset only at apply time (`resolveTemplate`), never mutated here. */
  mapping: QuickFigureMapping;
  style: QuickPlotStyle;
  /** The techniqueViewMemory idiom: every channel the mapping REFERENCES
   *  (xKey, each yKey, each error binding's channel + real target), keyed by
   *  its own index, to the column LABEL it had at save time. `resolveTemplate`
   *  re-keys by this, never by replaying the raw index. A channel with no
   *  non-empty label at save time is simply absent (mirrors
   *  `techniqueViewMemory`'s identical omission). */
  labels: Record<number, string>;
}

// Exported (P1.3 code-review cleanup 5): `lib/plotRecipe.ts`/
// `lib/plotRecipeMatch.ts` import these two directly rather than keeping a
// byte-duplicated private copy, so the label-fold and error-role
// classification rules never drift onto two definitions.
export function normalizeLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

export function errorRoleFor(bindings: readonly ErrorBinding[], channel: number): SignatureErrorRole {
  const binding = bindings.find((b) => b.channel === channel);
  if (!binding) return "value";
  const suffix: Record<ErrorSide, string> = { both: "", "+": "+", "-": "-" };
  return `error-${binding.axis}${suffix[binding.side]}` as SignatureErrorRole;
}

/** Build the full-schema fingerprint from a live dataset, in column order. */
export function buildQuickPlotTemplateSignature(dataset: Dataset): QuickPlotTemplateSignature {
  const bindings = dataset.errorRoles ?? inferErrorBindings(dataset.data);
  const { labels, units } = dataset.data;
  return {
    channels: labels.map((label, ch) => ({
      label: normalizeLabel(label),
      unit: units[ch] ?? "",
      errorRole: errorRoleFor(bindings, ch),
    })),
  };
}

/** Every channel index `mapping` references -- shared by the save-time label
 *  snapshot and nothing else (mirrors `techniqueViewMemory.ts`'s identical
 *  `referencedChannels` helper for `LiveViewSource`). Only REAL channel
 *  targets are included -- an X-error binding's `target: -1` is the axis
 *  sentinel, not a channel, and is never a re-key candidate. */
function referencedChannels(mapping: QuickFigureMapping): number[] {
  const out: number[] = [];
  if (mapping.xKey !== null) out.push(mapping.xKey);
  out.push(...mapping.yKeys);
  for (const b of mapping.errorBindings) {
    out.push(b.channel);
    if (b.target >= 0) out.push(b.target);
  }
  return out;
}

/** Snapshot every channel `mapping` references, keyed to the column label it
 *  had in `dataset` at save time -- the H1 `labels` field. */
export function captureQuickPlotTemplateLabels(
  dataset: Dataset,
  mapping: QuickFigureMapping,
): Record<number, string> {
  const dsLabels = dataset.data.labels;
  const labels: Record<number, string> = {};
  for (const ch of referencedChannels(mapping)) {
    const lbl = dsLabels[ch];
    if (typeof lbl === "string" && lbl.length > 0) labels[ch] = lbl;
  }
  return labels;
}

// ── H4: matching ────────────────────────────────────────────────────────

export type QuickPlotTemplateResolution =
  | { ok: true; mapping: QuickFigureMapping }
  | { ok: false; unmatched: string[]; reason: string };

/** Human name for an unmatched field in the refusal report -- "X axis", "Y
 *  series 'B'" (the label it WAS at save time -- the only name left once the
 *  column itself can no longer be found), or the error-binding's role. */
function fieldName(role: string, savedLabel: string | undefined): string {
  return savedLabel ? `${role} ("${savedLabel}")` : role;
}

/** Resolve one saved channel index against `currentLabels`, using the
 *  template's `labels` snapshot -- same three-way fast-path/moved/gone
 *  resolution as `techniqueViewMemory.ts`'s `applyTechniqueMemory`:
 *  unchanged position wins outright (duplicate-label safe), else search by
 *  label, else gone. UNLIKE that function, a channel with NO captured label
 *  (the `techniqueViewMemory` "never captured -> by-index passthrough"
 *  case) is treated as gone here rather than silently trusting the raw
 *  index -- a template can be applied to an entirely different dataset than
 *  the one it was captured from, where the old index may now name an
 *  unrelated column; only an EXPLICIT label match is trustworthy evidence
 *  of "the same column". */
function resolveChannel(
  template: QuickPlotTemplate,
  currentLabels: readonly string[],
  currentUnits: readonly string[],
  channel: number,
): number | null {
  const label = template.labels[channel];
  if (label === undefined) return null;
  const tryUnit = (idx: number): number | null => {
    const savedUnit = template.signature.channels[channel]?.unit ?? "";
    if (!savedUnit) return idx; // nothing to check
    return currentUnits[idx] === savedUnit ? idx : null;
  };
  if (currentLabels[channel] === label) {
    const ok = tryUnit(channel);
    if (ok !== null) return ok;
  }
  const idx = currentLabels.indexOf(label);
  if (idx < 0) return null;
  return tryUnit(idx);
}

/** Scope gate alone (H4's "Scope gating: workbook-scoped templates match
 *  only datasets in that workbook") -- split out so the chooser (H5b) can
 *  filter its listing without paying for a full re-key resolve per row. */
export function quickPlotTemplateInScope(template: QuickPlotTemplate, dataset: Dataset): boolean {
  return template.scope.kind === "schema" || template.scope.workbookId === dataset.workbookId;
}

/** Review-round fix (the orphan bug): drop workbook-scoped templates whose
 *  `workbookId` no longer names a LIVE workbook -- the E2
 *  `librarySelection`/`parseWorkbookLastChild` load-time aliveness pattern,
 *  called ONLY from `lib/workspace.ts`'s `parseWorkspace` once `workbookIds`
 *  is known. This is DANGLING (the workbook itself is gone), never
 *  MEMBERLESS (the workbook is alive but has zero worksheets right now) --
 *  a memberless-but-alive workbook's templates are deliberately NOT pruned
 *  here; they stay reachable via the manage surface (see
 *  `workbookContextActions.ts`'s `workbook.quickPlotWith` gate and
 *  `QuickPlotWithDialog`'s workbook-only mode). Schema-scoped templates
 *  never dangle this way (no workbook to lose) and pass through untouched.
 *  Pruning on an actual workbook DELETE (as opposed to a load-time replay of
 *  an already-dangling `.dwk`) is PR M's job -- see that item's plan entry. */
export function pruneDanglingWorkbookScopeTemplates(
  templates: readonly QuickPlotTemplate[],
  workbookIds: ReadonlySet<string>,
): QuickPlotTemplate[] {
  return templates.filter((t) => t.scope.kind !== "workbook" || workbookIds.has(t.scope.workbookId));
}

/** THE matching predicate (H4). Pure -- never mutates `template` or
 *  `dataset`. Refusal is all-or-nothing: any unresolved mapped column
 *  refuses the WHOLE apply (never a partial mapping), naming every
 *  unresolved field so the chooser (H5b) can show an honest reason. */
export function resolveTemplate(template: QuickPlotTemplate, dataset: Dataset): QuickPlotTemplateResolution {
  if (techniqueOf(dataset) !== template.technique) {
    return { ok: false, unmatched: [], reason: `saved for ${template.technique}, not ${techniqueOf(dataset)}` };
  }
  if (!quickPlotTemplateInScope(template, dataset)) {
    return { ok: false, unmatched: [], reason: "this template is scoped to a different workbook" };
  }

  const currentLabels = dataset.data.labels;
  const currentUnits = dataset.data.units;
  // P1-4 (Sol's Day-6 audit): label+unit match alone is not enough evidence
  // that a resolved column is still the SAME kind of column -- a value
  // column can end up with the exact label+unit an error channel had at
  // save time (a rename, a different file with the same header). Compare
  // the saved errorRole against the target's CURRENT classification (the
  // same source `captureQuickPlotTemplateLabels`/the builder itself uses:
  // an explicit per-dataset override if set, else the label-based
  // inference) and refuse a mismatch. Deliberately refuses the WHOLE
  // template rather than just dropping the mismatched error binding -- a
  // template that half-applies (silently drops the error bars the user
  // asked for) is worse than one that says exactly why it can't apply.
  const currentBindings = dataset.errorRoles ?? inferErrorBindings(dataset.data);
  const unmatched: string[] = [];
  const resolve = (ch: number, role: string): number | null => {
    const resolved = resolveChannel(template, currentLabels, currentUnits, ch);
    if (resolved === null) {
      unmatched.push(fieldName(role, template.labels[ch]));
      return null;
    }
    const savedRole = template.signature.channels[ch]?.errorRole ?? "value";
    const currentRole = errorRoleFor(currentBindings, resolved);
    if (savedRole !== currentRole) {
      const name = fieldName(role, template.labels[ch]);
      unmatched.push(`${name}: saved as "${savedRole}", now classified as "${currentRole}"`);
      return null;
    }
    return resolved;
  };

  const xKey = template.mapping.xKey !== null ? resolve(template.mapping.xKey, "X axis") : null;
  const yKeys: number[] = [];
  template.mapping.yKeys.forEach((ch, i) => {
    const r = resolve(ch, `Y series ${i + 1}`);
    if (r !== null) yKeys.push(r);
    // r === null already pushed its own unmatched entry above -- this loop
    // just also needs the (possibly-empty) resolved value collected.
  });
  const errorBindings: ErrorBinding[] = [];
  template.mapping.errorBindings.forEach((b) => {
    const role = `${b.axis.toUpperCase()} error${b.side === "both" ? "" : ` (${b.side})`}`;
    const channel = resolve(b.channel, role);
    const target = b.target >= 0 ? resolve(b.target, `${role} target`) : b.target; // -1 sentinel passes through
    if (channel !== null && target !== null) errorBindings.push({ channel, target, axis: b.axis, side: b.side });
  });

  if (unmatched.length > 0) {
    return { ok: false, unmatched, reason: `${unmatched.length} column${unmatched.length === 1 ? "" : "s"} no longer match: ${unmatched.join(", ")}` };
  }

  return {
    ok: true,
    mapping: {
      xKey,
      yKeys,
      errorBindings,
      // Ignored columns are not part of the mapping's plotted/paired
      // surface -- re-resolving them isn't load-bearing (they contribute
      // nothing to the created figure either way), so a stale/gone ignored
      // index is simply dropped rather than blocking the whole apply.
      ignoredKeys: template.mapping.ignoredKeys
        .map((ch) => resolveChannel(template, currentLabels, currentUnits, ch))
        .filter((ch): ch is number => ch !== null),
    },
  };
}

// ── `.dwk` sanitizer ─────────────────────────────────────────────────────

function isErrorSide(v: unknown): v is ErrorSide {
  return v === "both" || v === "+" || v === "-";
}

function sanitizeErrorBindings(v: unknown): ErrorBinding[] {
  if (!Array.isArray(v)) return [];
  const out: ErrorBinding[] = [];
  for (const e of v) {
    if (typeof e !== "object" || e === null) continue;
    const o = e as Record<string, unknown>;
    if (typeof o.channel !== "number" || typeof o.target !== "number") continue;
    if (o.axis !== "x" && o.axis !== "y") continue;
    if (!isErrorSide(o.side)) continue;
    out.push({ channel: o.channel, target: o.target, axis: o.axis, side: o.side });
  }
  return out;
}

function sanitizeMapping(v: unknown): QuickFigureMapping | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const xKey = typeof o.xKey === "number" ? o.xKey : o.xKey === null ? null : undefined;
  if (xKey === undefined) return null;
  if (!Array.isArray(o.yKeys) || !o.yKeys.every((x) => typeof x === "number")) return null;
  if (!Array.isArray(o.ignoredKeys) || !o.ignoredKeys.every((x) => typeof x === "number")) return null;
  return {
    xKey,
    yKeys: o.yKeys as number[],
    errorBindings: sanitizeErrorBindings(o.errorBindings),
    ignoredKeys: o.ignoredKeys as number[],
  };
}

function isSignatureErrorRole(v: unknown): v is SignatureErrorRole {
  return v === "value" || v === "error-x" || v === "error-x+" || v === "error-x-" ||
    v === "error-y" || v === "error-y+" || v === "error-y-";
}

function sanitizeSignature(v: unknown): QuickPlotTemplateSignature | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.channels)) return null;
  const channels: SignatureChannel[] = [];
  for (const c of o.channels) {
    if (typeof c !== "object" || c === null) return null;
    const co = c as Record<string, unknown>;
    if (typeof co.label !== "string" || typeof co.unit !== "string" || !isSignatureErrorRole(co.errorRole)) {
      return null;
    }
    channels.push({ label: co.label, unit: co.unit, errorRole: co.errorRole });
  }
  return { channels };
}

function sanitizeScope(v: unknown): QuickPlotTemplateScope | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (o.kind === "schema") return { kind: "schema" };
  if (o.kind === "workbook" && typeof o.workbookId === "string") return { kind: "workbook", workbookId: o.workbookId };
  return null;
}

function sanitizeStyle(v: unknown): QuickPlotStyle {
  return v === "scatter" || v === "line-symbol" ? v : "line";
}

function sanitizeLabelsMap(v: unknown): Record<number, string> {
  if (typeof v !== "object" || v === null) return {};
  const out: Record<number, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "string") out[Number(k)] = val;
  }
  return out;
}

/** Validate persisted `.dwk` `quickPlotTemplates` entries -- drop-malformed-
 *  never-throw, following `lib/plotspec.ts`'s `sanitizeSavedPlotSpecs`
 *  shape: each entry is validated independently (a hand-edited or
 *  future-schema entry degrades to "dropped", not a load failure), and the
 *  NESTED mapping is validated per-entry too (H1's "validating the nested
 *  mapping per-entry"). */
export function sanitizeQuickPlotTemplates(v: unknown): QuickPlotTemplate[] {
  if (!Array.isArray(v)) return [];
  const out: QuickPlotTemplate[] = [];
  for (const e of v) {
    if (typeof e !== "object" || e === null) continue;
    const o = e as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.name !== "string") continue;
    if (typeof o.createdAt !== "string" || typeof o.modifiedAt !== "string") continue;
    if (typeof o.technique !== "string" || !isValidTechnique(o.technique)) continue;
    const scope = sanitizeScope(o.scope);
    const signature = sanitizeSignature(o.signature);
    const mapping = sanitizeMapping(o.mapping);
    if (!scope || !signature || !mapping) continue;
    out.push({
      id: o.id,
      name: o.name,
      createdAt: o.createdAt,
      modifiedAt: o.modifiedAt,
      scope,
      technique: o.technique,
      signature,
      mapping,
      style: sanitizeStyle(o.style),
      labels: sanitizeLabelsMap(o.labels),
    });
  }
  return out;
}

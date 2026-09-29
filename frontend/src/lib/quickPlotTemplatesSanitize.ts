// The `.dwk` sanitizer for Quick Plot templates, moved verbatim out of
// lib/quickPlotTemplates.ts (bundle diet slice 12, plans/BUNDLE_HEADROOM.md).
// Its only caller is the lazy `.dwk` codec (lib/workspace.ts), so it no
// longer rides in the entry chunk with the template resolver the store needs
// at startup. Drop-malformed-never-throw, exactly as before.

import type { ErrorBinding, ErrorSide } from "./errorRoles";
import { sanitizePlotView, type PlotView } from "./plotview";
import type { QuickFigureLook } from "./quickFigureCommit";
import type { QuickFigureMapping } from "./quickFigureMapping";
import type { QuickPlotStyle } from "./quickFigurePreview";
import type {
  QuickPlotTemplate,
  QuickPlotTemplateScope,
  QuickPlotTemplateSignature,
  SignatureChannel,
  SignatureErrorRole,
} from "./quickPlotTemplates";
import { isValidTechnique } from "./techniqueDefaults";
import type { SeriesStyle } from "./types";

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

const isChannel = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

/** Optional per-Y X overrides (absent on templates saved before multi-X
 *  support -> null, "none"). A malformed map returns undefined and the WHOLE
 *  mapping is dropped: degrading it to "no overrides" would silently plot
 *  every series against the shared X -- confidently wrong, unlike a dropped
 *  optional group/label role, which merely goes missing. */
function sanitizeSeriesX(v: unknown): Record<number, number | null> | null | undefined {
  if (v === undefined) return null;
  if (typeof v !== "object" || v === null || Array.isArray(v)) return undefined;
  const out: Record<number, number | null> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    const y = Number(k);
    if (!isChannel(y) || (x !== null && !isChannel(x))) return undefined;
    out[y] = x;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function sanitizeMapping(v: unknown): QuickFigureMapping | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const xKey = typeof o.xKey === "number" ? o.xKey : o.xKey === null ? null : undefined;
  if (xKey === undefined) return null;
  if (!Array.isArray(o.yKeys) || !o.yKeys.every((x) => typeof x === "number")) return null;
  if (!Array.isArray(o.ignoredKeys) || !o.ignoredKeys.every((x) => typeof x === "number")) return null;
  const xKeyByY = sanitizeSeriesX(o.xKeyByY);
  if (xKeyByY === undefined) return null;
  return {
    xKey,
    ...(xKeyByY ? { xKeyByY } : {}),
    yKeys: o.yKeys as number[],
    errorBindings: sanitizeErrorBindings(o.errorBindings),
    ignoredKeys: o.ignoredKeys as number[],
    // Optional roles (absent on pre-role templates): kept only when a valid
    // channel index, so a malformed value degrades to "unassigned".
    ...(Number.isInteger(o.groupKey) && (o.groupKey as number) >= 0 ? { groupKey: o.groupKey as number } : {}),
    ...(Number.isInteger(o.labelKey) && (o.labelKey as number) >= 0 ? { labelKey: o.labelKey as number } : {}),
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

/** The look's view fields go through `sanitizePlotView`'s own per-field rules;
 *  its series styles are kept as objects, the trust `sanitizePlotView` gives
 *  `seriesStyles`. Absent/malformed -> undefined, the pre-setup shape. */
function sanitizeLook(v: unknown): QuickFigureLook | undefined {
  if (!(v instanceof Object)) return undefined;
  const o = v as Record<string, unknown>;
  const view = sanitizePlotView(o);
  const keys = ["xScale", "yScale", "showGrid", "showLegend", "legendPos"] as const;
  return {
    ...(Object.fromEntries(keys.map((k) => [k, view[k]])) as Pick<PlotView, (typeof keys)[number]>),
    series: Array.isArray(o.series) ? o.series.filter((s): s is SeriesStyle => s instanceof Object) : [],
    errorBars: o.errorBars !== false,
  };
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
      look: sanitizeLook(o.look),
      labels: sanitizeLabelsMap(o.labels),
    });
  }
  return out;
}

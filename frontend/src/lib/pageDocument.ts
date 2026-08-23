// Persisted multi-panel Figure Page document (FIGURE_AUTHORING_WORKFLOW_PLAN
// F3.1). lib/figurepage.ts models one EPHEMERAL editing session — grid slots
// holding open-window or legacy-FigureDoc sources, discarded on close (the
// audited defect: "Figure Page cannot be saved/reopened as an editable
// document"). This module models the PERSISTABLE artifact instead: a
// versioned document whose panels reference canonical FigureDocument ids
// (lib/figureDocument.ts's `editableFigures` collection) BY ID ONLY — never a
// flattened copy of the figure's config (F3.2: "Do not flatten panels into
// lossy reduced configs"). A panel's live/frozen behavior is inherited
// entirely from whatever FigureDocument it references (F1 already solved
// "detached panels" at that layer); the page never carries its own snapshot.
// Pure: no store imports.
//
// SCOPE (narrowed 2026-08-23, C2 bundle pass): this file keeps ONLY the
// schema types/constants + the `sanitizePageDocument`/`sanitizePageDocuments`
// validators `lib/workspace.ts`'s synchronous `parseWorkspace` needs at load
// time — that eager reachability is exactly why it must stay small. Every
// editing/session action (construction, panel resolution, dirty-tracking,
// the delete-guard's referencing-pages query, and the ad hoc JSON
// serialize/deserialize pair) now lives in `lib/pageDocumentActions.ts`,
// which the Figure Page workshop panel and Library's editableFigures
// delete-guard import instead — both reached only behind a `lazy()`/
// `lazyPanel()` boundary, never the eager parse path. See that file's own
// header for the verified-no-eager-consumer rationale. `DEFAULT_OUTPUT`/
// `DEFAULT_LAYOUT` are exported (previously module-private) solely so
// `pageDocumentActions.ts`'s `createPageDocument` can reuse the SAME
// defaults `sanitizeOutput`/`sanitizeLayout` fall back to, rather than a
// second, driftable copy.

import {
  PAGE_LABEL_FORMATS,
  PAGE_LABEL_POSITIONS,
  PAGE_MAX_GRID,
  type PageLabelFormat,
  type PageLabelPosition,
} from "./figurepage";

export const PAGE_DOCUMENT_SCHEMA = "quantized.page" as const;
// F3.5: v1 -> v2 for `layout` (gap/link/align/resize-mode) -- unlike F3.3's
// purely informational createdAt/modifiedAt (additive, no version bump
// needed), `layout` changes RENDER SEMANTICS (link/unlink literally changes
// what the exported page looks like), so it follows FigureDocument's own
// v1->v2 precedent (F2.1a, lib/figureDocument.ts): a version bump means an
// OLDER build that doesn't understand `layout` REJECTS a newer document
// (sanitizePageDocuments already skips unknown future versions) instead of
// silently loading it and dropping the user's link/gap settings with no
// warning. v1 documents still migrate forward (see sanitizePageDocument) —
// only versions beyond PAGE_DOCUMENT_VERSION are rejected.
export const PAGE_DOCUMENT_VERSION = 2 as const;

export const PAGE_RESIZE_MODES = ["constrained", "tight", "none"] as const;
export type PageResizeMode = (typeof PAGE_RESIZE_MODES)[number];

/** F3.5 "complete layout controls". Mirrors calc.figure_page_layout's
 *  vocabulary exactly (see its module doc for the full rationale) so the
 *  frontend/backend contract needs no translation layer.
 *
 *  `rowGap`/`colGap`: matplotlib gridspec wspace/hspace fractions; `null`
 *  ("auto", the default) omits the override entirely so the chosen
 *  `resizeMode` engine picks its own spacing -- today's exact rendering.
 *
 *  `linkX`/`linkY`: share every panel's x/y-axis limits page-wide ("link
 *  all" -- the acceptance journey's (A6) sufficient core, not arbitrary
 *  per-row/per-column link groups; see the plan's decision log).
 *
 *  `alignLabels`: matplotlib `fig.align_labels()` -- axis labels line up
 *  across panels despite differing tick-label widths.
 *
 *  `resizeMode`: the automatic layout engine. "constrained" (default,
 *  RECOMMENDED for an ordinary grid page -- auto-avoids overlapping
 *  titles/labels while still respecting an explicit gap); "tight"
 *  (recommended when minimizing whitespace matters more than an exact gap
 *  -- trims the bounding box post-layout; an explicit gap is NOT honored
 *  in this mode, a named tradeoff); "none" (fixed manual spacing only, no
 *  automatic adjustment -- what free page-coordinate placement has always
 *  used implicitly). */
export interface PageLayoutSettings {
  rowGap: number | null;
  colGap: number | null;
  linkX: boolean;
  linkY: boolean;
  alignLabels: boolean;
  resizeMode: PageResizeMode;
}

export const DEFAULT_LAYOUT: PageLayoutSettings = {
  rowGap: null,
  colGap: null,
  linkX: false,
  linkY: false,
  alignLabels: false,
  resizeMode: "constrained",
};

/** One grid slot. `figureId === null` = empty. A non-null id references an
 *  `editableFigures` entry BY ID (F3.2) — resolve with `resolvePagePanel`,
 *  which never treats a missing id as empty and never drops it silently.
 *  `label`/`title` mirror lib/figurepage.ts's `PageSlot` semantics exactly:
 *  `label === null` = auto "(a)", "(b)", … in placement order; `""`
 *  suppresses the label on this panel only. `title === null` keeps the
 *  referenced figure's own name. */
export interface PagePanel {
  figureId: string | null;
  label: string | null;
  title: string | null;
}

export interface PageOutputSettings {
  format: string;
  stylePreset: string;
  dpi: number;
  labelFormat: PageLabelFormat;
  labelPos: PageLabelPosition;
}

/** A versioned, persisted multi-panel page (F3.1). Row-major slot addressing
 *  mirrors lib/figurepage.ts (index i -> row floor(i/cols), col i%cols); grid
 *  placement only today — free placement is unimplemented anywhere in the
 *  product yet, so it is not modeled here either (documented gap, not a
 *  silent omission). */
export interface PageDocument {
  schema: typeof PAGE_DOCUMENT_SCHEMA;
  version: typeof PAGE_DOCUMENT_VERSION;
  id: string;
  name: string;
  rows: number;
  cols: number;
  panels: PagePanel[];
  output: PageOutputSettings;
  /** F3.5 "complete layout controls" — see PageLayoutSettings' own doc. */
  layout: PageLayoutSettings;
  /** F3.3 "recent access" — ISO timestamps. Purely informational (no render
   *  impact), so this is an ADDITIVE field, not a schema version bump (same
   *  convention as WorkspaceState's optional fields, and unlike
   *  FigureDocument's v1->v2 `publication`, which changes render semantics
   *  and so needed one). `modifiedAt` is bumped by the store's save actions
   *  (store/pageDocuments.ts), never by this pure module — mirrors
   *  lib/plotspec.ts's SavedPlotSpec, whose store slice stamps the timestamp
   *  at the actual save site. */
  createdAt: string;
  modifiedAt: string;
}

export const DEFAULT_OUTPUT: PageOutputSettings = {
  format: "pdf",
  stylePreset: "default",
  dpi: 300,
  labelFormat: "(a)",
  labelPos: "nw",
};

export function emptyPagePanels(rows: number, cols: number): PagePanel[] {
  return Array.from({ length: rows * cols }, () => ({ figureId: null, label: null, title: null }));
}

// ── validation / persistence boundary ───────────────────────────────────────

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizePagePanel(value: unknown): PagePanel {
  if (!isObject(value)) return { figureId: null, label: null, title: null };
  const figureId = typeof value.figureId === "string" && value.figureId ? value.figureId : null;
  const label = typeof value.label === "string" ? value.label : null;
  const title = typeof value.title === "string" ? value.title : null;
  return { figureId, label, title };
}

function sanitizeOutput(value: unknown): PageOutputSettings {
  const o = isObject(value) ? value : {};
  const dpi = typeof o.dpi === "number" && Number.isFinite(o.dpi) && o.dpi > 0 ? o.dpi : DEFAULT_OUTPUT.dpi;
  const labelFormat =
    typeof o.labelFormat === "string" && (PAGE_LABEL_FORMATS as readonly string[]).includes(o.labelFormat)
      ? (o.labelFormat as PageLabelFormat)
      : DEFAULT_OUTPUT.labelFormat;
  const labelPos =
    typeof o.labelPos === "string" && (PAGE_LABEL_POSITIONS as readonly string[]).includes(o.labelPos)
      ? (o.labelPos as PageLabelPosition)
      : DEFAULT_OUTPUT.labelPos;
  return {
    format: typeof o.format === "string" ? o.format : DEFAULT_OUTPUT.format,
    stylePreset: typeof o.stylePreset === "string" ? o.stylePreset : DEFAULT_OUTPUT.stylePreset,
    dpi,
    labelFormat,
    labelPos,
  };
}

function sanitizeLayout(value: unknown): PageLayoutSettings {
  const o = isObject(value) ? value : {};
  const gap = (raw: unknown, fallback: number | null): number | null =>
    raw === null ? null : typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : fallback;
  const resizeMode =
    typeof o.resizeMode === "string" && (PAGE_RESIZE_MODES as readonly string[]).includes(o.resizeMode)
      ? (o.resizeMode as PageResizeMode)
      : DEFAULT_LAYOUT.resizeMode;
  return {
    rowGap: gap(o.rowGap, DEFAULT_LAYOUT.rowGap),
    colGap: gap(o.colGap, DEFAULT_LAYOUT.colGap),
    linkX: typeof o.linkX === "boolean" ? o.linkX : DEFAULT_LAYOUT.linkX,
    linkY: typeof o.linkY === "boolean" ? o.linkY : DEFAULT_LAYOUT.linkY,
    alignLabels: typeof o.alignLabels === "boolean" ? o.alignLabels : DEFAULT_LAYOUT.alignLabels,
    resizeMode,
  };
}

/** Validate an untrusted persisted document. A bad envelope/identity rejects
 *  the whole document (returns null); malformed nested fields degrade to
 *  safe defaults instead — same discipline as figureDocument.ts's sanitizer.
 *  Accepts v1 (pre-F3.5, migrates to DEFAULT_LAYOUT — today's exact
 *  rendering) or the current version; a genuinely future version is
 *  rejected outright, same forward-compat discipline as figureDocument.ts. */
export function sanitizePageDocument(value: unknown): PageDocument | null {
  if (
    !isObject(value) ||
    value.schema !== PAGE_DOCUMENT_SCHEMA ||
    (value.version !== 1 && value.version !== PAGE_DOCUMENT_VERSION)
  ) return null;
  if (typeof value.id !== "string" || !value.id || typeof value.name !== "string") return null;
  const rows =
    Number.isInteger(value.rows) && (value.rows as number) >= 1 && (value.rows as number) <= PAGE_MAX_GRID
      ? (value.rows as number)
      : 1;
  const cols =
    Number.isInteger(value.cols) && (value.cols as number) >= 1 && (value.cols as number) <= PAGE_MAX_GRID
      ? (value.cols as number)
      : 1;
  const rawPanels = Array.isArray(value.panels) ? value.panels : [];
  const base = emptyPagePanels(rows, cols);
  const panels = base.map((slot, i) => (i < rawPanels.length ? sanitizePagePanel(rawPanels[i]) : slot));
  // F3.3 addition: absent on a pre-F3.3 document (none has ever actually been
  // written to `store.pages` yet — F3.1/F3.2 shipped the schema before any
  // writer existed) -- default to the epoch rather than "now" so a genuinely
  // undated legacy document sorts LAST in a recency list, not first.
  const epoch = new Date(0).toISOString();
  const createdAt = typeof value.createdAt === "string" ? value.createdAt : epoch;
  const modifiedAt = typeof value.modifiedAt === "string" ? value.modifiedAt : createdAt;
  // v1 never had `layout` -- migrate to DEFAULT_LAYOUT (today's exact
  // rendering) rather than reading a field that version never wrote.
  const layout =
    value.version === PAGE_DOCUMENT_VERSION ? sanitizeLayout(value.layout) : DEFAULT_LAYOUT;
  return {
    schema: PAGE_DOCUMENT_SCHEMA,
    version: PAGE_DOCUMENT_VERSION,
    id: value.id,
    name: value.name,
    rows,
    cols,
    panels,
    output: sanitizeOutput(value.output),
    layout,
    createdAt,
    modifiedAt,
  };
}

/** Future-version documents are skipped (never silently coerced) — same
 *  forward-compatibility discipline as figureDocument.ts's editableFigures
 *  loader. Malformed entries and duplicate ids are dropped. An absent/empty
 *  `value` (a workspace saved before this field existed) returns `[]` —
 *  the deterministic "no field -> no pages, no crash" migration. */
export function sanitizePageDocuments(value: unknown): PageDocument[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const documents: PageDocument[] = [];
  for (const candidate of value) {
    const document = sanitizePageDocument(candidate);
    if (!document || seen.has(document.id)) continue;
    seen.add(document.id);
    documents.push(document);
  }
  return documents;
}

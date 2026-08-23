// Figure Page document editing/session actions (FIGURE_AUTHORING_WORKFLOW_PLAN
// F3.1-F3.3), split out of `lib/pageDocument.ts` (2026-08-23, C2 bundle pass —
// see `frontend/scripts/check-bundle-size.mjs`'s header for the ratchet this
// split feeds). `lib/pageDocument.ts` keeps only what `lib/workspace.ts`'s
// synchronous `parseWorkspace` needs at load time (the schema types + the
// `sanitizePageDocument`/`sanitizePageDocuments` validators); every function
// here is reached ONLY from the Figure Page workshop panel (creation,
// panel-reference resolution, dirty-state, and the JSON serialize/deserialize
// pair) or the Library's "which pages reference this figure" delete-guard —
// both already `lazy()`/`lazyPanel()`-gated, never the eager parse boundary —
// so co-locating them with the sanitizer was dragging ~90 lines of edit-only
// logic into the eager graph purely by file co-location (the same
// `lib/api.ts`/primitives-barrel mechanism R8 already fixed elsewhere: one
// eager export forces the WHOLE file's Rollup chunk eager, regardless of
// whether the file's other exports have any eager consumer).
//
// Verified before moving (grep for a real import, not text match): NONE of
// the functions below has an eager consumer — every real (non-test)
// importer is components/workshops/figurepage/* or
// components/Library/{artifactContextActions,EditableFiguresSection}.ts(x),
// all reachable only through Library.tsx's `lazy()` FigurePage/Pages
// sections, never `main.tsx`/`App.tsx`/`store/useApp.ts` directly.

import type { FigureDocument } from "./figureDocument";
import type { PageLabelFormat } from "./figurepage";
import { panelLabel } from "./figurepageActions";
import {
  DEFAULT_LAYOUT,
  DEFAULT_OUTPUT,
  emptyPagePanels,
  PAGE_DOCUMENT_SCHEMA,
  PAGE_DOCUMENT_VERSION,
  sanitizePageDocument,
  type PageDocument,
  type PageLayoutSettings,
  type PageOutputSettings,
  type PagePanel,
} from "./pageDocument";

export interface CreatePageDocumentInput {
  id: string;
  name: string;
  rows?: number;
  cols?: number;
  /** Padded/truncated to `rows*cols` so callers never hand-sync the two. */
  panels?: PagePanel[];
  output?: Partial<PageOutputSettings>;
  layout?: Partial<PageLayoutSettings>;
  /** Default both to "now" — a caller restoring an existing document (the
   *  workspace loader, or a reopened seed) passes its real saved values. */
  createdAt?: string;
  modifiedAt?: string;
}

/** Pure constructor for a fresh/trusted document (`sanitizePageDocument` in
 *  `lib/pageDocument.ts` is the untrusted-input boundary — this one only
 *  floors rows/cols at 1). */
export function createPageDocument(input: CreatePageDocumentInput): PageDocument {
  const rows = Math.max(1, Math.round(input.rows ?? 2));
  const cols = Math.max(1, Math.round(input.cols ?? 2));
  const base = emptyPagePanels(rows, cols);
  const panels = base.map((slot, i) => input.panels?.[i] ?? slot);
  const now = new Date().toISOString();
  return {
    schema: PAGE_DOCUMENT_SCHEMA,
    version: PAGE_DOCUMENT_VERSION,
    id: input.id,
    name: input.name,
    rows,
    cols,
    panels,
    output: { ...DEFAULT_OUTPUT, ...input.output },
    layout: { ...DEFAULT_LAYOUT, ...input.layout },
    createdAt: input.createdAt ?? now,
    modifiedAt: input.modifiedAt ?? now,
  };
}

// ── panel resolution (F3.2 — fail closed, no silent drop) ──────────────────

export type PagePanelResolution =
  | { status: "empty" }
  | { status: "missing"; figureId: string }
  | { status: "ok"; figure: FigureDocument };

/** Resolve one panel against the CURRENT editable-figures library. A
 *  non-null `figureId` that isn't found is reported "missing" — never
 *  treated as empty, and never silently dropped from the page. Callers (a
 *  renderer, an export, or a panel-editor UI) must surface it explicitly
 *  rather than skip it. */
export function resolvePagePanel(
  panel: PagePanel,
  figures: readonly FigureDocument[],
): PagePanelResolution {
  if (panel.figureId === null) return { status: "empty" };
  const figure = figures.find((candidate) => candidate.id === panel.figureId);
  return figure ? { status: "ok", figure } : { status: "missing", figureId: panel.figureId };
}

/** Per-panel preview labels — mirrors lib/figurepage.ts's `slotLabels`: every
 *  occupied panel (including one whose reference is currently MISSING — it
 *  still holds its place on the page) counts through the auto sequence in
 *  row-major order; an explicit override wins; only a genuinely empty slot
 *  previews "". */
export function pagePanelLabels(panels: readonly PagePanel[], fmt: PageLabelFormat): string[] {
  let k = 0;
  return panels.map((panel) => {
    if (panel.figureId === null) return "";
    const auto = panelLabel(k, fmt);
    k += 1;
    return panel.label !== null ? panel.label : auto;
  });
}

/** F3.2 "frozen-snapshot behavior, defined": the lifecycle cue a resolved
 *  panel surfaces is inherited ENTIRELY from the referenced FigureDocument's
 *  own live/frozen state (`FigureDocument.data.mode`) — the page never
 *  defines a second freeze mechanism of its own (per the plan's explicit
 *  instruction). `null` for an empty or missing panel: there is no document
 *  to classify. Callers (a panel-editor UI, a page renderer) surface this as
 *  a subtle cue on the panel, same spirit as the session-level
 *  `resolvePanelSource`'s `lifecycle` field in lib/figurepage.ts. */
export function pagePanelLifecycle(resolution: PagePanelResolution): "live" | "frozen" | null {
  return resolution.status === "ok" ? resolution.figure.data.mode : null;
}

// ── referential integrity at the delete site (F3.2 item 3) ─────────────────

/** One page's references to a figure being considered for deletion: which
 *  panel (slot) indices point at it, plus the labels those slots would
 *  preview (so a delete confirmation can name "slot (b)" the way the user
 *  sees it, not a raw array index). */
export interface PageFigureReference {
  page: PageDocument;
  slots: number[];
  labels: string[];
}

/** Which persisted pages (and which of their panels) reference `figureId`.
 *  Used at the editableFigures delete site so deleting a figure a page
 *  depends on WARNS by name before it happens, rather than only surfacing as
 *  a "missing" panel after the fact. Deleting the figure never cascades to
 *  the page itself — the panel is left referencing the now-dangling id and
 *  resolves through `resolvePagePanel` to `{status:"missing"}` on its next
 *  read, exactly like any other dangling reference (fail closed, never
 *  dropped). */
export function pagesReferencingFigure(
  pages: readonly PageDocument[],
  figureId: string,
): PageFigureReference[] {
  const out: PageFigureReference[] = [];
  for (const page of pages) {
    const slots = page.panels
      .map((panel, i) => (panel.figureId === figureId ? i : -1))
      .filter((i) => i >= 0);
    if (slots.length === 0) continue;
    const labels = pagePanelLabels(page.panels, page.output.labelFormat);
    out.push({ page, slots, labels: slots.map((i) => labels[i] || `#${i + 1}`) });
  }
  return out;
}

// ── save/dirty state (F3.3) ─────────────────────────────────────────────────

function pageDocumentsEqual(a: PageDocument, b: PageDocument): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** F3.3: does `pageDocument` (the session's current resolved draft) have
 *  anything worth saving — never saved at all (no `pages` entry shares its
 *  id), or a saved entry exists but differs from the current draft. Drives
 *  the Save affordance's dirty cue (name + "•"), mirroring
 *  store/figureLifecycle.ts's `editableFigureDirty` (true for EVERY
 *  never-saved document, not just a drifted one). */
export function pageDocumentDirty(pageDocument: PageDocument, pages: readonly PageDocument[]): boolean {
  const saved = pages.find((p) => p.id === pageDocument.id);
  return !saved || !pageDocumentsEqual(saved, pageDocument);
}

/** F3.3: narrower than `pageDocumentDirty` — false for a page never saved at
 *  all. Mirrors `editableFigureHasUnsavedEdits`'s corrected convention (the
 *  2026-08-01 adversarial review found the broader predicate over-fired a
 *  close-confirm on every routine never-saved close): only a SAVED page that
 *  has since drifted gates a close confirmation. Closing a fresh, never-saved
 *  page discards it exactly like the pre-F3.3 "this composition is
 *  temporary" behavior — a known, already-disclosed loss, not a new one. */
export function pageDocumentHasUnsavedEdits(
  pageDocument: PageDocument,
  pages: readonly PageDocument[],
): boolean {
  const saved = pages.find((p) => p.id === pageDocument.id);
  return saved !== undefined && !pageDocumentsEqual(saved, pageDocument);
}

// ── ad hoc JSON round-trip (not the .dwk boundary — that's sanitizePageDocument) ──

export function serializePageDocument(document: PageDocument): string {
  return JSON.stringify(document);
}

export function deserializePageDocument(raw: string): PageDocument | null {
  try {
    return sanitizePageDocument(JSON.parse(raw));
  } catch {
    return null;
  }
}

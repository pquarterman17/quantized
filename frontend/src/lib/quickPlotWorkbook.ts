// The workbook-level Quick Plot resolvers and the workbook-row gate (L0.11,
// L0.36), moved verbatim out of lib/quickPlot.ts (bundle diet slice 22,
// plans/BUNDLE_HEADROOM.md). Their only caller is the workbook row menu
// (`lib/workbookContextActions.ts`), which is already lazy, so they load
// with it. Import them by path; lib/quickPlot.ts does not re-export them.

import type { LibraryNode } from "./libraryHierarchy";
import { quickPlotAvailability } from "./quickPlot";
import type { Dataset } from "./types";

/** L0.11's Quick Plot worksheet resolver for a workbook -- DISTINCT from
 *  L0.6's remembered-child resolver (`libraryOpen.ts`'s
 *  `openWorkbookRemembered`/`opensInStage`), which opens ANY remembered
 *  child kind and falls back to "first worksheet" unconditionally. This one
 *  additionally requires the candidate to pass `quickPlotAvailability`, with
 *  a STRICT no-silent-substitution rule for a remembered WORKSHEET
 *  (contract decision, L0.11): (1) if the remembered child is a worksheet,
 *  it is a deliberate destination -- return it if it passes
 *  `quickPlotAvailability`, else return null OUTRIGHT (never fall through
 *  to a different sheet the user didn't pick); (2) only when the remembered
 *  key is ABSENT or names a NON-worksheet child (a figure, a report -- L0.6
 *  remembers those too) does this fall through to the first worksheet in
 *  source order (children are already source-ordered by the hierarchy
 *  builder) that passes `quickPlotAvailability`; (3) else null. */
export function pickQuickPlotWorksheet(
  children: readonly LibraryNode[],
  workbookLastChild: Record<string, string>,
  workbookId: string,
): Dataset | null {
  const remembered = rememberedWorksheet(children, workbookLastChild, workbookId);
  if (remembered) return quickPlotAvailability(remembered).available ? remembered : null;
  return worksheetsOf(children).find((w) => quickPlotAvailability(w).available) ?? null;
}

/** The workbook's remembered child (L0.6's `workbookLastChild`) when it is a
 *  WORKSHEET; undefined when nothing is remembered or the remembered child
 *  is another kind (a figure, a report). The one lookup every workbook-level
 *  Quick Plot resolver starts from. */
function rememberedWorksheet(
  children: readonly LibraryNode[],
  workbookLastChild: Record<string, string>,
  workbookId: string,
): Dataset | undefined {
  const key = workbookLastChild[workbookId];
  const node = key ? children.find((c) => c.key === key) : undefined;
  return node?.kind === "worksheet" ? node.entity : undefined;
}

/** The workbook's worksheets, in source order (children already are). */
function worksheetsOf(children: readonly LibraryNode[]): Dataset[] {
  return children.flatMap((c) => (c.kind === "worksheet" ? [c.entity] : []));
}

/** Resolve the worksheet a workbook-level Configure Quick Plot action edits.
 * Unlike Quick Plot itself, configuration intentionally accepts unknown or
 * currently unplottable data: use the remembered worksheet when present,
 * otherwise the first worksheet in source order. This deliberately diverges
 * from `pickQuickPlotWorksheet`'s fallback when the remembered child is NOT
 * a worksheet (e.g. a figure): Quick Plot falls back to the first AVAILABLE
 * worksheet (skipping unrecognized ones), while Configure falls back to the
 * literal first worksheet in source order regardless of availability -- it
 * must work on workbooks with zero recognized sheets, since configuring
 * unknown data is the whole point of the builder. */
export function pickConfigureQuickPlotWorksheet(
  children: readonly LibraryNode[],
  workbookLastChild: Record<string, string>,
  workbookId: string,
): Dataset | null {
  return rememberedWorksheet(children, workbookLastChild, workbookId) ?? worksheetsOf(children)[0] ?? null;
}

export interface QuickPlotWorkbookGate {
  enabled: boolean;
  /** "" when enabled -- only meaningful when `enabled` is false. */
  reason: string;
}

/** The workbook-row "Quick Plot" gate (L0.36): enabled exactly when
 *  `pickQuickPlotWorksheet` resolves. When it doesn't, pick the MOST
 *  SPECIFIC honest reason available: a remembered WORKSHEET that itself
 *  failed availability is why the resolver refused (the strict rule above)
 *  -- surface ITS specific reason, never a different sheet's; otherwise, no
 *  worksheets at all; every worksheet failing `quickPlotAvailability` for
 *  the identical reason (most commonly "every candidate is unrecognized");
 *  or the generic "none qualify" when the failures are a mix and no single
 *  reason covers all of them. */
export function quickPlotWorkbookGate(
  children: readonly LibraryNode[],
  workbookLastChild: Record<string, string>,
  workbookId: string,
): QuickPlotWorkbookGate {
  if (pickQuickPlotWorksheet(children, workbookLastChild, workbookId)) {
    return { enabled: true, reason: "" };
  }
  const remembered = rememberedWorksheet(children, workbookLastChild, workbookId);
  if (remembered) {
    const a = quickPlotAvailability(remembered);
    if (!a.available) return { enabled: false, reason: a.reason };
  }
  const worksheets = worksheetsOf(children);
  if (worksheets.length === 0) {
    return { enabled: false, reason: "this workbook has no worksheets" };
  }
  const reasons = new Set(
    worksheets.map((w) => {
      const a = quickPlotAvailability(w);
      return a.available ? "" : a.reason;
    }),
  );
  if (reasons.size === 1) {
    const only = [...reasons][0];
    if (only) return { enabled: false, reason: only };
  }
  return { enabled: false, reason: "no plottable worksheet in this workbook" };
}

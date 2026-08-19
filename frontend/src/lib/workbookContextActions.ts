// The workbook context-menu registry (LIBRARY_WORKBOOK_UX_PLAN PR C, L0.36).
// A sibling of contextActions.ts (near its 500-line ceiling) rather than
// another block inside it — same "registry array + a builder splices the
// dynamic per-folder Move-to list in" shape as the dataset/folder registries,
// just in its own file. Disabled items carry a `disabledReason` (L0.36:
// "disable ... with a short reason rather than removing them
// unpredictably") — `contextActions.ts`'s `actionMenuItem` renders that as
// the item's tooltip.
//
// L0.36's full command set is: Open, Browse, Quick Plot/Configure Quick
// Plot, Quick Plot With..., Reimport, Copy, Paste, Duplicate, Rename, Move,
// Reveal Source, Properties, Delete. This PR ships only what has a settled
// contract today (Open/Rename/Move/Reveal Source/Delete) plus disabled
// placeholders for the three features named by a later PR (Quick
// Plot/Browse/Properties) so the command stays discoverable without
// pretending it works. Reimport/Copy/Paste/Duplicate/Quick Plot With... have
// no contract yet and are simply absent rather than disabled-guessed.

import { openLibraryNode } from "../components/Library/libraryOpen";
import type { ContextAction } from "./contextActions";
import { computeDependencyImpact, formatDependencyImpact, hasDependencyImpact } from "./dependencyImpact";
import type { LibraryNode } from "./libraryHierarchy";
import { pickConfigureQuickPlotWorksheet, pickQuickPlotWorksheet, quickPlotWorkbookGate } from "./quickPlot";
import { toast } from "../store/toasts";
import { useApp } from "../store/useApp";
import { openQuickPlotWith, openQuickPlotWithForWorkbook } from "../store/quickPlotWithDialog";
import { workbookDeleteBlockers } from "../store/workbookActions";

export interface WorkbookActionTarget {
  node: Extract<LibraryNode, { kind: "workbook" }>;
  /** Local UI: open this row's own inline rename input. */
  onRename: () => void;
  /** Tile workspace only: browse this workbook without activating a child. */
  onBrowse?: () => void;
  /** Tile workspace only: open and reveal the Stage result. */
  onOpen?: () => void;
  /** Tile workspace only: close the workspace and return to the Stage after
   *  an action whose visible result is a plot (Quick Plot) -- the SAME
   *  contract as DatasetActionTarget.onStageOpen (contextActions.ts): the
   *  action already performed its own open, this only returns the view. */
  onStageOpen?: () => void;
}

const memberCount = (t: WorkbookActionTarget): number =>
  t.node.children.filter((c) => c.kind === "worksheet").length;

const memberIds = (t: WorkbookActionTarget): string[] =>
  t.node.children.filter((c) => c.kind === "worksheet").map((c) => c.entity.id);

export const workbookCoreActions: ContextAction<WorkbookActionTarget>[] = [
  { id: "workbook.open", label: "Open", run: (t) => t.onOpen ? t.onOpen() : openLibraryNode(t.node) },
  {
    id: "workbook.quickPlot",
    label: "Quick Plot",
    enabled: (t) =>
      quickPlotWorkbookGate(t.node.children, useApp.getState().workbookLastChild, t.node.entity.id).enabled,
    disabledReason: (t) =>
      quickPlotWorkbookGate(t.node.children, useApp.getState().workbookLastChild, t.node.entity.id).reason,
    run: (t) => {
      const picked = pickQuickPlotWorksheet(t.node.children, useApp.getState().workbookLastChild, t.node.entity.id);
      if (!picked) return; // fail-closed: the menu already disables this when nothing qualifies
      // quickPlotDataset returns true only on success (fix #6) -- a
      // fail-closed refusal has no plot to return the Stage to.
      if (useApp.getState().quickPlotDataset(picked.id)) t.onStageOpen?.();
    },
  },
  {
    id: "workbook.configureQuickPlot",
    label: "Configure Quick Plot…",
    enabled: (t) => t.node.children.some((child) => child.kind === "worksheet"),
    disabledReason: () => "this workbook has no worksheets",
    run: (t) => {
      const s = useApp.getState();
      const worksheet = pickConfigureQuickPlotWorksheet(t.node.children, s.workbookLastChild, t.node.entity.id);
      if (worksheet) s.openQuickFigureBuilder(worksheet.id);
    },
  },
  {
    id: "workbook.quickPlotWith",
    label: "Quick Plot With…",
    // L0.37: hidden until a template exists AND either this workbook has a
    // worksheet to target OR it has its OWN workbook-scoped templates
    // (review-round P2b: a memberless-but-alive workbook must not lose the
    // manage affordance for templates scoped to it — mirrors
    // dataset.quickPlotWith's hidden gate for the worksheet-present case).
    hidden: (t) => {
      const s = useApp.getState();
      if (s.quickPlotTemplates.length === 0) return true;
      if (t.node.children.some((child) => child.kind === "worksheet")) return false;
      return !s.quickPlotTemplates.some(
        (tpl) => tpl.scope.kind === "workbook" && tpl.scope.workbookId === t.node.entity.id,
      );
    },
    run: (t) => {
      const s = useApp.getState();
      const worksheet = pickConfigureQuickPlotWorksheet(t.node.children, s.workbookLastChild, t.node.entity.id);
      if (worksheet) openQuickPlotWith(worksheet.id);
      else openQuickPlotWithForWorkbook(t.node.entity.id);
    },
  },
  {
    id: "workbook.browse",
    label: "Browse",
    enabled: (t) => t.onBrowse != null,
    disabledReason: () => "available in Tiles view",
    run: (t) => t.onBrowse?.(),
  },
  { id: "workbook.rename", label: "Rename…", run: (t) => t.onRename() },
  // PR I (L0.23/L0.36): Copy/Duplicate now have a settled contract
  // (store/workbookTransfer.ts) — Paste is deliberately NOT a per-workbook
  // menu row (pasting targets a FOLDER or the Library root, not an existing
  // workbook — see commands/workbookTransferCommands.ts, which offers it as
  // a command-palette entry until this codebase grows a folder/root
  // context-menu surface to host it natively).
  {
    id: "workbook.copy",
    label: "Copy",
    enabled: (t) => memberCount(t) > 0,
    disabledReason: () => "this workbook has no worksheets to copy",
    run: (t) => void useApp.getState().copyWorkbookToClipboard(t.node.entity.id),
  },
  {
    id: "workbook.duplicate",
    label: "Duplicate",
    enabled: (t) => memberCount(t) > 0,
    disabledReason: () => "this workbook has no worksheets to duplicate",
    run: (t) => void useApp.getState().duplicateWorkbook(t.node.entity.id),
  },
];

export const workbookSourceActions: ContextAction<WorkbookActionTarget>[] = [
  {
    id: "workbook.revealSource",
    label: "Reveal Source",
    enabled: (t) => t.node.entity.source != null,
    disabledReason: () => "no source path recorded",
    run: (t) => {
      // No OS-level "show in file explorer" integration exists yet (the
      // dataset menu doesn't have one either — L0.38 books it as a future
      // command). Surface the path through the app's own status/toast
      // channel rather than pretending a filesystem reveal happened.
      const path = t.node.entity.source!.path;
      useApp.getState().setStatus(`source: ${path}`);
      toast(path);
    },
  },
  {
    id: "workbook.properties",
    label: "Properties…",
    enabled: () => false,
    disabledReason: () => "arrives with Details/Properties (PR D)",
    run: () => {},
  },
];

export const workbookDeleteActions: ContextAction<WorkbookActionTarget>[] = [
  {
    id: "workbook.delete",
    label: "Delete",
    destructive: true,
    // L0.45 (PR M, 2026-08-19): unconditionally enabled — workbookDeleteBlockers
    // is kept as plumbing but always returns null now (see its doc). The
    // real L0.45 gate is the confirm message below: it names EVERY
    // consequence — the workbook grouping loss AND (PR M) the full
    // downstream dependency impact — so the user chooses with full
    // information instead of the command being blocked outright.
    enabled: (t) => workbookDeleteBlockers(useApp.getState(), t.node.entity.id) == null,
    disabledReason: (t) => workbookDeleteBlockers(useApp.getState(), t.node.entity.id) ?? "",
    confirm: (t) => {
      const n = memberCount(t);
      // PR M (L0.45 + L0.55): the full downstream closure of every member
      // worksheet — bgRef chains, derived worksheets, fits — via the SAME
      // `downstreamOf` the recalc engine itself uses (lib/dependencyImpact.ts).
      // `removed: true` (review round P2): these members are DESTROYED, not
      // reimported — a member's own saved fit goes with it, so it must not
      // be listed as something that will merely go stale.
      const impact = computeDependencyImpact(useApp.getState().datasets, memberIds(t), { removed: true });
      const impactText = hasDependencyImpact(impact) ? ` ${formatDependencyImpact(impact)}` : "";
      return {
        title: `Delete "${t.node.entity.name}"?`,
        // P1 fix: say exactly what happens. The WORKBOOK GROUPING is gone
        // for good the moment this runs (deleteWorkbook removes the
        // WorkbookNode outright) — only the member worksheets are
        // recoverable, and restoring one later (store/trash.ts's
        // restoreFromTrash self-heal) gives it a fresh workbook of its own
        // rather than reconstituting this one.
        message: `${
          n > 0
            ? `${n} worksheet${n === 1 ? "" : "s"} will move to Trash and can be restored — but the "${t.node.entity.name}" workbook grouping itself is removed for good; each worksheet restored later becomes its own new workbook.`
            : "This workbook has no worksheets; the grouping is removed for good."
        }${impactText}`,
        confirmLabel: "Delete",
      };
    },
    run: (t) => {
      useApp.getState().deleteWorkbook(t.node.entity.id);
      toast(`deleted "${t.node.entity.name}"`);
    },
  },
];

/** Every fixed workbook action, flat — for a caller that wants the whole set
 *  without the dynamic per-folder Move-to list (workbookRowMenu.ts splices
 *  that in, matching datasetRowMenu.ts's own pattern). */
export const workbookActions: ContextAction<WorkbookActionTarget>[] = [
  ...workbookCoreActions,
  ...workbookSourceActions,
  ...workbookDeleteActions,
];

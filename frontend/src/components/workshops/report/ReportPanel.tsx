// Report sheet viewer (#36) — a draggable ToolWindow rendering the open
// ReportEntry's schema blocks (text / table / params / figure) with collapsible
// sections and one-click export through /api/report/export. Renders the SAME
// schema the LaTeX/HTML/docx/pptx exporters consume — no viewer-only special
// cases. Blocks are DOM (not canvas) so the whole panel is testable in jsdom.
//
// P3.6: each block carries move-up/move-down/remove controls (one undo step
// each, via the store's `updateReportSheet`), a figure sent from a plot shows
// as a rendered-figure card (ReportBlockView.tsx), and an export's warnings —
// a figure that could not be rendered or embedded, the per-report figure cap,
// a vector that fell back to raster — are surfaced: a toast when the export
// finishes, plus the list kept under the export row. The list is tied to the
// exact sheet object that was exported: any change to the sheet (a move, a
// remove, a new figure, undo/redo) hides it — LaTeX's figure file stems depend
// on document order, so even a move can make it wrong; an undo that restores
// the very sheet exported shows it again, correctly — and a response that
// lands after such a change is dropped (the toast still fires: that file WAS
// saved with those problems). Blocks are keyed by a stable per-object key,
// and after a keyboard move/remove focus stays on the moved block or lands on
// a neighbour's move control — never on another block's Remove.

import { useLayoutEffect, useRef, useState } from "react";

import { reportExport, type ExportFormat, type ReportExportResult } from "../../../lib/api/reportExport";
import type { ReportSheet } from "../../../lib/report";
import { moveReportBlock, removeReportBlock, reportBlockKey } from "../../../lib/reportBlocks";
import { TOAST_ACTION_TTL, toast } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";
import ToolWindow from "../../overlays/ToolWindow";
import { Button } from "../../primitives";
import { askConfirm } from "../../overlays/ConfirmDialog";
import { EditableBlock } from "./ReportBlockView";

const EXPORTS: { format: ExportFormat; label: string }[] = [
  { format: "html", label: "HTML" },
  { format: "latex", label: "LaTeX" },
  { format: "docx", label: "Word" },
  { format: "pptx", label: "PPT" },
];

/** The one-line toast for an export that finished WITH warnings: the first
 *  warning plus a "(+N more)" count (the `notifyMigrationWarnings` shape —
 *  one toast, never one per warning). The count is the backend's TRUE total,
 *  which can exceed the texts the header carried. */
export function reportWarningToast(label: string, res: ReportExportResult): string {
  const n = res.warningCount;
  const head = `${label} export finished with ${n} warning${n === 1 ? "" : "s"}`;
  if (res.warnings.length === 0) return head;
  return `${head}: ${res.warnings[0]}${n > 1 ? ` (+${n - 1} more)` : ""}`;
}

/** Where focus goes once a block edit has re-rendered: a block's move
 *  control (`prefer` first, the other one if that is disabled at an edge),
 *  else the section's header. Never a Remove button. */
type FocusIntent = { section: number; key?: string; prefer: "up" | "down" };

function focusAfterEdit(root: HTMLElement, intent: FocusIntent): void {
  const block = intent.key ? root.querySelector(`[data-block-key="${intent.key}"]`) : null;
  const ctl = (c: string) => block?.querySelector<HTMLButtonElement>(`[data-ctl="${c}"]`);
  const other = intent.prefer === "up" ? "down" : "up";
  const target = [ctl(intent.prefer), ctl(other)].find((b) => b && !b.disabled);
  (target ?? root.querySelector<HTMLElement>(`[data-section-head="${intent.section}"]`))?.focus();
}

function SheetView({
  sheet,
  onMove,
  onRemove,
}: {
  sheet: ReportSheet;
  onMove: (si: number, bi: number, delta: -1 | 1) => boolean;
  onRemove: (si: number, bi: number) => boolean;
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set());
  const rootRef = useRef<HTMLDivElement>(null);
  const focusNext = useRef<FocusIntent | null>(null);
  // Runs after the store update an edit caused has committed (no deps).
  useLayoutEffect(() => {
    const intent = focusNext.current;
    focusNext.current = null;
    if (intent && rootRef.current) focusAfterEdit(rootRef.current, intent);
  });
  const toggle = (i: number) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  const move = (i: number, j: number, key: string, delta: -1 | 1) => {
    if (onMove(i, j, delta)) focusNext.current = { section: i, key, prefer: delta < 0 ? "up" : "down" };
  };
  const remove = (i: number, j: number) => {
    const blocks = sheet.sections[i].blocks;
    const neighbour = blocks[j + 1] ?? blocks[j - 1];
    if (onRemove(i, j)) {
      focusNext.current = { section: i, key: neighbour ? reportBlockKey(neighbour) : undefined, prefer: "up" };
    }
  };
  return (
    <div ref={rootRef}>
      {sheet.sections.map((sec, i) => {
        const seen = new Set<string>();
        return (
          <div key={i} className="qzk-report-section">
            <button className="qzk-group-head" data-section-head={i} onClick={() => toggle(i)}>
              <span className="qzk-group-caret">{collapsed.has(i) ? "▸" : "▾"}</span>
              <span className="qzk-group-name">{sec.title}</span>
            </button>
            {!collapsed.has(i) &&
              sec.blocks.map((b, j) => {
                // The same object twice in one section (no edit produces it,
                // but a hand-built sheet could) must not share a React key.
                let key = reportBlockKey(b);
                if (seen.has(key)) key = `${key}@${j}`;
                seen.add(key);
                return (
                  <EditableBlock
                    key={key}
                    blockKey={key}
                    block={b}
                    index={j}
                    count={sec.blocks.length}
                    onMove={(delta) => move(i, j, key, delta)}
                    onRemove={() => remove(i, j)}
                  />
                );
              })}
          </div>
        );
      })}
    </div>
  );
}

export default function ReportPanel() {
  const openReportId = useApp((s) => s.openReportId);
  const reports = useApp((s) => s.reports);
  const setOpenReport = useApp((s) => s.setOpenReport);
  const removeReport = useApp((s) => s.removeReport);
  const updateReportSheet = useApp((s) => s.updateReportSheet);
  // Which format is currently exporting (P0.4 feedback/cancel audit tail):
  // `busy` used to be a plain boolean, so all four buttons went "disabled"
  // with no way to tell WHICH one was running. Naming the format is the
  // smallest fix — the running button's own label switches to "Exporting
  // X…", the rest stay disabled exactly as before.
  const [runningFormat, setRunningFormat] = useState<ExportFormat | null>(null);
  // The last export's warnings, tagged with the exact sheet OBJECT exported:
  // shown only while the open sheet is still that object (a different report,
  // or any edit to this one, has a different identity — see the header).
  const [lastWarnings, setLastWarnings] = useState<
    { sheet: ReportSheet; label: string; res: ReportExportResult } | null
  >(null);
  // The sheet on screen as of the last commit — the generation an in-flight
  // export's response is checked against (kept current in an effect).
  const liveSheet = useRef<ReportSheet | null>(null);
  const openSheet = reports.find((r) => r.id === openReportId)?.report ?? null;
  useLayoutEffect(() => {
    liveSheet.current = openSheet;
  });

  const entry = reports.find((r) => r.id === openReportId);
  if (!entry) return null;

  const doExport = async (format: ExportFormat, label: string) => {
    setRunningFormat(format);
    // A new export supersedes the last one's list, whatever it ends in — a
    // failed export must not leave the previous warnings looking current.
    setLastWarnings(null);
    const exported = entry.report;
    try {
      const res = await reportExport(exported, format, entry.name);
      if (res.warningCount > 0) {
        // Stale (the sheet changed while this export ran): drop the list.
        if (liveSheet.current === exported) setLastWarnings({ sheet: exported, label, res });
        // "info", not "danger": the file WAS saved (see notifyMigrationWarnings
        // in store/toasts.ts for the same call on a partial success) — with
        // the longer lifetime, and the list stays in the panel below.
        toast(reportWarningToast(label, res), "info", { ttlMs: TOAST_ACTION_TTL });
      }
    } catch (e) {
      toast(
        `could not export the report as ${format} — ${e instanceof Error ? e.message : "unknown error"}; nothing was saved`,
        "danger",
      );
    } finally {
      setRunningFormat(null);
    }
  };

  // Block edits go through `updateReportSheet`'s updater, which applies them
  // to the store's CURRENT sheet (not this render's `entry`), so two quick
  // clicks can never apply the second edit to a stale copy and drop the first.
  const onMove = (si: number, bi: number, delta: -1 | 1) =>
    updateReportSheet(entry.id, (sheet) => moveReportBlock(sheet, si, bi, delta), "move report block");
  const onRemove = (si: number, bi: number) => {
    const done = updateReportSheet(entry.id, (sheet) => removeReportBlock(sheet, si, bi), "remove report block");
    if (done) toast("removed the block — Undo restores it");
    return done;
  };

  const warnings = lastWarnings?.sheet === entry.report ? lastWarnings : null;

  return (
    <ToolWindow id="report" title={entry.name} width={460} onClose={() => setOpenReport(null)}>
      {entry.report.created && (
        <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
          {entry.report.created}
          {entry.report.source_refs?.length
            ? ` · from ${entry.report.source_refs.map((r) => r.name ?? r.id).join(", ")}`
            : ""}
        </div>
      )}
      <SheetView sheet={entry.report} onMove={onMove} onRemove={onRemove} />
      <div style={{ display: "flex", gap: 6, marginTop: 12, alignItems: "center" }}>
        <span className="qzk-field-lbl" style={{ margin: 0 }}>
          Export
        </span>
        {EXPORTS.map((e) => (
          <Button
            key={e.format}
            disabled={runningFormat !== null}
            onClick={() => void doExport(e.format, e.label)}
          >
            {runningFormat === e.format ? `Exporting ${e.label}…` : e.label}
          </Button>
        ))}
        <span style={{ flex: 1 }} />
        <Button
          onClick={() => {
            // A saved report is accumulated analysis output and
            // `removeReport` records no undo entry.
            void askConfirm(
              `Delete report "${entry.name}"?`,
              "This can't be undone.",
              "Delete",
              true,
            ).then((ok) => {
              if (!ok) return;
              removeReport(entry.id);
              toast(`removed report "${entry.name}"`);
            });
          }}
        >
          Delete report
        </Button>
      </div>
      {warnings && (
        <div className="qzk-report-warnings" role="status" data-testid="report-export-warnings">
          {`Last ${warnings.label} export: ${warnings.res.warningCount} warning${warnings.res.warningCount === 1 ? "" : "s"}`}
          {warnings.res.warnings.length > 0 && (
            <ul>
              {warnings.res.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          {warnings.res.warningCount > warnings.res.warnings.length && (
            <div className="qzk-report-caption">
              {`${warnings.res.warningCount - warnings.res.warnings.length} more not listed`}
            </div>
          )}
        </div>
      )}
    </ToolWindow>
  );
}

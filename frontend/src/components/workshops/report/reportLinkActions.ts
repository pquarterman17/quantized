// Refresh actions for linked report blocks (G19, provisional - owner to
// confirm). Pulls are computed first (figures are async), then applied in ONE
// `updateReportSheet` step: a block is replaced only if it is still the very
// object that was refreshed, so an edit made while a figure rebuilt is never
// overwritten. A block that cannot be refreshed keeps its last snapshot and is
// reported, never silently dropped. Lazy (report viewer only).

import { refreshFigureBlock } from "../../../lib/reportLinkFigure";
import { blockLabel, readBlockLink, refreshResultBlock } from "../../../lib/reportLinks";
import type { ReportBlock, ReportSheet } from "../../../lib/report";
import { useApp } from "../../../store/useApp";

export interface RefreshOutcome {
  refreshed: number;
  kept: { label: string; reason: string }[];
}

/** Refresh `only` (one block) or every linked block of report `reportId`. */
export async function refreshLinkedBlocks(reportId: string, only?: ReportBlock): Promise<RefreshOutcome> {
  const get = useApp.getState;
  const entry = get().reports.find((r) => r.id === reportId);
  const out: RefreshOutcome = { refreshed: 0, kept: [] };
  if (!entry) return out;
  const replacements = new Map<ReportBlock, ReportBlock>();
  for (const sec of entry.report.sections) {
    for (const [i, block] of sec.blocks.entries()) {
      if ((only && block !== only) || !readBlockLink(block)) continue;
      const link = readBlockLink(block)!;
      const ctx = { results: get().analysisResults, datasets: get().datasets };
      const r = link.kind === "figure" ? await refreshFigureBlock(get, block) : refreshResultBlock(block, ctx);
      if ("kept" in r) out.kept.push({ label: blockLabel(block, i), reason: r.kept });
      else if (r.changed) replacements.set(block, r.block);
    }
  }
  if (replacements.size > 0) {
    let applied = 0;
    const swap = (sheet: ReportSheet): ReportSheet => ({
      ...sheet,
      sections: sheet.sections.map((sec) => ({
        ...sec,
        blocks: sec.blocks.map((b) => {
          const next = replacements.get(b);
          if (next) applied++;
          return next ?? b;
        }),
      })),
    });
    get().updateReportSheet(reportId, swap, "refresh linked report blocks");
    out.refreshed = applied;
  }
  return out;
}

/** One status line / toast text for an outcome. */
export function refreshSummary(o: RefreshOutcome): string {
  const kept = o.kept.length
    ? `; kept the last snapshot of ${o.kept.length} (${o.kept.map((k) => `${k.label}: ${k.reason}`).join("; ")})`
    : "";
  return `refreshed ${o.refreshed} linked block${o.refreshed === 1 ? "" : "s"}${kept}`;
}

/** The report sheet `reportId` holds right now (after a refresh landed). */
export function openReport(reportId: string): ReportSheet | undefined {
  const get = useApp.getState;
  return get().reports.find((r) => r.id === reportId)?.report;
}

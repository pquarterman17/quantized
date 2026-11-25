// Per-block link controls in the report viewer (G19, provisional - owner to
// confirm). A snapshot block (the default) offers "Link to source…"; a linked
// block shows a state badge (linked / stale / source missing), "Refresh block"
// and "Unlink". All edits are one undo step through `updateReportSheet`, and
// replace the block only if it is still the object this bar rendered.

import { useMemo } from "react";

import { figureLinkState, linkBlockToFigure } from "../../../lib/reportLinkFigure";
import {
  linkBlockToResult,
  linkableResults,
  readBlockLink,
  resultLinkState,
  unlinkedBlock,
  type LinkState,
} from "../../../lib/reportLinks";
import type { ReportBlock, ReportSheet } from "../../../lib/report";
import { askParams } from "../../../store/paramDialog";
import { toast } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";
import { Badge, Button } from "../../primitives";
import { refreshLinkedBlocks, refreshSummary } from "./reportLinkActions";

/** The block's link state against the live results / figures. */
export function useLinkState(block: ReportBlock): LinkState {
  const results = useApp((s) => s.analysisResults);
  const datasets = useApp((s) => s.datasets);
  const figures = useApp((s) => s.editableFigures);
  return useMemo(() => {
    const link = readBlockLink(block);
    if (!link) return { kind: "snapshot" };
    return link.kind === "figure"
      ? figureLinkState(link, { figures, datasets })
      : resultLinkState(block, link, { results, datasets });
  }, [block, results, datasets, figures]);
}

const BADGE: Record<Exclude<LinkState["kind"], "snapshot">, { tone: "ok" | "warn" | "danger"; text: string }> = {
  current: { tone: "ok", text: "⛓ linked" },
  behind: { tone: "warn", text: "⛓ stale" },
  stale: { tone: "warn", text: "⛓ stale" },
  missing: { tone: "danger", text: "⛓ source missing" },
};

export default function ReportLinkBar({ block }: { block: ReportBlock }) {
  const reportId = useApp((s) => s.openReportId);
  const state = useLinkState(block);
  const results = useApp((s) => s.analysisResults);
  const figures = useApp((s) => s.editableFigures);
  const datasets = useApp((s) => s.datasets);
  const updateReportSheet = useApp((s) => s.updateReportSheet);
  if (!reportId || block.type === "text") return null;

  const replace = (next: ReportBlock, label: string) =>
    updateReportSheet(reportId, (sheet: ReportSheet) => ({
      ...sheet,
      sections: sheet.sections.map((sec) => ({ ...sec, blocks: sec.blocks.map((b) => (b === block ? next : b)) })),
    }), label);

  const link = async () => {
    if (block.type === "figure") {
      if (figures.length === 0) return void toast("no saved figures to link to", "danger");
      const names = figures.map((f, i) => `${i + 1}. ${f.name}`);
      const pick = await askParams("Link figure block", [
        { key: "figure", label: "Source figure", type: "select", default: names[0], options: names,
          hint: "Provisional: the block is assumed to show this figure as it is now" },
      ], { confirmLabel: "Link" });
      if (!pick) return;
      const done = linkBlockToFigure(block, figures[names.indexOf(String(pick.figure))], datasets);
      if ("error" in done) return void toast(`can't link: ${done.error}`, "danger");
      replace(done.block, "link report block");
      return;
    }
    const entries = linkableResults(results).flatMap((r) =>
      (r.tables ?? []).map((t, i) => ({ r, i, label: `${r.name} · ${t.title || `Table ${i + 1}`}` })));
    if (entries.length === 0) return void toast("no saved analysis-result tables to link to", "danger");
    const labels = entries.map((e, n) => `${n + 1}. ${e.label}`);
    const pick = await askParams("Link block to a result table", [
      { key: "table", label: "Source table", type: "select", default: labels[0], options: labels },
    ], { confirmLabel: "Link" });
    if (!pick) return;
    const e = entries[labels.indexOf(String(pick.table))];
    const done = linkBlockToResult(block, e.r, e.i);
    if ("error" in done) return void toast(`can't link: ${done.error}`, "danger");
    replace(done.block, "link report block");
  };

  const refresh = async () => {
    const o = await refreshLinkedBlocks(reportId, block);
    toast(refreshSummary(o), o.kept.length ? "info" : "ok");
  };

  if (state.kind === "snapshot") {
    return (
      <div className="qzk-report-caption" data-testid="report-link-bar">
        <Button onClick={() => void link()}>Link to source…</Button>
      </div>
    );
  }
  const badge = BADGE[state.kind];
  return (
    <div className="qzk-report-caption" data-testid="report-link-bar" style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <Badge tone={badge.tone}>{badge.text}</Badge>
      {state.kind !== "current" && <span data-testid="report-link-reason">{state.reason}</span>}
      {state.kind === "missing" && <span>last snapshot kept</span>}
      <Button disabled={state.kind !== "behind"} onClick={() => void refresh()}>Refresh block</Button>
      <Button onClick={() => replace(unlinkedBlock(block), "unlink report block")}>Unlink</Button>
    </div>
  );
}

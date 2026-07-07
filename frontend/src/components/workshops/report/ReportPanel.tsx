// Report sheet viewer (#36) — a draggable ToolWindow rendering the open
// ReportEntry's schema blocks (text / table / params / figure) with collapsible
// sections and one-click export through /api/report/export. Renders the SAME
// schema the LaTeX/HTML/docx/pptx exporters consume — no viewer-only special
// cases. Blocks are DOM (not canvas) so the whole panel is testable in jsdom.

import { useState } from "react";

import { reportExport } from "../../../lib/api";
import { fmtNum } from "../../../lib/format";
import type {
  ReportBlock,
  ReportParam,
  ReportSheet,
} from "../../../lib/report";
import { toast } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";
import ToolWindow from "../../overlays/ToolWindow";
import { Button } from "../../primitives";

const EXPORTS: { format: "html" | "latex" | "docx" | "pptx"; label: string }[] = [
  { format: "html", label: "HTML" },
  { format: "latex", label: "LaTeX" },
  { format: "docx", label: "Word" },
  { format: "pptx", label: "PPT" },
];

/** value ± error [unit], error omitted when absent. */
function paramText(p: ReportParam): string {
  const v = p.value === null ? "—" : fmtNum(p.value);
  const e = p.error !== undefined ? ` ± ${fmtNum(p.error)}` : "";
  const u = p.unit ? ` ${p.unit}` : "";
  return `${v}${e}${u}`;
}

function BlockView({ block }: { block: ReportBlock }) {
  switch (block.type) {
    case "text":
      return <p className="qzk-report-text">{block.text}</p>;
    case "params":
      return (
        <div className="qzk-report-tablewrap">
          <table className="qz-table">
            <tbody>
              {block.params.map((p, i) => (
                <tr key={i}>
                  <td>{p.name}</td>
                  <td style={{ fontVariantNumeric: "tabular-nums" }}>{paramText(p)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {block.caption && <div className="qzk-report-caption">{block.caption}</div>}
        </div>
      );
    case "table":
      return (
        <div className="qzk-report-tablewrap" style={{ overflowX: "auto" }}>
          <table className="qz-table">
            <thead>
              <tr>
                {block.columns.map((c, i) => (
                  <th key={i}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j} style={{ fontVariantNumeric: "tabular-nums" }}>
                      {cell === null ? "—" : typeof cell === "number" ? fmtNum(cell) : cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {block.caption && <div className="qzk-report-caption">{block.caption}</div>}
        </div>
      );
    case "figure":
      return block.image ? (
        <figure style={{ margin: 0 }}>
          <img
            src={`data:${block.image.mime};base64,${block.image.data}`}
            alt={block.caption ?? block.name}
            style={{ maxWidth: "100%" }}
          />
          {block.caption && <figcaption className="qzk-report-caption">{block.caption}</figcaption>}
        </figure>
      ) : (
        <p className="qzk-report-text" style={{ color: "var(--text-faint)" }}>
          ▦ figure: {block.caption ?? block.name}
        </p>
      );
  }
}

function SheetView({ sheet }: { sheet: ReportSheet }) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set());
  const toggle = (i: number) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  return (
    <>
      {sheet.sections.map((sec, i) => (
        <div key={i} className="qzk-report-section">
          <button className="qzk-group-head" onClick={() => toggle(i)}>
            <span className="qzk-group-caret">{collapsed.has(i) ? "▸" : "▾"}</span>
            <span className="qzk-group-name">{sec.title}</span>
          </button>
          {!collapsed.has(i) &&
            sec.blocks.map((b, j) => <BlockView key={j} block={b} />)}
        </div>
      ))}
    </>
  );
}

export default function ReportPanel() {
  const openReportId = useApp((s) => s.openReportId);
  const reports = useApp((s) => s.reports);
  const setOpenReport = useApp((s) => s.setOpenReport);
  const removeReport = useApp((s) => s.removeReport);
  const [busy, setBusy] = useState(false);

  const entry = reports.find((r) => r.id === openReportId);
  if (!entry) return null;

  const doExport = async (format: "html" | "latex" | "docx" | "pptx") => {
    setBusy(true);
    try {
      await reportExport(entry.report, format, entry.name);
    } catch (e) {
      toast(e instanceof Error ? e.message : "report export failed", "danger");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ToolWindow title={entry.name} width={460} onClose={() => setOpenReport(null)}>
      {entry.report.created && (
        <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
          {entry.report.created}
          {entry.report.source_refs?.length
            ? ` · from ${entry.report.source_refs.map((r) => r.name ?? r.id).join(", ")}`
            : ""}
        </div>
      )}
      <SheetView sheet={entry.report} />
      <div style={{ display: "flex", gap: 6, marginTop: 12, alignItems: "center" }}>
        <span className="qzk-field-lbl" style={{ margin: 0 }}>
          Export
        </span>
        {EXPORTS.map((e) => (
          <Button key={e.format} disabled={busy} onClick={() => void doExport(e.format)}>
            {e.label}
          </Button>
        ))}
        <span style={{ flex: 1 }} />
        <Button
          onClick={() => {
            removeReport(entry.id);
            toast(`removed report "${entry.name}"`);
          }}
        >
          Delete
        </Button>
      </div>
    </ToolWindow>
  );
}

import { useMemo, useRef, useState } from "react";

import type { AnalysisResult } from "../../../lib/analysisResult";
import { SNAPSHOT_RESULT_STATUS, type SnapshotResultState } from "../../../lib/analysisResultFreshness";
import { fmtNum } from "../../../lib/format";
import { runLazy, onLoadFailure } from "../../../lib/runLazy";
import {
  statisticalTablePreviews,
  statisticalWorkspaceResults,
} from "../../../lib/statisticalResultWorkspace";
import type { Dataset } from "../../../lib/types";
import type { AnalysisTool } from "../../../lib/analysisCenter";
import { Badge, Button } from "../../primitives";
import { DataTable } from "../../primitives/DataTable";

interface Props {
  tools: readonly AnalysisTool[];
  results: readonly AnalysisResult[];
  datasets: readonly Dataset[];
  activeId: string | null;
  query: string;
  busyId: string | null;
  onLaunch: (toolId: string) => void;
  onOpen: (resultId: string) => void;
}

const statusTone = (state: SnapshotResultState): "ok" | "warn" | "neutral" =>
  state === "current" ? "ok" : state === "pending" ? "neutral" : "warn";

function date(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? "Date unavailable" : parsed.toLocaleString();
}

function display(value: string | number | null): string {
  return typeof value === "number" ? fmtNum(value) : value ?? "—";
}

export default function StatisticalResultsWorkspace({
  tools, results, datasets, activeId, query, busyId, onLaunch, onOpen,
}: Props) {
  const [currentOnly, setCurrentOnly] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [tableAction, setTableAction] = useState<string | null>(null);
  const tableActionRef = useRef<string | null>(null);
  const visible = useMemo(
    () => statisticalWorkspaceResults(results, datasets, activeId, query, currentOnly),
    [activeId, currentOnly, datasets, query, results],
  );

  const copyTables = async (result: AnalysisResult, tableIndex?: number): Promise<void> => {
    if (tableActionRef.current) return;
    const key = `copy:${result.id}:${tableIndex ?? "all"}`;
    tableActionRef.current = key;
    setTableAction(key);
    try {
      await runLazy("Loading result table…", () => import("../../../store/analysisResultActions"))
        .then((module) => module.copyAnalysisInlineTables(result.id, tableIndex, result.tables), onLoadFailure);
    } finally {
      tableActionRef.current = null;
      setTableAction(null);
    }
  };

  const exportTables = async (result: AnalysisResult, tableIndex?: number): Promise<void> => {
    if (tableActionRef.current) return;
    const key = `export:${result.id}:${tableIndex ?? "all"}`;
    tableActionRef.current = key;
    setTableAction(key);
    try {
      await runLazy("Loading result table…", () => import("../../../store/analysisResultActions"))
        .then((module) => module.exportAnalysisInlineTables(result.id, tableIndex, result.tables), onLoadFailure);
    } finally {
      tableActionRef.current = null;
      setTableAction(null);
    }
  };

  return (
    <div className="qzk-stats-workspace">
      <section className="qzk-stats-launchers" aria-labelledby="stats-launchers-title">
        <div className="qzk-stats-section-head">
          <div>
            <h2 id="stats-launchers-title">Start an analysis</h2>
            <p>Focused tools stay available; completed runs collect below in one comparable workspace.</p>
          </div>
        </div>
        {tools.length > 0 ? (
          <div className="qzk-stats-launcher-grid">
            {tools.map((tool) => (
              <article key={tool.action.id} className={`qzk-stats-launcher${tool.available ? "" : " unavailable"}`}>
                <div>
                  <h3>{tool.action.label}</h3>
                  <p>{tool.action.description}</p>
                  {!tool.available && <span>{tool.unavailableReason}</span>}
                </div>
                <Button
                  size="sm"
                  aria-label={`Open ${tool.action.label}`}
                  disabled={!tool.available || busyId !== null}
                  onClick={() => onLaunch(tool.action.id)}
                >
                  {busyId === tool.action.id ? "Opening…" : "Open"}
                </Button>
              </article>
            ))}
          </div>
        ) : <div className="qzk-analysis-empty">No statistical tools match this search.</div>}
      </section>

      <section className="qzk-stats-results" aria-labelledby="stats-results-title">
        <div className="qzk-stats-section-head">
          <div>
            <h2 id="stats-results-title">Saved statistical results</h2>
            <p>Expand a result to compare its interpretation and tables without opening separate dialogs.</p>
          </div>
          <label className="qzk-stats-current-only">
            <input
              type="checkbox"
              checked={currentOnly}
              disabled={!activeId}
              onChange={(event) => setCurrentOnly(event.target.checked)}
            />
            Current worksheet only
          </label>
        </div>

        {visible.length > 0 ? visible.map(({ result, sourceNames, state, activeSource }) => {
          const open = expanded.has(result.id);
          const previews = open ? statisticalTablePreviews(result) : [];
          const interpretation = result.scalarValues?.Interpretation;
          return (
            <details
              key={result.id}
              className="qzk-stats-result"
              open={open}
              onToggle={(event) => {
                const nextOpen = event.currentTarget.open;
                setExpanded((current) => {
                  if (current.has(result.id) === nextOpen) return current;
                  const next = new Set(current);
                  if (nextOpen) next.add(result.id); else next.delete(result.id);
                  return next;
                });
              }}
            >
              <summary>
                <span className="qzk-stats-result-title">
                  <strong>{result.name}</strong>
                  <small>{result.producer.label} · {sourceNames.join(", ") || "No source worksheet"}</small>
                </span>
                <span className="qzk-stats-result-meta">
                  {activeSource && <Badge tone="accent">Current worksheet</Badge>}
                  <Badge tone={statusTone(state)}>{SNAPSHOT_RESULT_STATUS[state]}</Badge>
                  <small>{date(result.updatedAt ?? result.createdAt)}</small>
                </span>
              </summary>
              {open && <div className="qzk-stats-result-body">
                {typeof interpretation === "string" && <p className="qzk-stats-interpretation">{interpretation}</p>}
                {result.warnings.length > 0 && (
                  <div className="qzk-stats-warnings" role="note">
                    <strong>Warnings</strong>
                    <ul>{result.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul>
                  </div>
                )}
                {previews.map(({ table, tableIndex, rows }) => (
                  <section key={`${table.title ?? "table"}-${tableIndex}`} className="qzk-stats-table">
                    <header>
                      <h3>{table.title || `Table ${tableIndex + 1}`}</h3>
                      <span className="qzk-stats-table-actions">
                        <Button
                          size="sm"
                          disabled={tableAction !== null}
                          onClick={() => void copyTables(result, tableIndex)}
                        >{tableAction === `copy:${result.id}:${tableIndex}` ? "Copying…" : "Copy table"}</Button>
                        <Button
                          size="sm"
                          disabled={tableAction !== null}
                          onClick={() => void exportTables(result, tableIndex)}
                        >{tableAction === `export:${result.id}:${tableIndex}` ? "Exporting…" : "Export table…"}</Button>
                      </span>
                    </header>
                    <div className="qzk-stats-table-scroll">
                      <DataTable columns={table.columns} rows={rows.map((row) => row.map(display))} />
                    </div>
                    {table.rows.length > rows.length && <p>Showing {rows.length} of {table.rows.length} rows.</p>}
                  </section>
                ))}
                {result.tables && result.tables.length > previews.length && (
                  <p className="qzk-stats-more">Showing {previews.length} of {result.tables.length} tables. Open the full result to inspect every table.</p>
                )}
                <div className="qzk-stats-result-actions">
                  <Button variant="primary" size="sm" onClick={() => onOpen(result.id)}>Open full result</Button>
                  <Button
                    size="sm"
                    disabled={!result.tables?.length || tableAction !== null}
                    onClick={() => void copyTables(result)}
                  >{tableAction === `copy:${result.id}:all` ? "Copying…" : "Copy all tables"}</Button>
                  <Button
                    size="sm"
                    disabled={!result.tables?.length || tableAction !== null}
                    onClick={() => void exportTables(result)}
                  >{tableAction === `export:${result.id}:all` ? "Exporting…" : "Export all tables…"}</Button>
                </div>
              </div>}
            </details>
          );
        }) : (
          <div className="qzk-analysis-empty">
            {query.trim() ? "No saved statistical results match this search." : currentOnly
              ? "No saved statistical results use the current worksheet."
              : "No saved statistical results yet. Run a tool above, then save its result."}
          </div>
        )}
      </section>
    </div>
  );
}

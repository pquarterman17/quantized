// Import wizard preview — pure renderer. A numbered raw-lines strip (RawLines:
// header / units / first-data-row rows highlighted) above the resolved-columns grid:
// per-column name + unit text fields and a role select (x/y/error/label/
// ignore, matching `ImportSettings.roles` exactly) -- and, on a time-only
// column, its format select (Excel's per-column data format,
// lib/importTimeFormats.ts) -- then the first N parsed data rows. All
// editing calls back into useImportWizard — this component holds no state of
// its own.

import { fmtNum } from "../../../lib/format";
import { clockCell, timeFormatOptions } from "../../../lib/importTimeFormats";
import type { ImportTimeFormat } from "../../../lib/importTypes";
import { ROLE_OPTIONS, xRoleColumns } from "../../../lib/importwizard";
import type { ImportColumnRole, ImportPreviewResponse } from "../../../lib/types";
import { highlightDelimiter } from "../../../lib/importRawLines";
import { Select } from "../../primitives";
import RawLines from "./RawLines";

export default function PreviewTable({
  preview,
  onRoleChange,
  onNameChange,
  onUnitChange,
  onTimeFormatChange,
}: {
  preview: ImportPreviewResponse;
  onRoleChange: (index: number, role: ImportColumnRole) => void;
  onNameChange: (index: number, name: string) => void;
  onUnitChange: (index: number, unit: string) => void;
  onTimeFormatChange?: (index: number, format: ImportTimeFormat) => void;
}) {
  // P1-5 DEFECT 1: every column currently marked x, when there's more than
  // one -- parse_import only ever keeps the first as the axis and silently
  // drops the rest, so each offending select gets a visible invalid state.
  const xConflicts = xRoleColumns(preview.columns);
  const xConflictIndices = new Set(xConflicts.length > 1 ? xConflicts.map((c) => c.index) : []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <RawLines
        lines={preview.raw_lines}
        roles={preview}
        delimiter={highlightDelimiter(preview.delimiter, undefined, preview.raw_lines)}
        more={Math.max(0, preview.n_lines - preview.raw_lines.length)}
      />

      <div style={{ overflowX: "auto" }}>
        <table className="qz-table">
          <thead>
            <tr>
              {preview.columns.map((c) => {
                const xConflict = xConflictIndices.has(c.index);
                return (
                  // `verticalAlign: top` so the conditional legend-label hint
                  // below lengthens THIS header cell without pushing every
                  // other column's inputs and role select out of alignment
                  // (`.qz-table th` sets no vertical-align of its own).
                  <th key={c.index} style={{ textAlign: "left", minWidth: 120, verticalAlign: "top" }}>
                    <input
                      className="qz-input"
                      style={{ width: "100%", marginBottom: 3 }}
                      value={c.name}
                      onChange={(e) => onNameChange(c.index, e.target.value)}
                      aria-label={`column ${c.index + 1} name`}
                    />
                    {c.effective_name && c.effective_name !== c.name && (
                      <div
                        className="qzk-ds-meta qzk-msg"
                        title="The selected label line will use this text in legends and axis labels"
                        style={{ color: "var(--accent)", marginBottom: 3 }}
                      >
                        Legend label: {c.effective_name}
                      </div>
                    )}
                    <input
                      className="qz-input"
                      style={{ width: "100%", marginBottom: 3 }}
                      value={c.unit}
                      placeholder="unit"
                      onChange={(e) => onUnitChange(c.index, e.target.value)}
                      aria-label={`column ${c.index + 1} unit`}
                    />
                    <Select
                      options={ROLE_OPTIONS}
                      value={c.role}
                      onChange={(e) => onRoleChange(c.index, e.target.value as ImportColumnRole)}
                      aria-label={`column ${c.index + 1} role`}
                      aria-invalid={xConflict ? "true" : undefined}
                      style={xConflict ? { borderColor: "var(--danger)" } : undefined}
                    />
                    {c.time_kind && (
                      <Select
                        options={timeFormatOptions(c.time_kind)}
                        value={c.time_format ?? "text"}
                        onChange={(e) => onTimeFormatChange?.(c.index, e.target.value as ImportTimeFormat)}
                        aria-label={`column ${c.index + 1} time format`}
                        title="How this time column reads: a time-of-day axis, seconds, elapsed seconds, or text"
                        style={{ marginTop: 3 }}
                      />
                    )}
                    {xConflict && (
                      <div
                        className="qzk-ds-meta"
                        style={{ color: "var(--danger)", marginTop: 2 }}
                      >
                        only one column can be x
                      </div>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row, i) => (
              <tr key={i}>
                {row.map((v, j) => (
                  // A time-of-day column previews as the clock it will plot as.
                  <td key={j}>{preview.columns[j]?.time_format === "clock" ? clockCell(v) : fmtNum(v)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {preview.decimal_comma_columns && preview.decimal_comma_columns.length > 0 && (
        <div role="note" className="qzk-ds-meta qzk-msg" style={{ color: "var(--text-dim)" }}>
          Read with a decimal comma: {preview.decimal_comma_columns.join(", ")}.
        </div>
      )}

      <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
        {preview.n_data_rows} data row{preview.n_data_rows === 1 ? "" : "s"} ·{" "}
        {preview.columns.length} column{preview.columns.length === 1 ? "" : "s"} · delimiter{" "}
        {JSON.stringify(preview.delimiter)}
        {preview.n_data_rows > preview.n_preview_rows &&
          ` · showing first ${preview.n_preview_rows}`}
      </div>
    </div>
  );
}

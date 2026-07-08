// Import wizard preview — pure renderer. A numbered raw-lines strip (header /
// units / first-data-row rows highlighted) above the resolved-columns grid:
// per-column name + unit text fields and a role select (x/y/error/label/
// ignore, matching `ImportSettings.roles` exactly), then the first N parsed
// data rows. All editing calls back into useImportWizard — this component
// holds no state of its own.

import { fmtNum } from "../../../lib/format";
import { ROLE_OPTIONS } from "../../../lib/importwizard";
import type { ImportColumnRole, ImportPreviewResponse } from "../../../lib/types";
import { Select } from "../../primitives";

export default function PreviewTable({
  preview,
  onRoleChange,
  onNameChange,
  onUnitChange,
}: {
  preview: ImportPreviewResponse;
  onRoleChange: (index: number, role: ImportColumnRole) => void;
  onNameChange: (index: number, name: string) => void;
  onUnitChange: (index: number, unit: string) => void;
}) {
  const rowBg = (i: number): string | undefined => {
    if (i === preview.header_line) return "var(--accent-soft)";
    if (i === preview.units_line) return "var(--capture-soft)";
    return undefined;
  };
  const rowTitle = (i: number): string | undefined => {
    if (i === preview.header_line) return "header line";
    if (i === preview.units_line) return "units line";
    if (i === preview.data_start_line) return "first data line";
    return undefined;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div
        style={{
          maxHeight: 130,
          overflowY: "auto",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--font-size-sm)",
          border: "1px solid var(--border-soft)",
          borderRadius: "var(--radius-sm)",
        }}
      >
        {preview.raw_lines.map((line, i) => (
          <div
            key={i}
            title={rowTitle(i)}
            style={{
              display: "flex",
              gap: 8,
              padding: "1px 6px",
              background: rowBg(i),
              borderTop: i === preview.data_start_line ? "1px solid var(--ok)" : undefined,
              whiteSpace: "pre",
            }}
          >
            <span style={{ color: "var(--text-faint)", minWidth: 24, textAlign: "right" }}>
              {i}
            </span>
            <span style={{ color: "var(--text-dim)" }}>{line || " "}</span>
          </div>
        ))}
      </div>

      <div style={{ overflowX: "auto" }}>
        <table className="qz-table">
          <thead>
            <tr>
              {preview.columns.map((c) => (
                <th key={c.index} style={{ textAlign: "left", minWidth: 120 }}>
                  <input
                    className="qz-input"
                    style={{ width: "100%", marginBottom: 3 }}
                    value={c.name}
                    onChange={(e) => onNameChange(c.index, e.target.value)}
                    aria-label={`column ${c.index + 1} name`}
                  />
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
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row, i) => (
              <tr key={i}>
                {row.map((v, j) => (
                  <td key={j}>{fmtNum(v)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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

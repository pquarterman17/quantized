// Import wizard (P1.6 item 2) — error-role assignment table. One row per
// `error`-role column: a TARGET picker (which channel/x-axis this describes),
// an axis picker, and a side picker (symmetric ± / + only / - only). Every
// value shown is EDITABLE and starts from a name-based SUGGESTION when one
// was unambiguous — "unassigned" (no suggestion) renders as an explicit,
// visibly-empty state, never a silently-picked default. Pure view — all
// state lives in useImportWizard/useImportErrorRoles.

import { errorTargetOptions, type WizardErrorRow } from "../../../lib/importwizard";
import type { ErrorBinding } from "../../../lib/errorRoles";
import type { ImportPreviewColumn } from "../../../lib/types";
import { Select } from "../../primitives";

const SIDE_OPTIONS: { value: ErrorBinding["side"]; label: string }[] = [
  { value: "both", label: "± symmetric" },
  { value: "+", label: "+ only" },
  { value: "-", label: "− only" },
];

const UNASSIGNED = "unassigned";

export default function ErrorRolesEditor({
  rows,
  columns,
  onTargetChange,
  onAxisChange,
  onSideChange,
}: {
  rows: WizardErrorRow[];
  columns: ImportPreviewColumn[];
  onTargetChange: (channel: number, target: number | null) => void;
  onAxisChange: (channel: number, axis: "x" | "y") => void;
  onSideChange: (channel: number, side: ErrorBinding["side"]) => void;
}) {
  if (rows.length === 0) return null;

  return (
    <div style={{ marginBottom: 10 }}>
      <div className="qzk-ds-meta" style={{ color: "var(--text-faint)", marginBottom: 4 }}>
        Error roles — which column each <code>error</code>-role column describes
      </div>
      <table className="qz-table">
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Column</th>
            <th style={{ textAlign: "left" }}>Describes</th>
            <th style={{ textAlign: "left" }}>Axis</th>
            <th style={{ textAlign: "left" }}>Side</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const options = errorTargetOptions(columns, row.channel);
            const suggested = row.target !== null;
            return (
              <tr key={row.channel}>
                <td>{row.label}</td>
                <td>
                  <Select
                    aria-label={`${row.label} error target`}
                    options={[{ value: UNASSIGNED, label: "— unassigned —" }, ...options.map((o) => ({
                      value: String(o.value),
                      label: o.label,
                    }))]}
                    value={row.target === null ? UNASSIGNED : String(row.target)}
                    onChange={(e) =>
                      onTargetChange(row.channel, e.target.value === UNASSIGNED ? null : Number(e.target.value))
                    }
                  />
                  {suggested && (
                    <span
                      className="qzk-ds-meta"
                      style={{ color: "var(--text-faint)", marginLeft: 6 }}
                      title="Pre-filled from the column name — review before Import"
                    >
                      (suggested)
                    </span>
                  )}
                </td>
                <td>
                  <Select
                    aria-label={`${row.label} error axis`}
                    options={[
                      { value: "y", label: "y" },
                      { value: "x", label: "x" },
                    ]}
                    value={row.axis}
                    disabled={row.target === null}
                    onChange={(e) => onAxisChange(row.channel, e.target.value as "x" | "y")}
                  />
                </td>
                <td>
                  <Select
                    aria-label={`${row.label} error side`}
                    options={SIDE_OPTIONS}
                    value={row.side}
                    disabled={row.target === null}
                    onChange={(e) => onSideChange(row.channel, e.target.value as ErrorBinding["side"])}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

import type {
  ImportErrorBindingProblem,
  ImportErrorBindingWire,
  ImportPreviewColumn,
} from "../../../lib/types";
import { Button } from "../../primitives";

function columnName(columns: readonly ImportPreviewColumn[], index: number): string {
  if (index === -1) return "x axis";
  const column = columns.find((c) => c.index === index);
  return column?.effective_name ?? column?.name ?? `column ${index + 1}`;
}

export default function ErrorBindingSuggestions({
  columns,
  suggestions,
  problems,
  onApply,
}: {
  columns: ImportPreviewColumn[];
  suggestions: ImportErrorBindingWire[];
  problems: ImportErrorBindingProblem[];
  onApply: (binding: ImportErrorBindingWire) => void;
}) {
  const unapplied = suggestions.filter(
    (binding) => columns.find((column) => column.index === binding.column)?.role !== "error",
  );
  if (!unapplied.length && !problems.length) return null;

  return (
    <div style={{ margin: "10px 0" }}>
      {unapplied.length > 0 && (
        <div role="group" aria-label="Suggested error columns">
          <div className="qzk-ds-meta" style={{ color: "var(--text-faint)", marginBottom: 4 }}>
            Suggested error columns — review before applying
          </div>
          {unapplied.map((binding) => (
            <div key={binding.column} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
              <span>
                Use <strong>{columnName(columns, binding.column)}</strong> as {binding.axis}-error for{" "}
                <strong>{columnName(columns, binding.target)}</strong>
              </span>
              <Button size="sm" onClick={() => onApply(binding)}>Apply suggestion</Button>
            </div>
          ))}
        </div>
      )}
      {problems.length > 0 && (
        <div role="alert" className="qzk-ds-meta" style={{ color: "var(--danger)", marginTop: 6 }}>
          <strong>Saved error settings need attention:</strong>
          <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>
            {problems.map((problem, index) => <li key={`${problem.code}-${index}`}>{problem.reason}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

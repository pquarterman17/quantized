// Adapted from fermiviewer frontend/src/components/overlays/ResultsWindow.tsx.
// Floating, draggable results table (curve-fit params, peak tables, …) built on
// ToolWindow + the DataTable primitive, with CSV/JSON download. `id` is the
// caller's stable ToolWindow identity (GUI_INTERACTION_PLAN #10) — pass one
// per distinct results view so its position/size persist independently.

import ToolWindow from "./ToolWindow";
import { Button, DataTable } from "../primitives";

export interface ResultsData {
  title: string;
  columns: string[];
  rows: (string | number)[][];
}

function download(name: string, mime: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function toCSV(columns: string[], rows: (string | number)[][]): string {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
}

export default function ResultsWindow({
  id,
  data,
  onClose,
}: {
  id: string;
  data: ResultsData;
  onClose?: () => void;
}) {
  const stem = data.title.replace(/\s+/g, "_").toLowerCase();
  return (
    <ToolWindow id={id} title={data.title} width={420} onClose={onClose}>
      <DataTable columns={data.columns} rows={data.rows} />
      <div className="qz-btn-row">
        <Button
          size="sm"
          onClick={() => download(`${stem}.csv`, "text/csv", toCSV(data.columns, data.rows))}
        >
          Download CSV
        </Button>
        <Button
          size="sm"
          onClick={() =>
            download(
              `${stem}.json`,
              "application/json",
              JSON.stringify({ columns: data.columns, rows: data.rows }, null, 2),
            )
          }
        >
          Download JSON
        </Button>
      </div>
    </ToolWindow>
  );
}

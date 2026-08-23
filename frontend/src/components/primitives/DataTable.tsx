// Split out of primitives/index.tsx (R8 bundle-diet pass, 2026-08-23) — see
// that file's header comment for why: every consumer is a lazy workshop or
// Inspector panel, so this must not live in the eager barrel.
import type { ReactNode } from "react";

export function DataTable({
  columns,
  rows,
}: {
  columns: ReactNode[];
  rows: ReactNode[][];
}) {
  return (
    <table className="qz-table">
      <thead>
        <tr>
          {columns.map((c, i) => (
            <th key={i}>{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => (
              <td key={j}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

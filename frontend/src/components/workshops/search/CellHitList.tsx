// Cell-text results for Find in project: one row per (dataset, column) with
// how many rows match and a window around the first match. Never capped — the
// row count is bounded by the number of text columns, not by the data.

import { excerpt } from "../../../lib/projectSearch";
import { plural } from "../../../lib/plural";
import type { CellHit } from "./useCellSearch";

export default function CellHitList({
  hits,
  searching,
  needle,
  onReveal,
}: {
  hits: readonly CellHit[];
  searching: boolean;
  needle: string;
  onReveal: (hit: CellHit) => void;
}) {
  if (searching) {
    return (
      <div className="qzk-ds-meta" style={{ marginTop: 6, color: "var(--text-faint)" }}>
        Searching cell text…
      </div>
    );
  }
  return (
    <>
      {hits.map((hit) => (
        <button
          key={hit.id}
          className="qzk-menu-item"
          style={{ display: "flex", gap: 6, width: "100%", textAlign: "left" }}
          title={`Reveal row ${hit.firstRow + 1} in the worksheet`}
          onClick={() => onReveal(hit)}
        >
          <span className="qz-shortcut" style={{ width: 46, flex: "0 0 auto" }}>
            cell
          </span>
          <span className="qzk-menu-trunc" style={{ flex: 1 }}>
            {hit.column}: {excerpt(hit.firstText, needle, 32)}
          </span>
          <span className="qz-shortcut" style={{ color: "var(--text-faint)" }}>
            {hit.datasetName} · {hit.count} row{plural(hit.count)}
          </span>
        </button>
      ))}
    </>
  );
}

// Project-wide search (MAIN_PLAN #38).
//
// Deliberately REVEAL, not filter. The Library's own filter already narrows the
// dataset list; what was missing is finding the thing when you don't remember
// which dataset holds it — a column, a note, a report — and being taken to it.
// So a hit activates its dataset AND switches to the surface that can actually
// show it: a column opens the worksheet, because the Library can only show you
// the dataset it lives in, not the column inside it.

import { useMemo, useState } from "react";

import { searchProject, type SearchHit } from "../../../lib/projectSearch";
import { useApp } from "../../../store/useApp";
import ToolWindow from "../../overlays/ToolWindow";
import { NumberField } from "../../primitives/NumberField";

const KIND_CHIP: Record<SearchHit["kind"], string> = {
  dataset: "data",
  column: "col",
  note: "note",
  tag: "tag",
  metadata: "meta",
  report: "report",
  figure: "fig",
  folder: "folder",
};

export default function SearchPanel() {
  const setOpen = useApp((s) => s.setSearchOpen);
  const datasets = useApp((s) => s.datasets);
  const folders = useApp((s) => s.folders);
  const reports = useApp((s) => s.reports);
  const originFigures = useApp((s) => s.originFigures);
  const setActive = useApp((s) => s.setActive);
  const setStageTab = useApp((s) => s.setStageTab);
  const setStatus = useApp((s) => s.setStatus);
  const [query, setQuery] = useState("");

  const hits = useMemo(
    () =>
      searchProject(query, {
        datasets,
        folders,
        reports: reports?.map((r) => ({ id: r.id, name: r.name, datasetId: r.datasetId })),
        // An Origin figure has no display `name` of its own — it is identified
        // by the project stem it came from, which is what a user would search.
        figures: originFigures?.map((f) => ({ id: f.id, name: f.stem })),
      }),
    [query, datasets, folders, reports, originFigures],
  );

  const reveal = (hit: SearchHit) => {
    if (hit.datasetId) setActive(hit.datasetId);
    // The surface comes from the hit, not from a guess here — see projectSearch.
    if (hit.reveal === "worksheet") setStageTab("worksheet");
    else if (hit.reveal === "library" || hit.reveal === "figure") setStageTab("plot");
    setStatus(
      hit.channel != null ? `revealed ${hit.label} in ${hit.context}` : `revealed ${hit.label}`,
    );
    setOpen(false);
  };

  return (
    <ToolWindow id="search" title="Find in project" width={380} onClose={() => setOpen(false)}>
      <NumberField
        numeric={false}
        value={query}
        width={356}
        placeholder="dataset, column, tag, note, report…"
        title="Search names, column labels, tags, notes, metadata, reports and figures"
        onChange={setQuery}
      />
      {query.trim() === "" ? (
        <div className="qzk-ds-meta" style={{ marginTop: 8, color: "var(--text-faint)" }}>
          Searches every dataset — including columns and notes inside datasets
          you do not have open.
        </div>
      ) : hits.length === 0 ? (
        <div className="qzk-ds-meta" style={{ marginTop: 8, color: "var(--text-faint)" }}>
          No matches for &ldquo;{query.trim()}&rdquo;.
        </div>
      ) : (
        <div style={{ marginTop: 6 }}>
          {hits.map((hit) => (
            <button
              key={hit.id}
              className="qzk-menu-item"
              style={{ display: "flex", gap: 6, width: "100%", textAlign: "left" }}
              title={`Reveal in ${hit.reveal}`}
              onClick={() => reveal(hit)}
            >
              <span className="qz-shortcut" style={{ width: 46, flex: "0 0 auto" }}>
                {KIND_CHIP[hit.kind]}
              </span>
              <span className="qzk-menu-trunc" style={{ flex: 1 }}>
                {hit.label}
              </span>
              <span className="qz-shortcut" style={{ color: "var(--text-faint)" }}>
                {hit.context}
              </span>
            </button>
          ))}
        </div>
      )}
    </ToolWindow>
  );
}

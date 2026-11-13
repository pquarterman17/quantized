// Origin fidelity: graph windows the `.opju` figure decoder found in the file
// but could not recover (io/origin_project/opju_graph_pages.py). Each is
// named, and shown as Origin's own saved image when the file carries one
// that belongs to that page — a picture of the graph, not an editable plot.

import type { OriginUnrecoveredGraph } from "../../lib/originFidelityTypes";

export default function UnrecoveredGraphs({
  total,
  graphs,
}: {
  total: number;
  graphs: OriginUnrecoveredGraph[];
}) {
  if (total === 0) return null;
  const more = total - graphs.length;
  return (
    <div role="group" aria-label="Graphs not recovered" style={{ marginTop: 4 }}>
      <div className="qzk-ds-meta qzk-msg" role="note">
        <span style={{ color: "var(--accent)" }}>⚠</span>{" "}
        {total === 1 ? "1 graph is" : `${total} graphs are`} in the file but could not be
        recovered as an editable plot{graphs.some((g) => g.saved_preview) ? " — Origin's saved image is shown" : ""}:
      </div>
      {graphs.map((g) => (
        <figure key={g.page_name} style={{ margin: "4px 0" }}>
          {g.saved_preview && (
            <img
              src={`data:image/png;base64,${g.saved_preview.data}`}
              alt={`Origin's saved image of ${g.page_name}`}
              style={{ display: "block", maxWidth: "100%", border: "1px solid var(--border)" }}
            />
          )}
          <figcaption className="qzk-ds-meta" style={{ fontFamily: "var(--font-mono)" }}>
            {g.page_name}
            {g.saved_preview ? "" : " (no saved image)"}
          </figcaption>
        </figure>
      ))}
      {more > 0 && <div className="qzk-ds-meta">+{more} more</div>}
    </div>
  );
}

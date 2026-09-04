import {
  originFidelityLabel,
  originFidelityStatusLabel,
} from "../../lib/originFidelity";
import { useApp } from "../../store/useApp";
import { useLibraryStore } from "../../store/hooks/useLibraryStore";

export default function OriginFidelitySection() {
  const entries = useApp((s) => s.originFidelity);
  // UX-R3: this group is exactly the "low-value technical artifact" case the
  // spec calls out — decoder diagnostics (internal-filtered graph records,
  // preview-asset inventory) a reader almost never needs on the common path.
  // It defaults TUCKED (collapsed) rather than dropped: every manifest is
  // still here, one click away, never discarded to simplify the view.
  //
  // FU-2: this used to be a per-mount `useState`, which Library.tsx silently
  // reset every time it unmounted this section during search
  // (`{!searchActive && <OriginFidelitySection />}`) — a user's deliberate
  // expand was lost on the very next search. Lives in the store instead
  // (store/libraryPanel.ts's `originFidelitySectionExpanded`, same
  // session-only convention as `expandedWorkbookIds`) so it survives that
  // unmount/remount; still starts collapsed in a fresh session.
  const expanded = useLibraryStore((s) => s.originFidelitySectionExpanded);
  const toggleExpanded = useLibraryStore((s) => s.toggleOriginFidelitySectionExpanded);
  const collapsed = !expanded;
  if (entries.length === 0) return null;

  return (
    <div className="qzk-lib-group" aria-label="Origin import fidelity">
      <button className="qzk-group-head" onClick={toggleExpanded}>
        <span className="qzk-group-caret">{collapsed ? "▸" : "▾"}</span>
        <span className="qzk-group-name">Origin fidelity</span>
        <span className="qzk-group-count">{entries.length}</span>
      </button>
      {!collapsed &&
        entries.map((entry) => {
          const m = entry.manifest;
          return (
            <details className="qzk-fig-item" key={entry.id} style={{ display: "block" }}>
              <summary className="qzk-fig-name">
                {entry.stem} · {originFidelityStatusLabel(m.status)}
              </summary>
              <div className="qzk-ds-meta">
                {m.graph_records_actionable}/{m.graph_records_total} graph records editable
                {m.graph_records_filtered > 0 ? ` · ${m.graph_records_filtered} internal filtered` : ""}
              </div>
              <div className="qzk-ds-meta">
                Missing: {m.omissions.map(originFidelityLabel).join(", ")}
              </div>
              {m.filtered_figures.length > 0 && (
                <div className="qzk-ds-meta">
                  Filtered: {m.filtered_figures.map((f) => f.name).join(", ")}
                </div>
              )}
              {(m.preview_diagnostics?.length ?? 0) > 0 && (
                <div className="qzk-ds-meta">
                  Preview inventory: {m.preview_diagnostics!.filter((item) => item.status === "workbook_thumbnail").length} workbook thumbnails excluded
                  {m.preview_diagnostics!.some((item) => item.status === "ambiguous") ? " · ambiguous graph assets retained" : ""}
                </div>
              )}
            </details>
          );
        })}
    </div>
  );
}

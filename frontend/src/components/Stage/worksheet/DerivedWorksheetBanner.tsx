import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";

/** PR K (L0.50): the derived-worksheet identity banner + Freeze Copy action.
 *  Its own file since WorksheetPane reached the component ceiling. */
export default function DerivedWorksheetBanner({ ds }: { ds: Dataset }) {
  const freezeCopy = useApp((s) => s.freezeCopy);
  const sourceName = useApp((s) => s.datasets.find((d) => d.id === ds.derivedFrom?.datasetId)?.name);
  if (!ds.derivedFrom) return null;
  return (
    <div className="qzk-ds-meta" style={{ padding: "4px 8px", display: "flex", alignItems: "center", gap: 8 }}>
      <span title={`Pipeline: ${ds.derivedFrom.pipeline}`}>
        Derived worksheet — source: {sourceName ?? ds.derivedFrom.datasetId}
      </span>
      <button
        className="qz-btn"
        title="Create a permanent, independent snapshot of this worksheet's current data (link severed)"
        onClick={() => freezeCopy(ds.id)}
      >
        Freeze Copy
      </button>
    </div>
  );
}

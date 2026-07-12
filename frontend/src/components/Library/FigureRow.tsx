// One recovered Origin graph as a clickable Library row: click restores the
// figure's axis ranges + log flags to its bound dataset. An entry whose loose
// source reference didn't resolve to any imported book renders disabled, with
// the reason in its tooltip (never guesses at the wrong book). Shared by the
// flat FiguresSection (no-folders mode) and the folder tree, where the figure
// nests under its project folder at `depth` (plan item 5). The "⊞" button
// (item 9, MULTI_PLOT_PLAN) opens the SAME apply into a brand-new window
// instead of overwriting the focused one — the payoff for an `.opj` import
// with many graph windows.

import { originFidelityLabel, originFidelityStatusLabel } from "../../lib/originFidelity";
import { figureLabel, type OriginFigureEntry } from "../../lib/originFigures";
import { useApp } from "../../store/useApp";

export default function FigureRow({ entry, depth = 0 }: { entry: OriginFigureEntry; depth?: number }) {
  const applyOriginFigure = useApp((s) => s.applyOriginFigure);
  const resolved = entry.datasetId != null;
  const n = entry.figure.n_curves;
  const fidelity = entry.figure.fidelity;
  const fidelityText = fidelity
    ? `${originFidelityStatusLabel(fidelity.status)}; missing ${fidelity.omissions.map(originFidelityLabel).join(", ")}`
    : "Fidelity not assessed";
  const title = resolved
    ? `${entry.stem} — restore axis ranges (${n} curve${n === 1 ? "" : "s"}); ${fidelityText}`
    : `unresolved source "${entry.figure.source_hint || "unknown"}" — no matching imported book`;
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "stretch" }}>
      <button
        className="qzk-fig-item"
        disabled={!resolved}
        title={title}
        style={depth ? { marginLeft: depth * 14 } : undefined}
        onClick={() => applyOriginFigure(entry.id)}
      >
        <span className="qzk-fig-name">{figureLabel(entry)}</span>
        <span className="qzk-fig-meta">
          {entry.stem}{fidelity ? ` · ${fidelity.status === "exact" ? "=" : "≈"}` : ""}
        </span>
      </button>
      <button
        className="qz-icon-btn"
        title="Open in a new graph window"
        disabled={!resolved}
        onClick={() => applyOriginFigure(entry.id, { newWindow: true })}
      >
        ⊞
      </button>
    </div>
  );
}

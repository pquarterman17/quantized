// One recovered Origin graph as a clickable Library row: click restores the
// figure's axis ranges + log flags to its bound dataset. An entry whose loose
// source reference didn't resolve to any imported book renders disabled, with
// the reason in its tooltip (never guesses at the wrong book). Shared by the
// flat FiguresSection (no-folders mode) and the folder tree, where the figure
// nests under its project folder at `depth` (plan item 5).

import { figureLabel, type OriginFigureEntry } from "../../lib/originFigures";
import { useApp } from "../../store/useApp";

export default function FigureRow({ entry, depth = 0 }: { entry: OriginFigureEntry; depth?: number }) {
  const applyOriginFigure = useApp((s) => s.applyOriginFigure);
  const resolved = entry.datasetId != null;
  const n = entry.figure.n_curves;
  const title = resolved
    ? `${entry.stem} — restore axis ranges (${n} curve${n === 1 ? "" : "s"})`
    : `unresolved source "${entry.figure.source_hint || "unknown"}" — no matching imported book`;
  return (
    <button
      className="qzk-fig-item"
      disabled={!resolved}
      title={title}
      style={depth ? { marginLeft: depth * 14 } : undefined}
      onClick={() => applyOriginFigure(entry.id)}
    >
      <span className="qzk-fig-name">{figureLabel(entry)}</span>
      <span className="qzk-fig-meta">{entry.stem}</span>
    </button>
  );
}

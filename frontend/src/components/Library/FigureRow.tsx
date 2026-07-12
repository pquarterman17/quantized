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
import { resolveOriginFigureSources } from "../../lib/originSources";
import { useApp } from "../../store/useApp";

export default function FigureRow({ entry, depth = 0 }: { entry: OriginFigureEntry; depth?: number }) {
  const applyOriginFigure = useApp((s) => s.applyOriginFigure);
  const openOriginFigureSource = useApp((s) => s.openOriginFigureSource);
  const remakeOriginFigure = useApp((s) => s.remakeOriginFigure);
  const figures = useApp((s) => s.originFigures);
  const datasets = useApp((s) => s.datasets);
  const sourceResolution = resolveOriginFigureSources(entry, figures, datasets);
  const siblingDatasets = datasets.filter((ds) => entry.siblingIds.includes(ds.id));
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
      {sourceResolution.sources.map((source) => (
        <button
          key={source.datasetId}
          className="qz-icon-btn"
          title={`Open source workbook ${source.book}; select X/Y/error columns`}
          onClick={() => void openOriginFigureSource(entry.id, source.datasetId)}
        >
          ▦
        </button>
      ))}
      <button
        className="qz-icon-btn"
        title={sourceResolution.sources.length
          ? `Remake in Graph Builder${sourceResolution.unresolved.length ? ` (${sourceResolution.unresolved.length} unresolved binding${sourceResolution.unresolved.length === 1 ? "" : "s"})` : ""}`
          : `No decoded bindings; Origin hint: ${entry.figure.source_hint || "unknown"}`}
        disabled={sourceResolution.sources.length === 0}
        onClick={() => void remakeOriginFigure(entry.id)}
      >
        G
      </button>
      {sourceResolution.unresolved.length > 0 && siblingDatasets.length > 0 && (
        <select
          className="qz-select"
          aria-label={`Choose source workbook for ${figureLabel(entry)}`}
          title={`Unresolved Origin binding: ${sourceResolution.unresolved.map((item) => `${item.book}:${item.x},${item.y}`).join("; ")}`}
          defaultValue=""
          onChange={(event) => {
            if (event.target.value) void openOriginFigureSource(entry.id, event.target.value, { manual: true });
            event.currentTarget.value = "";
          }}
        >
          <option value="" disabled>Choose source…</option>
          {siblingDatasets.map((ds) => <option key={ds.id} value={ds.id}>{ds.name}</option>)}
        </select>
      )}
    </div>
  );
}

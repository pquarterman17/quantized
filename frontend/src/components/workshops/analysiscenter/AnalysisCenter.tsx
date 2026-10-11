import { useEffect, useMemo, useRef, useState } from "react";

import { ANALYSIS_CATEGORIES, analysisTools, matchesAnalysisSearch, type AnalysisCategory } from "../../../lib/analysisCenter";
import { useEscapeSurface } from "../../../lib/escapeStack";
import { useAnalysisCenter } from "../../../store/analysisCenter";
import { analysisCenterActions, launchAnalysisCenterTool, openAnalysisResult } from "../../../store/analysisCenterRun";
import { useApp } from "../../../store/useApp";
import { Button } from "../../primitives";
import AnalysisResultsList from "./AnalysisResultsList";
import AnalysisToolCard from "./AnalysisToolCard";
import "./analysisCenter.css";

type View = "recommended" | "recent" | "favorites" | "all" | "results";
const VIEWS: readonly { id: View; label: string }[] = [
  { id: "recommended", label: "Recommended" },
  { id: "recent", label: "Recent" },
  { id: "favorites", label: "Favorites" },
  { id: "all", label: "All tools" },
  { id: "results", label: "Existing results" },
];

export default function AnalysisCenter({ onClose, onBack }: { onClose: () => void; onBack: () => void }) {
  const dataset = useApp((state) => state.datasets.find((entry) => entry.id === state.activeId));
  const datasets = useApp((state) => state.datasets);
  const activeId = useApp((state) => state.activeId);
  const results = useApp((state) => state.analysisResults);
  const favorites = useAnalysisCenter((state) => state.favorites);
  const recent = useAnalysisCenter((state) => state.recent);
  const toggleFavorite = useAnalysisCenter((state) => state.toggleFavorite);
  const recordUse = useAnalysisCenter((state) => state.recordUse);
  const [view, setView] = useState<View>(dataset ? "recommended" : "all");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<AnalysisCategory | "all">("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const actions = useMemo(() => analysisCenterActions(), []);
  const tools = useMemo(() => analysisTools(actions, dataset), [actions, dataset]);

  useEscapeSurface("workspace", () => {
    onBack();
    return true;
  });

  useEffect(() => titleRef.current?.focus(), []);

  const rank = new Map(recent.map((id, index) => [id, index]));
  const visible = tools
    .filter((tool) => category === "all" || tool.category === category)
    .filter((tool) => matchesAnalysisSearch(tool, query))
    .filter((tool) => view === "all" || view === "results" || (view === "recommended" ? tool.recommended : view === "favorites" ? favorites.includes(tool.action.id) : rank.has(tool.action.id)))
    .sort((a, b) => view === "recent" ? (rank.get(a.action.id) ?? 999) - (rank.get(b.action.id) ?? 999) : a.action.label.localeCompare(b.action.label));

  const launch = async (toolId: string): Promise<void> => {
    const tool = tools.find((entry) => entry.action.id === toolId);
    if (!tool?.available || busyId) return;
    setBusyId(toolId);
    try {
      await launchAnalysisCenterTool(tool, activeId, () => {
        recordUse(toolId);
        onClose();
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="qzk-analysis-center" aria-labelledby="analysis-center-title">
      <header className="qzk-analysis-head">
        <div>
          <div className="qzk-analysis-eyebrow">Workflow</div>
          <h1 id="analysis-center-title" ref={titleRef} tabIndex={-1}>Analysis Center</h1>
          <p>Find the right analysis without guessing. Nothing runs until you explicitly open a tool.</p>
        </div>
        <div className="qzk-analysis-head-actions">
          <Button onClick={onBack}>Technique workflow</Button>
          <Button onClick={onClose}>Back to plot</Button>
        </div>
      </header>

      <div className="qzk-analysis-context" aria-label="Analysis context">
        <strong>{dataset ? dataset.name : "No worksheet selected"}</strong>
        <span>{dataset ? `${dataset.pending?.rows ?? Math.max(dataset.data.time.length, dataset.data.values.length)} rows · ${dataset.data.labels.length} columns` : "Dataset-independent tools remain available."}</span>
        <p>{dataset ? `${dataset.pending ? "Preview loaded; full data will load before a tool opens. " : ""}Tools use the current worksheet and retain their existing plotted-channel, selected-row, and range defaults where supported.` : "Select a worksheet to enable data analysis and see compatibility reasons."}</p>
      </div>

      <div className="qzk-analysis-controls">
        <label className="qzk-analysis-search">
          <span>Search tools and results</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="e.g. peaks, PCA, reflectivity…" />
        </label>
        {view !== "results" && (
          <label>
            <span>Category</span>
            <select value={category} onChange={(event) => setCategory(event.target.value as AnalysisCategory | "all")}>
              <option value="all">All categories</option>
              {ANALYSIS_CATEGORIES.map((entry) => <option key={entry}>{entry}</option>)}
            </select>
          </label>
        )}
      </div>

      <nav className="qzk-analysis-tabs" aria-label="Analysis Center sections">
        {VIEWS.map((entry) => (
          <button key={entry.id} type="button" className={view === entry.id ? "active" : ""} aria-current={view === entry.id ? "page" : undefined} onClick={() => setView(entry.id)}>
            {entry.label}
            {entry.id === "favorites" && favorites.length > 0 ? ` (${favorites.length})` : ""}
            {entry.id === "results" && results.length > 0 ? ` (${results.length})` : ""}
          </button>
        ))}
      </nav>

      {view === "results" ? (
        <AnalysisResultsList results={results} datasets={datasets} activeId={activeId} query={query} onOpen={openAnalysisResult} />
      ) : visible.length > 0 ? (
        <div className="qzk-analysis-grid">
          {visible.map((tool) => (
            <AnalysisToolCard
              key={tool.action.id}
              tool={tool}
              favorite={favorites.includes(tool.action.id)}
              busy={busyId === tool.action.id}
              blocked={busyId !== null}
              onFavorite={() => toggleFavorite(tool.action.id)}
              onOpen={() => void launch(tool.action.id)}
            />
          ))}
        </div>
      ) : (
        <div className="qzk-analysis-empty">
          {query.trim() ? "No tools match this search and category." :
            view === "recommended" ? "No tools can be recommended from the worksheet's declared technique and structure. Browse All tools to choose explicitly." :
            view === "recent" ? "Tools you open from this center will appear here." :
              view === "favorites" ? "Use the star on a tool to keep it here." : "No tools match this search and category."}
        </div>
      )}
    </section>
  );
}

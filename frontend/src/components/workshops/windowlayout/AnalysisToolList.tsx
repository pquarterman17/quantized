// The Analysis guide's tool list (WORKSPACE_LAYOUT_PLAN P4): every analysis
// tool, grouped by category, searchable. A tool that does not fit the dataset
// is greyed out with the shared one-line reason (lib/analysisCenter
// `analysisTools`, the Analysis Center's and the Analyze menu's own); a tool
// that suits the guide's technique is marked "suggested". Opening one goes
// through the Analysis Center's launch path; a tool already open is focused
// (one window per tool, D7).

import { useId, useMemo, useState, type RefObject } from "react";

import { ANALYSIS_CATEGORIES, ANALYSIS_TOOL_METADATA, analysisTools, matchesAnalysisSearch, type AnalysisTool } from "../../../lib/analysisCenter";
import { useMapGate } from "../../../lib/useMapGate";
import { effectiveTechnique } from "../../../lib/windowLayout/analysisGuide";
import type { Dataset } from "../../../lib/types";
import { analysisCenterActions } from "../../../store/analysisCenterRun";
import { launchFromAnalysis, notActiveReason } from "../../../store/analysisWindowActions";
import { useApp } from "../../../store/useApp";
import type { AnalysisHost } from "./analysisHost";

interface Props {
  dataset: Dataset | undefined;
  datasets: readonly Dataset[];
  host: AnalysisHost;
  headingRef?: RefObject<HTMLHeadingElement | null>;
}

export default function AnalysisToolList({ dataset, datasets, host, headingRef }: Props) {
  const headingId = useId();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const setStatus = useApp((s) => s.setStatus);
  // The live focus decides whether a pinned window's tools can run (they act on the active worksheet).
  const activeId = useApp((s) => s.activeId);
  const actions = useMemo(() => analysisCenterActions(), []);
  const mapGate = useMapGate(dataset?.data);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mapGate and activeId are recompute signals
  const tools = useMemo(() => analysisTools(actions, dataset, datasets), [actions, dataset, datasets, mapGate, activeId]);
  const eff = effectiveTechnique(dataset);
  const technique = eff.technique;
  const elsewhere = dataset ? notActiveReason(dataset.id) : null;
  // Only a KNOWN technique suggests anything: for unidentified data the generic tools would all be marked (UX pass 3 m-5).
  const suggested = (t: AnalysisTool) => eff.source !== "none" && t.available && !!ANALYSIS_TOOL_METADATA[t.action.id]?.recommendedFor?.includes(technique);
  const shown = tools.filter((t) => matchesAnalysisSearch(t, query));

  const open = async (tool: AnalysisTool) => {
    const reason = !tool.available ? tool.unavailableReason : tool.datasetRequired ? elsewhere : null;
    if (reason) {
      setStatus(reason, "warn");
      host.announce(reason);
      return;
    }
    if (busy) return;
    setBusy(tool.action.id);
    try {
      const focused = await launchFromAnalysis(tool, dataset?.id ?? null, host.focusOpenTool);
      if (focused) host.focusTool(focused);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="qzk-wl-an-section" aria-labelledby={headingId}>
      <h3 id={headingId} className="qzk-wl-an-heading" ref={headingRef} tabIndex={-1}>
        Tools
      </h3>
      <input
        className="qz-input qzk-wl-an-search"
        type="search"
        aria-label="Search analysis tools"
        placeholder="Search tools…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {shown.length === 0 && <p className="qzk-wl-an-dim">No tools match this search.</p>}
      {/* Always mounted, so a change of its text is announced (a region inserted with its text is often not). */}
      <span className="qz-sr-only" role="status">
        {query === "" ? "" : `${shown.length} ${shown.length === 1 ? "tool matches" : "tools match"} this search.`}
      </span>
      {ANALYSIS_CATEGORIES.map((category) => {
        const group = shown.filter((t) => t.category === category).sort((a, b) => Number(suggested(b)) - Number(suggested(a)) || a.action.label.localeCompare(b.action.label));
        if (!group.length) return null;
        return (
          <div key={category} className="qzk-wl-an-group" role="group" aria-label={category}>
            <div className="qzk-wl-an-cat">{category}</div>
            <ul className="qzk-wl-an-tools">
              {group.map((tool) => {
                const reason = !tool.available ? tool.unavailableReason : tool.datasetRequired ? elsewhere : null;
                const label = tool.action.label.replace(/…$/, "");
                return (
                  <li key={tool.action.id} className={`qzk-wl-an-tool${reason ? " unavailable" : ""}`} data-testid={`an-tool-${tool.action.id}`}>
                    <button
                      type="button"
                      className="qzk-wl-an-toolbtn"
                      aria-disabled={reason ? true : undefined}
                      aria-describedby={reason ? `${headingId}-${tool.action.id}` : undefined}
                      title={reason ?? tool.action.description}
                      onClick={() => void open(tool)}
                    >
                      {busy === tool.action.id ? `${label} (loading…)` : label}
                      {suggested(tool) && <span className="qzk-wl-an-badge">suggested</span>}
                    </button>
                    {reason && (
                      <span className="qzk-wl-an-reason" id={`${headingId}-${tool.action.id}`}>
                        {reason}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

// The result book shell (lane RB3, ANALYSIS_CAPABILITY_ROADMAP "Statistical
// engines ... feel like separate utilities"): ONE header + collapsible
// sections, shared by the saved-result book (analysisresults/resultbook) and
// the statistics tools' own panels, so a result reads the same way in the tool
// and in the Library.
//
// Header: the method, a status badge, a meta line, an optional input line,
// the settings, the warnings and a tools row (the host's actions, then Expand
// all / Collapse all). Sections render in the order given; hosts pass them in
// the one fixed order (summary, tables in saved order, plots, notes).
//
// Open state: `initialOpen` "first" (the saved book: the first section) or
// "all" (a tool panel: reads as before, collapse is opt-in). A section the
// user toggled keeps its state while sections come and go (a tool recomputes);
// Expand all / Collapse all reset every section. The state belongs to this
// view: a host that shows a different result remounts it (React `key`).

import { useState, type ReactNode } from "react";

import { Button } from "../../primitives";
import ResultBookSection, { type ResultBookSectionSpec } from "./ResultBookSection";
import "./resultBook.css";

export type { ResultBookSectionSpec };

export interface ResultBookSettingItem { label: string; value: string }

type Base = "first" | "all" | "none";

export default function ResultBookShell({
  method, status, meta, input, settings, warnings, tools, sections, initialOpen, empty, label,
}: {
  method: string;
  /** Status badge text ("Current", "Out of date", "Live", "Saved"). */
  status?: string;
  meta?: ReactNode;
  /** The input line (the shared AnalysisInputSummary, or the saved text). */
  input?: ReactNode;
  settings?: readonly ResultBookSettingItem[];
  warnings?: readonly string[];
  /** The host's header actions, before Expand all / Collapse all. */
  tools?: ReactNode;
  sections: readonly ResultBookSectionSpec[];
  initialOpen: "first" | "all";
  /** Shown when there are no sections. */
  empty?: ReactNode;
  /** Accessible name of the book region (default: none, a plain container). */
  label?: string;
}) {
  const [base, setBase] = useState<Base>(initialOpen);
  const [firstKey] = useState(() => sections[0]?.key ?? null);
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  // Expand all also opens the sections a tool starts collapsed.
  const [expanded, setExpanded] = useState(false);
  const collapsedByDefault = new Set(sections.filter((section) => section.startCollapsed).map((section) => section.key));
  const defaultOpen = (key: string): boolean =>
    base === "all" ? expanded || !collapsedByDefault.has(key) : base === "first" && key === firstKey;
  const isOpen = (key: string): boolean => toggled.get(key) ?? defaultOpen(key);
  const reset = (next: Base) => { setBase(next); setExpanded(next === "all"); setToggled(new Map()); };
  const toggle = (key: string) => setToggled((now) => new Map(now).set(key, !(now.get(key) ?? defaultOpen(key))));
  return <div className="qz-result-book" {...(label ? { role: "region", "aria-label": label } : {})}>
    <header className="qz-result-book-head">
      <div className="qz-result-book-title">
        <h3>{method}</h3>
        {status && <span className={`qz-analysis-status status-${status.toLowerCase().replaceAll(" ", "-")}`}>{status}</span>}
        {meta && <span className="qz-result-book-meta">{meta}</span>}
      </div>
      {input}
      {!!settings?.length && <dl className="qz-result-book-settings" aria-label="Settings">
        {settings.map((setting) => <div key={setting.label}><dt>{setting.label}</dt><dd>{setting.value}</dd></div>)}
      </dl>}
      {!!warnings?.length && <ul className="qz-result-book-warnings" aria-label="Warnings">
        {warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}
      </ul>}
      <div className="qz-result-book-tools">
        {tools}
        <Button size="sm" disabled={!sections.length} onClick={() => reset("all")}>Expand all</Button>
        <Button size="sm" disabled={!sections.length} onClick={() => reset("none")}>Collapse all</Button>
      </div>
    </header>
    {sections.length
      ? sections.map((section) => <ResultBookSection key={section.key} spec={section}
        open={isOpen(section.key)} onToggle={() => toggle(section.key)} />)
      : empty ?? <p className="qz-analysis-empty">No saved tables or figures are available.</p>}
  </div>;
}

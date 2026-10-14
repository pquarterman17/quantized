import type { KeyboardEvent } from "react";

export type AnalysisResultTab = "overview" | "table" | "figures" | "diagnostics" | "provenance" | "notes";

const TABS: readonly AnalysisResultTab[] = ["overview", "table", "figures", "diagnostics", "provenance", "notes"];

export default function AnalysisResultTabs({ active, diagnostics, onChange }: {
  active: AnalysisResultTab;
  diagnostics: number;
  onChange: (tab: AnalysisResultTab) => void;
}) {
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const offset = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const next = event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1
      : offset ? (index + offset + TABS.length) % TABS.length : -1;
    if (next < 0) return;
    event.preventDefault();
    onChange(TABS[next]);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
  };

  return <div className="qz-analysis-tabs" role="tablist" aria-label="Analysis result views">
    {TABS.map((value, index) => (
      <button key={value} id={`analysis-result-tab-${value}`} role="tab" aria-controls="analysis-result-tabpanel"
        aria-selected={active === value} tabIndex={active === value ? 0 : -1} className={active === value ? "active" : ""}
        onKeyDown={(event) => move(event, index)} onClick={() => onChange(value)}>
        {value[0].toUpperCase() + value.slice(1)}{value === "diagnostics" && diagnostics ? ` (${diagnostics})` : ""}
      </button>
    ))}
  </div>;
}

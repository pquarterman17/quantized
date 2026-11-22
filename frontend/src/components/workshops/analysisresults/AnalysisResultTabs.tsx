import type { KeyboardEvent } from "react";

export type AnalysisResultTab = "overview" | "book" | "table" | "figures" | "diagnostics" | "provenance" | "notes";

const ALL_TABS: readonly AnalysisResultTab[] = ["overview", "book", "table", "figures", "diagnostics", "provenance", "notes"];
const LABELS: Readonly<Partial<Record<AnalysisResultTab, string>>> = { book: "Result book" };

/** `book`: offer the Result book view (saved statistics results with a book,
 *  lib/resultBook). It is an added view; Overview stays the default. */
export default function AnalysisResultTabs({ active, diagnostics, onChange, book = false }: {
  active: AnalysisResultTab;
  diagnostics: number;
  onChange: (tab: AnalysisResultTab) => void;
  book?: boolean;
}) {
  const TABS = book ? ALL_TABS : ALL_TABS.filter((tab) => tab !== "book");
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
        {LABELS[value] ?? value[0].toUpperCase() + value.slice(1)}{value === "diagnostics" && diagnostics ? ` (${diagnostics})` : ""}
      </button>
    ))}
  </div>;
}

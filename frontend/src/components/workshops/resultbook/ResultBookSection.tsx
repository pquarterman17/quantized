// One collapsible section of a result book (lane RB3, extracted from the RB
// saved book). The header (title, kind label, actions) is always visible, so
// every section's actions work collapsed; the body renders only when open.

import type { ReactNode } from "react";

export interface ResultBookSectionSpec {
  /** Stable within the book (the open state is keyed by it). */
  key: string;
  kind: "summary" | "table" | "figure" | "notes";
  title: string;
  /** Kind label shown beside the title ("Table · 3 × 6", "Figure", "Plot"). */
  meta?: string;
  actions?: ReactNode;
  /** Starts collapsed even in a book that opens every section (a tool's
   *  table it did not show before the book). Expand all opens it. */
  startCollapsed?: boolean;
  render: () => ReactNode;
}

const KIND_LABEL: Readonly<Record<ResultBookSectionSpec["kind"], string>> = {
  summary: "Summary", table: "Table", figure: "Figure", notes: "Notes",
};

export default function ResultBookSection({ spec, open, onToggle }: {
  spec: ResultBookSectionSpec;
  open: boolean;
  onToggle: () => void;
}) {
  const bodyId = `result-book-${spec.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  return <section className="qz-result-book-section" data-kind={spec.kind} aria-label={spec.title}>
    <header>
      <h4>
        <button type="button" className="qz-result-book-toggle" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
          <span aria-hidden="true">{open ? "▾" : "▸"}</span> {spec.title}
        </button>
      </h4>
      <span className="qz-result-book-meta">{spec.meta ?? KIND_LABEL[spec.kind]}</span>
      {spec.actions && <span className="qz-result-book-actions">{spec.actions}</span>}
    </header>
    {open && <div id={bodyId} className="qz-result-book-body">{spec.render()}</div>}
  </section>;
}

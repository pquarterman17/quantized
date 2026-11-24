// One collapsible section of a result book (lane RB3, extracted from the RB
// saved book). The header (title, kind label, actions) is always visible, so
// every section's actions work collapsed; the body renders only when open.

import { isValidElement, useState, type MouseEvent, type ReactNode } from "react";

import ContextMenu, { type ContextMenuItem } from "../../overlays/ContextMenu";
import { useApp } from "../../../store/useApp";
import { toolTableMenu, ToolTableActions } from "./ToolBookActions";
import type { Say } from "./tableMenu";

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
  /** The section's right-click menu (a table's Copy / Export / Send to report
   *  ...). A tool section that offers `<ToolTableActions>` gets its menu from
   *  them without naming it here. */
  menu?: (say: Say) => ContextMenuItem[];
}

function menuOf(spec: ResultBookSectionSpec): ((say: Say) => ContextMenuItem[]) | null {
  if (spec.menu) return spec.menu;
  const a = spec.actions;
  return isValidElement<{ book: Parameters<typeof toolTableMenu>[0]; title: string }>(a) && a.type === ToolTableActions
    ? (say) => toolTableMenu(a.props.book, a.props.title, say) : null;
}

const KIND_LABEL: Readonly<Record<ResultBookSectionSpec["kind"], string>> = {
  summary: "Summary", table: "Table", figure: "Figure", notes: "Notes",
};

export default function ResultBookSection({ spec, open, onToggle }: {
  spec: ResultBookSectionSpec;
  open: boolean;
  onToggle: () => void;
}) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const menu = menuOf(spec);
  const say = useApp((s) => s.setStatus);
  // Right-click anywhere on a table section (heading, cell, header row) opens
  // its menu; text fields keep the native one.
  const onContextMenu = (e: MouseEvent) => {
    if (!menu || (e.target as Element).closest("input, textarea, select")) return;
    e.preventDefault();
    setAt({ x: e.clientX, y: e.clientY });
  };
  const bodyId = `result-book-${spec.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  return <section className="qz-result-book-section" data-kind={spec.kind} aria-label={spec.title} onContextMenu={onContextMenu}>
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
    {at && menu && <ContextMenu x={at.x} y={at.y} items={menu(say)} help={{ label: "result tables", query: "worksheet" }} onClose={() => setAt(null)} />}
  </section>;
}

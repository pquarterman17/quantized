// The export view's action row (UX-H review item 5), under the preview:
// Close (Cancel while there are unpublished figure edits), the secondary
// "Apply to plot" and ONE filled primary, the format-aware "Export PDF…",
// bottom-right. The preview column is sticky (top) and this row sticks to
// the bottom of the window's scroller, so it stays in reach however long the
// settings column runs and however short the window is resized.

import { Button } from "../../primitives";

export default function ExportFooter({
  fmt, onExport, exportDisabledReason, canonical, detached, dirty, canApply, applyBlockedReason, onApply, onClose, revision = null,
}: {
  fmt: string;
  onExport: () => void;
  /** Non-null disables Export and explains why (as the button's tooltip). */
  exportDisabledReason: string | null;
  canonical: boolean;
  /** A detached draft: applying creates a new editable figure. */
  detached: boolean;
  dirty: boolean;
  canApply: boolean;
  applyBlockedReason: string | null;
  onApply: () => void;
  onClose: () => void;
  /** The figure revision Export writes (lib/figureRevision); null for a legacy preview. */
  revision?: string | null;
}) {
  return (
    <div
      style={{
        display: "flex", flexDirection: "column", gap: 6, paddingTop: 8, borderTop: "1px solid var(--border-soft)",
        // The scroller (.qzk-win-body) has `--pad-lg` bottom padding: stick
        // past it and add it back inside, so the row sits flush and opaque.
        position: "sticky", bottom: "calc(var(--pad-lg) * -1)", paddingBottom: "var(--pad-lg)", background: "var(--surface-2)",
      }}
    >
      {canonical && applyBlockedReason && (
        <div role="alert" className="qzk-msg" style={{ color: "var(--danger)", fontSize: "var(--font-size-sm)" }}>
          {applyBlockedReason}
        </div>
      )}
      <div role="group" aria-label="Export actions" style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
        {canonical && revision && (
          <span title="Export writes exactly this revision of the figure; it changes when the figure does." style={{ marginRight: "auto", color: "var(--text-dim)", fontSize: "var(--font-size-sm)", fontFamily: "var(--font-mono)" }}>
            Revision {revision}
          </span>
        )}
        <Button onClick={onClose}>{canonical && dirty ? "Cancel" : "Close"}</Button>
        {canonical && (
          <Button onClick={onApply} disabled={!canApply} title={applyBlockedReason ?? undefined}>
            {detached ? "Create Editable Figure" : "Apply to plot"}
          </Button>
        )}
        {/* A disabled <button> gets no pointer events (.qz-btn:disabled), so
            the reason lives on a wrapper the tooltip can reach. */}
        <span title={exportDisabledReason ?? undefined}>
          <Button variant="primary" onClick={onExport} disabled={exportDisabledReason !== null}>
            Export {fmt.toUpperCase()}…
          </Button>
        </span>
      </div>
    </div>
  );
}

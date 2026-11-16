// The export view's action row (UX-H review item 5), under the preview:
// Close (Cancel while there are unpublished figure edits), the secondary
// "Apply to plot" and ONE filled primary, the format-aware "Export PDF…",
// bottom-right. The preview column is sticky, so this row stays in reach
// however long the settings column runs.

import { Button } from "../../primitives";

export default function ExportFooter({
  fmt, onExport, exportDisabledReason, canonical, detached, dirty, canApply, applyBlockedReason, onApply, onClose,
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
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 8, borderTop: "1px solid var(--border-soft)" }}>
      {canonical && applyBlockedReason && (
        <div role="alert" className="qzk-msg" style={{ color: "var(--danger)", fontSize: "var(--font-size-sm)" }}>
          {applyBlockedReason}
        </div>
      )}
      <div role="group" aria-label="Export actions" style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
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

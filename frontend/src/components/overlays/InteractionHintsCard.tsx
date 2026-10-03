// The interaction-hints card itself, loaded on demand by InteractionHints.tsx
// (which stays eager: it owns the Help-menu reopen listener and the gate).

import { Button } from "../primitives";

export default function InteractionHintsCard({ onDismiss }: { onDismiss: () => void }) {
  return (
    // pointer-events:none so this first-run card NEVER blocks interaction with
    // the Inspector cards it overlaps in the lower-right — it's a hint, not a
    // modal. Only the "Got it" button re-enables pointer events. (This also
    // fixed 10 e2e tests: a fresh Playwright session has no `seen` flag, so
    // the card rendered over the Annotations card and swallowed their clicks.)
    <aside
      className="qzk-glass"
      aria-label="Interaction hints"
      style={{
        position: "fixed",
        right: 16,
        bottom: 34,
        width: 310,
        zIndex: 1200,
        padding: 12,
        pointerEvents: "none",
      }}
    >
      <strong>Three fast ways to work</strong>
      <ul style={{ margin: "8px 0 10px", paddingLeft: 20, lineHeight: 1.55 }}>
        <li>Right-click a curve, axis, legend, or empty plot area for relevant actions.</li>
        <li>Double-click a plot object to edit its properties.</li>
        <li>Drag worksheet channels onto the X, Y, or Y2 plot edges.</li>
      </ul>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="qz-hint">Help ▸ Show interaction hints reopens this.</span>
        <Button size="sm" onClick={onDismiss} style={{ pointerEvents: "auto" }}>
          Got it
        </Button>
      </div>
    </aside>
  );
}

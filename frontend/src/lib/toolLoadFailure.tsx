// The card a floating tool panel or dialog shows when its code could not load
// (`lazyRegion(..., tool = true)`, AppOverlayPanels' lazyPanel; UX audit 8
// #9). It used to read "CurveFitPanel failed to load." in the app grid,
// which exposed a component name and pushed the status bar into the stage.
// Now it:
// - names no component (the label stays in its tooltip and the console log);
// - says "(server unreachable)" while a socket that WAS connected is closed,
//   reactively (it drops the suffix on reconnect), and never on a page that
//   never had a server (the offline demo, tests);
// - floats in one fixed stack portalled to <body>, so two failed panels
//   stack instead of covering each other, and has a × to put it away.

import { useState } from "react";
import { createPortal } from "react-dom";

import { everConnected } from "./connectionSeen";
import { useConnection } from "./lifecycle";

/** "This tool" for a panel / view, "This dialog" for a dialog, by its label. */
const noun = (label: string): string =>
  /Dialog$/.test(label) ? "This dialog" : /(Panels?|View)$/.test(label) ? "This tool" : "This window";

/** The one fixed column every failed card is portalled into. */
function stack(): HTMLElement {
  return (
    document.querySelector<HTMLElement>(".qzk-lazy-fail-stack") ??
    document.body.appendChild(Object.assign(document.createElement("div"), { className: "qzk-lazy-fail-stack" }))
  );
}

export default function ToolLoadFailure({ label, onRetry, error }: { label: string; onRetry: () => void; error?: Error }) {
  const connected = useConnection((s) => s.connected);
  const [closed, setClosed] = useState(false);
  if (closed) return null;
  const why = !connected && everConnected() ? " (server unreachable)" : "";
  return createPortal(
    <div className="qzk-lazy-fail tool" role="alert" title={label}>
      {/* `data-live-region` (R12, lib/modalInert.ts): announced even under an open dialog. */}
      <span data-live-region="">⚠ {error ? "This panel hit an error: " + error.message : `${noun(label)} couldn't load${why}.`}</span>
      <button type="button" onClick={onRetry}>
        ↻ Retry
      </button>
      <button type="button" className="qzk-lazy-fail-close" aria-label="Dismiss" onClick={() => setClosed(true)} />
    </div>,
    stack(),
  );
}

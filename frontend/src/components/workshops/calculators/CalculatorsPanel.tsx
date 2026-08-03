// Calculators workshop — a draggable ToolWindow wrapping CalculatorsContent
// (the tab selector + active tab; see CalculatorsContent.tsx). Split out
// (MAIN_PLAN #22) so the standalone calc-only SPA view (CalcOnlyApp,
// ?view=calc) can mount the same content full-window without this chrome.
//
// width/y (owner report, 2026-08-02): the panel opened at ToolWindow's
// generic 360x(auto)@(120,90) default, and every card-heavy tab from
// Electrical onward (calc.electrical..superconductor — see the TAB_GROUPS
// "Transport"/"Optics & Vacuum"/"Devices" groups in CalculatorsContent.tsx)
// needed a manual resize before its options were reachable. Root cause: each
// card ROW (shared.tsx) wraps its Fields onto extra lines once the row's
// natural width exceeds the body, and ToolWindow's height is pure
// content-fit clamped by `max-height: calc(100% - 24px)` (shell.css) — a
// narrow box inflates wrapped-row height until a *fixed* max-height (it
// doesn't know about the panel's own y offset) clips the bottom against the
// viewport, which `body{overflow:hidden}` then makes unreachable. 480 (this
// in-app ToolWindow only — the standalone calc-only shell's own column widened
// to 560px in the 2026-08-02 audit, `.qzk-calc-body{max-width:560px}` in
// shell.css, since its window is wider) keeps a typical 2-3-field card row on
// one line; y=70 (matching
// ReflView/Waterfall's precedent, just below the 68px titlebar+menubar
// chrome) reclaims the vertical headroom the default y=90 was spending
// before the clamp even engages. Very card-dense tabs (Semiconductor/
// Superconductor, 11+ cards) still need the ToolWindow body's own
// `overflow-y: auto` scroll — that's expected, matching every other
// content-heavy ToolWindow in the app (tabulate, importwizard, ...).

import ToolWindow from "../../overlays/ToolWindow";
import { useApp } from "../../../store/useApp";
import CalculatorsContent from "./CalculatorsContent";

export default function CalculatorsPanel() {
  const setOpen = useApp((s) => s.setCalculatorsOpen);

  return (
    <ToolWindow id="calculators" title="Calculators" y={70} width={480} onClose={() => setOpen(false)}>
      <CalculatorsContent />
    </ToolWindow>
  );
}

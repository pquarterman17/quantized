// Calculators workshop — a draggable ToolWindow wrapping CalculatorsContent
// (the tab selector + active tab; see CalculatorsContent.tsx). Split out
// (MAIN_PLAN #22) so the standalone calc-only SPA view (CalcOnlyApp,
// ?view=calc) can mount the same content full-window without this chrome.

import ToolWindow from "../../overlays/ToolWindow";
import { useApp } from "../../../store/useApp";
import CalculatorsContent from "./CalculatorsContent";

export default function CalculatorsPanel() {
  const setOpen = useApp((s) => s.setCalculatorsOpen);

  return (
    <ToolWindow title="Calculators" width={360} onClose={() => setOpen(false)}>
      <CalculatorsContent />
    </ToolWindow>
  );
}

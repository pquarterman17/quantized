// The in-app Quick Convert: a floating tool window around the same view
// (File > Export > Quick Convert…). Esc and the title-bar close come from
// ToolWindow; the chooser inside swallows its own Esc first.

import { useQuickConvertPanel } from "../../../store/quickConvertPanel";
import ToolWindow from "../../overlays/ToolWindow";
import QuickConvertView from "./QuickConvertView";

export function QuickConvertPanel() {
  const close = useQuickConvertPanel((s) => s.close);
  return (
    <ToolWindow id="quick-convert" title="Quick convert" width={760} onClose={close}>
      <QuickConvertView />
    </ToolWindow>
  );
}

export default QuickConvertPanel;

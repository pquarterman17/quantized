// The shared frame of the three learning-aid dialogs (plan item 45): backdrop,
// focus trap, Esc on the modal layer, a title and a Close button.

import { useId, useRef, type ReactNode } from "react";

import { useEscapeSurface } from "../../../lib/escapeStack";
import { Button } from "../../primitives";
import { useDialogFocus } from "../useDialogFocus";

export default function LearningModal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  useEscapeSurface("modal", () => { onClose(); return true; }, true);
  useDialogFocus(ref, true);
  return (
    <div className="qz-overlay-backdrop" onMouseDown={onClose}>
      <div className="qzk-glass qz-dialog" role="dialog" aria-labelledby={titleId} ref={ref} tabIndex={-1} style={{ width: wide ? 640 : 460, maxWidth: "94vw" }} onMouseDown={(e) => e.stopPropagation()}>
        <h2 id={titleId}>{title}</h2>
        {children}
        <div className="qz-btn-row">
          {footer}
          <Button variant="primary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}

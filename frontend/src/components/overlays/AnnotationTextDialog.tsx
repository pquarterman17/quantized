// Promise-based annotation-text editor (MAIN #25 discoverability): the
// pointer-tool double-click-to-edit / object-menu "Edit text…" entry opens
// THIS instead of a plain-text askParams field, so annotation labels get the
// SAME RichLabelInput editor (Ω symbol palette + live preview + validate())
// TitlesCard already uses for the title/axis labels — one editor, one
// `$...$` micro-syntax (GOTO #5), everywhere a plot label is typed.
// askParams' generic ParamField schema ("number"|"select"|"boolean"|"text")
// is shared platform code ported from fermiviewer (see params.ts's header)
// and has no slot for a custom field component, so this is a dedicated
// dialog rather than a widened ParamField type — modeled directly on
// ParamDialog/ConfirmDialog's promise+zustand pattern and chrome
// (`qz-overlay-backdrop` / `qzk-glass qz-dialog` / `qz-btn-row`) so it reads
// as the same family of dialog, not a one-off.
//
// The `askAnnotationText()` function and its store live in
// `store/annotationTextDialog.ts`, not here (bundle-size pass 2026-08-18):
// `components/Stage/useShapeDraw.ts` is part of the always-eager Stage tree
// and only ever calls `askAnnotationText()`, never renders this component,
// so keeping the store in its own tiny module lets that eager call site
// avoid pulling in RichLabelInput's SymbolPalette (the Omega symbol grid)
// and this file becomes a LAZY `AppOverlays.tsx` panel like
// SplitDatasetDialog/QuickPlotWithDialog.

import { useEffect, useState } from "react";

import { Button } from "../primitives";
import RichLabelInput from "../primitives/RichLabelInput";
import { useAnnotationTextDialog } from "../../store/annotationTextDialog";

export default function AnnotationTextDialog() {
  const title = useAnnotationTextDialog((s) => s.title);
  const initial = useAnnotationTextDialog((s) => s.initial);
  const resolve = useAnnotationTextDialog((s) => s.resolve);
  const close = useAnnotationTextDialog((s) => s.close);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (title !== null) setDraft(initial);
  }, [title, initial]);

  if (title === null) return null;

  const finish = (v: string | null) => {
    resolve?.(v);
    close();
  };

  // `live` keeps `draft` (this component's own state, what "Done" reads)
  // in sync on every keystroke rather than only on RichLabelInput's own
  // blur/Enter commit — a mouse click on "Done" without first blurring the
  // field must still see the just-typed text, not a stale value.
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") finish(draft);
    if (e.key === "Escape") finish(null);
    e.stopPropagation();
  };

  return (
    <div className="qz-overlay-backdrop" onMouseDown={() => finish(null)}>
      <div className="qzk-glass qz-dialog" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <h2>{title}</h2>
        <div className="qz-ws-row">
          <span className="k">Text</span>
          <RichLabelInput value={draft} placeholder="label text" onCommit={setDraft} live />
        </div>
        <div className="qz-btn-row">
          <Button onClick={() => finish(null)}>Cancel</Button>
          <Button variant="primary" onClick={() => finish(draft)}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}

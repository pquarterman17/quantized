// "Is this keystroke the FIELD's, not the app's?" — the predicate that guards
// every global single-key binding in the app (Delete/Backspace removal, the
// Escape tool-cancel, `?`, the tool letters, a workshop window's
// Escape-to-close). It was hand-rolled identically in three places
// (`useGlobalShortcuts`, `components/windows/useWindowCommands`, and the
// P3.3 `ToolWindow` Escape); this is that one copy, so a future exemption
// (say, a new editable custom element) is added once rather than three times.
//
// `components/history/useHistoryCommands.ts` deliberately keeps its OWN,
// WIDER variant: Ctrl+Z inside a range/checkbox/radio input has no text to
// undo, so that one hands the key back to the app. It is a different question
// from "is the user typing", and folding it in here would silently change the
// four call sites above.
export function isEditingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

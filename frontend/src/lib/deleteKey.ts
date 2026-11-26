// The one definition of "this keydown means delete". A Delete or Backspace held
// with Ctrl, Cmd or Alt is a chord (repeat last, reopen last dialog, word-delete
// in a field), never a delete: the global repeat chord is Ctrl/Cmd+Backspace, and
// a row handler that read it as a delete opened "Move to trash" over it. Shift
// alone still deletes (Shift+Delete is the usual "delete for good" spelling).
// Every delete-on-key handler asks this instead of comparing `key` itself, so a
// modified key falls through untouched to the global shortcut layer.

// Modifiers are optional so a narrowed event type still fits; absent means not held.
type KeyLike = Pick<KeyboardEvent, "key"> & Partial<Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "altKey">>;

export function isDeleteKey(e: KeyLike): boolean {
  return (e.key === "Delete" || e.key === "Backspace") && !e.ctrlKey && !e.metaKey && !e.altKey;
}

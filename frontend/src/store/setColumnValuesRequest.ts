// "Set Column Values…" from the command palette / Data menu. The dialog is
// owned by the worksheet pane (it needs that sheet's view), which may not be
// mounted yet when the command runs (the command also switches to the
// Worksheet tab). So the request is a tiny pending flag the pane consumes on
// mount and on every later request — same intent as the Ctrl+Q path, which
// opens the dialog on a NEW column.

type Listener = () => void;

let pending = false;
const listeners = new Set<Listener>();

/** Ask the worksheet pane to open Set Column Values… (new column). */
export function requestSetColumnValues(): void {
  pending = true;
  for (const l of [...listeners]) l();
}

/** True once per request; the pane calls it on mount and on each notify. */
export function consumeSetColumnValuesRequest(): boolean {
  const was = pending;
  pending = false;
  return was;
}

export function onSetColumnValuesRequest(l: Listener): () => void {
  listeners.add(l);
  return () => void listeners.delete(l);
}

// Fire an Escape the way the shared registry (`lib/escapeStack.ts`) sees it,
// and wait for its decision.
//
// The registry dispatches on window-bubble — the last stop on the propagation
// path, so everything that owns Escape by stopping propagation keeps owning it
// — and then defers the walk ONE MACROTASK before re-reading
// `defaultPrevented`, which is how a panel hook that claims the key with
// `preventDefault()` still outranks its own window whatever order it
// registered in. A surface's close is therefore never synchronous with the
// keystroke, and a bare `fireEvent.keyDown` asserts against the state BEFORE
// the walk has run. `userEvent.keyboard("{Escape}")` already yields long
// enough; this is for the `fireEvent` call sites.

import { act, fireEvent } from "@testing-library/react";

export async function pressEscape(
  target: Window | Document | Element = window,
  init: Record<string, unknown> = {},
): Promise<void> {
  fireEvent.keyDown(target, { key: "Escape", ...init });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

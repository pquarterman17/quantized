// One compact Help footer per context menu. This is deliberately menu-level:
// putting a separate question-mark button on every command row would clutter
// the fast action path and create nested interactive controls.
//
// The footer is an ordinary `{label, run}` row, so it inherits every menu
// contract for free: role="menuitem", ArrowUp/Down/Home/End reach it, and it
// closes the menu before `run` fires. Two details are specific to it:
//  * The label starts with a LETTER ("Help with …"), never a glyph — the
//    menu's type-ahead matches a label's first character, so a leading "?"
//    made the footer unreachable by pressing H, and a screen reader announced
//    "question mark" before every footer.
//  * `run` hands focus back to the element the menu was opened from BEFORE
//    opening Help. Help remembers its opener at render time
//    (useDialogFocus.ts `useOpenerCapture`); without this it remembered the
//    footer button itself, which the closing menu then removed, so Escape
//    from Help fell back to the Library list / app root instead of returning
//    to the dataset row or window the user right-clicked.

import type { ContextMenuItem } from "./contextMenuTypes";
import { openHelpTopic } from "../../store/help";

export interface ContextMenuHelp {
  /** Human-readable object name used in the footer label ("Help with <label>…"). */
  label: string;
  /** Search text for the existing Help topic index. contextMenuHelp.test.ts
   *  pins the top result each seeded query lands on. */
  query: string;
}

export function appendContextHelp(
  items: ContextMenuItem[],
  help: ContextMenuHelp | undefined,
  opener: HTMLElement | null = null,
): ContextMenuItem[] {
  if (!help) return items;
  const separator = items.length > 0 && !("separator" in items[items.length - 1])
    ? [{ separator: true } as const]
    : [];
  return [
    ...items,
    ...separator,
    {
      label: `Help with ${help.label}…`,
      run: () => {
        if (opener && opener !== document.body && opener.isConnected) opener.focus({ preventScroll: true });
        openHelpTopic(help.query);
      },
    },
  ];
}

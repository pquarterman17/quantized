// One compact Help footer per context menu. This is deliberately menu-level:
// putting a separate question-mark button on every command row would clutter
// the fast action path and create nested interactive controls.

import type { ContextMenuItem } from "./ContextMenu";
import { openHelpTopic } from "../../store/help";

export interface ContextMenuHelp {
  /** Human-readable object name used in the footer label. */
  label: string;
  /** Search text for the existing Help topic index. */
  query: string;
}

export function appendContextHelp(
  items: ContextMenuItem[],
  help: ContextMenuHelp | undefined,
): ContextMenuItem[] {
  if (!help) return items;
  const separator = items.length > 0 && !("separator" in items[items.length - 1])
    ? [{ separator: true } as const]
    : [];
  return [
    ...items,
    ...separator,
    { label: `?  Help with ${help.label}…`, run: () => openHelpTopic(help.query) },
  ];
}

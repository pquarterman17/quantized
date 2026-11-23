// The title-bar dock buttons of a layout window (WORKSPACE_LAYOUT_PLAN D2):
// ▣ centre, ◧ left, ⬓ bottom, ◨ right (the mockup's order). The button of the
// slot the window is in shows pressed; pressing it again floats the window.
// The group names its window for F6 (`data-wl-focus`), which then focuses the
// window's TITLE BAR (useLayoutKeyboard.focusTitleBar); a docked frame marks
// its own title bar instead (`marker={false}` here). Every button stops
// pointerdown so pressing one never starts a title-bar drag.

import type { PointerEvent } from "react";

import type { Slot, WindowRef } from "../../../lib/windowLayout/types";
import { toggleDockRef } from "../../../store/windowLayoutActions";
import { focusTitleBar } from "./useLayoutKeyboard";

const BUTTONS: { slot: Slot; glyph: string; label: string; where: string }[] = [
  { slot: "centre", glyph: "▣", label: "Dock centre", where: "in the centre" },
  { slot: "left", glyph: "◧", label: "Dock left", where: "on the left edge" },
  { slot: "bottom", glyph: "⬓", label: "Dock bottom", where: "on the bottom edge" },
  { slot: "right", glyph: "◨", label: "Dock right", where: "on the right edge" },
];

const stop = (e: PointerEvent) => e.stopPropagation();

export default function DockButtons({ refId, slot, title, marker = true }: { refId: WindowRef; slot: Slot | null; title: string; marker?: boolean }) {
  return (
    <span className="qzk-wl-dock" role="group" aria-label={`${title} placement`} data-wl-focus={marker ? refId : undefined}>
      {BUTTONS.map((b) => (
        <button
          key={b.slot}
          type="button"
          className="qzk-wl-dockbtn"
          aria-label={b.label}
          aria-pressed={slot === b.slot}
          title={slot === b.slot ? `Docked ${b.where}; press again to float the window.` : `Dock the window ${b.where}.`}
          onPointerDown={stop}
          onClick={() => {
            toggleDockRef(refId, b.slot);
            // The frame is rebuilt where it lands (a dock or a float swaps its chrome): focus its
            // title bar there rather than letting it fall to <body> or the Library (UX pass 3 m-3).
            requestAnimationFrame(() => focusTitleBar(refId));
          }}
        >
          {b.glyph}
        </button>
      ))}
    </span>
  );
}

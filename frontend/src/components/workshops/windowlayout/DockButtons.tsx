// The title-bar dock buttons of a layout window (WORKSPACE_LAYOUT_PLAN D2):
// ▣ centre, ◧ left, ⬓ bottom, ◨ right (the mockup's order). The button of the
// slot the window is in shows pressed; pressing it again floats the window.
// The group is also the window's F6 focus target (`data-wl-focus`), so F6
// lands on the title bar and Tab walks into the buttons. Every button stops
// pointerdown so pressing one never starts a title-bar drag.

import type { PointerEvent } from "react";

import type { Slot, WindowRef } from "../../../lib/windowLayout/types";
import { toggleDockRef } from "../../../store/windowLayoutActions";

const BUTTONS: { slot: Slot; glyph: string; label: string; where: string }[] = [
  { slot: "centre", glyph: "▣", label: "Dock centre", where: "in the centre" },
  { slot: "left", glyph: "◧", label: "Dock left", where: "on the left edge" },
  { slot: "bottom", glyph: "⬓", label: "Dock bottom", where: "on the bottom edge" },
  { slot: "right", glyph: "◨", label: "Dock right", where: "on the right edge" },
];

const stop = (e: PointerEvent) => e.stopPropagation();

export default function DockButtons({ refId, slot, title }: { refId: WindowRef; slot: Slot | null; title: string }) {
  return (
    <span className="qzk-wl-dock" role="group" aria-label={`${title} placement`} tabIndex={-1} data-wl-focus={refId}>
      {BUTTONS.map((b) => (
        <button
          key={b.slot}
          type="button"
          className="qzk-wl-dockbtn"
          aria-label={b.label}
          aria-pressed={slot === b.slot}
          title={slot === b.slot ? `Docked ${b.where}; press again to float the window.` : `Dock the window ${b.where}.`}
          onPointerDown={stop}
          onClick={() => toggleDockRef(refId, b.slot)}
        >
          {b.glyph}
        </button>
      ))}
    </span>
  );
}

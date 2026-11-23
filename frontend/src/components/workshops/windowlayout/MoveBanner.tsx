// The visible indicator of keyboard move mode (useMoveMode): which window is
// being moved and the keys that work. It sits in the toolbar row (LayoutToolbar),
// never over a window. Announcements go to the live region.

import type { MoveState } from "./useMoveMode";

export default function MoveBanner({ mode }: { mode: MoveState }) {
  return (
    <div className="qzk-wl-modebar" data-testid="wl-move-mode">
      <span className="qzk-wl-modebar-glyph" aria-hidden="true">
        ✥
      </span>
      <strong>Moving {mode.title}</strong>
      <span title="Arrows move the window (Shift: 1 px); L, R, B and C dock it; F floats it; Enter keeps it; Escape cancels.">arrows move · L R B C dock · F float · Enter keep · Esc cancel</span>
    </div>
  );
}

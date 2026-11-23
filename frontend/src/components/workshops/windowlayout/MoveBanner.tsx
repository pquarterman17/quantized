// The visible indicator of keyboard move mode (useMoveMode): which window is
// being moved and the keys that work. Announcements go to the live region.

import type { MoveState } from "./useMoveMode";

export default function MoveBanner({ mode }: { mode: MoveState }) {
  return (
    <div className="qzk-wl-modebar" data-testid="wl-move-mode">
      <span className="qzk-wl-modebar-glyph" aria-hidden="true">
        ✥
      </span>
      <strong>Moving {mode.title}</strong>
      <span>arrows move (Shift: 1 px) · L R B C dock · F float · Enter keep · Esc cancel</span>
    </div>
  );
}

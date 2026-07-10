// The title-bar button cluster of a PlotWindowFrame (link / pin / background /
// close) — extracted verbatim when items 13 + 14 pushed the frame past the
// 400-line component ceiling (`architecture.test.ts`): the ratchet's job is to
// force exactly this split. Every button stopPropagation()s its pointerdown so
// clicking chrome never starts a title-bar drag (the frame owns that gesture).

import { nextPlotBg, type PlotBg, type PlotWindow } from "../../lib/plotview";
import { useApp } from "../../store/useApp";

const BG_LABEL: Record<PlotBg, string> = { theme: "Theme", light: "Light", dark: "Dark" };

export default function WindowTitleButtons({ win }: { win: PlotWindow }) {
  const closeWindow = useApp((s) => s.closeWindow);
  const setWindowBg = useApp((s) => s.setWindowBg);
  const cycleWindowLinkGroup = useApp((s) => s.cycleWindowLinkGroup);
  const toggleWindowPin = useApp((s) => s.toggleWindowPin);

  return (
    <>
      {/* Items 13 + 14: link + pin only make sense on LIVE plot windows —
          a snapshot is never dataset-bound (pin is meaningless) and its
          static viewport isn't wired into the sync registry. */}
      {win.kind !== "snapshot" && (
        <button
          type="button"
          className={`qzk-plotwin-link${win.linkGroup != null ? " linked" : ""}`}
          title={
            win.linkGroup != null
              ? `Link group ${win.linkGroup} — crosshair + x-range sync with same-group windows; click to cycle (1 / 2 / 3 / off)`
              : "Not linked — click to cycle this window's link group (1 / 2 / 3 / off)"
          }
          aria-label="Cycle window link group"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => cycleWindowLinkGroup(win.id)}
        >
          ⧟
          {win.linkGroup != null && <span className="qzk-plotwin-link-n">{win.linkGroup}</span>}
        </button>
      )}
      {win.kind !== "snapshot" && (
        <button
          type="button"
          className={`qzk-plotwin-pin${win.pinned ? " pinned" : ""}`}
          title={
            win.pinned
              ? "Pinned — Library clicks won't retarget this window (an explicit drop still rebinds it)"
              : "Pin window — keep its dataset when clicking the Library"
          }
          aria-label={win.pinned ? "Unpin window" : "Pin window"}
          aria-pressed={win.pinned}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => toggleWindowPin(win.id)}
        >
          ⚲
        </button>
      )}
      <button
        type="button"
        className="qzk-plotwin-bg"
        title={`Window background: ${BG_LABEL[win.bg]} — click to cycle (Theme / Light / Dark)`}
        aria-label="Cycle window background"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setWindowBg(win.id, nextPlotBg(win.bg))}
      >
        ◐
      </button>
      <button
        type="button"
        className="qzk-plotwin-close"
        aria-label="Close window"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => closeWindow(win.id)}
      />
    </>
  );
}

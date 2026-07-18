// The title-bar button cluster of a PlotWindowFrame (link / pin / background /
// close) — extracted verbatim when items 13 + 14 pushed the frame past the
// 400-line component ceiling (`architecture.test.ts`): the ratchet's job is to
// force exactly this split. Every button stopPropagation()s its pointerdown so
// clicking chrome never starts a title-bar drag (the frame owns that gesture).
//
// GUI_INTERACTION #3 sub-item 4: the "⇄" button is the menu-path equivalent
// of item 14's drag-a-Library-row-onto-the-frame rebind gesture — until this
// landed, rebinding a window had NO non-mouse path at all.
//
// GUI_INTERACTION #8 residual: a right-click ANYWHERE on the title bar now
// opens a menu built from the `windowMenu` registry (duplicate/pin/link/bg +
// "Rebind to" + close) — the same entries the buttons above already run,
// reached without hunting for the right glyph. `PlotWindowFrame.tsx` is at
// its 400-line ratchet pin (zero headroom) so the `contextmenu` binding
// can't live there as a JSX prop; instead a hidden anchor span finds its own
// `.qzk-plotwin-titlebar` ancestor via `closest()` and attaches a native
// listener in an effect — a zero-line-cost retrofit of the frame itself.
import { useEffect, useRef, useState } from "react";

import { nextPlotBg, type PlotBg, type PlotWindow } from "../../lib/plotview";
import { useApp } from "../../store/useApp";
import { buildMenuItems } from "../../lib/contextActions";
import ContextMenu, { type ContextMenuItem } from "../overlays/ContextMenu";
import { windowCloseAction, windowCoreActions, type WindowActionTarget } from "./windowMenu";

const BG_LABEL: Record<PlotBg, string> = { theme: "Theme", light: "Light", dark: "Dark" };

export default function WindowTitleButtons({ win }: { win: PlotWindow }) {
  const closeWindow = useApp((s) => s.closeWindow);
  const setWindowBg = useApp((s) => s.setWindowBg);
  const cycleWindowLinkGroup = useApp((s) => s.cycleWindowLinkGroup);
  const toggleWindowPin = useApp((s) => s.toggleWindowPin);
  const rebindWindow = useApp((s) => s.rebindWindow);
  const datasets = useApp((s) => s.datasets);
  const [rebindMenu, setRebindMenu] = useState<{ x: number; y: number } | null>(null);
  const [titleMenu, setTitleMenu] = useState<{ x: number; y: number } | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);

  // Same eligibility the ⇄ button already gates on (a snapshot/panel window
  // silently ignores a rebind) — shared so the title-bar menu's "Rebind to"
  // submenu never offers something the button itself wouldn't.
  const canRebind = win.kind !== "snapshot" && win.kind !== "panel" && datasets.length > 0;

  useEffect(() => {
    const bar = anchorRef.current?.closest(".qzk-plotwin-titlebar") as HTMLElement | null;
    if (!bar) return;
    const onContextMenu = (e: MouseEvent) => {
      // The inline rename `<input>` lives in this same title bar — let its
      // own native context menu (cut/copy/paste) show instead of ours.
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      e.preventDefault();
      setTitleMenu({ x: e.clientX, y: e.clientY });
    };
    bar.addEventListener("contextmenu", onContextMenu);
    return () => bar.removeEventListener("contextmenu", onContextMenu);
  }, []);

  const target: WindowActionTarget = { win };
  const titleMenuItems: ContextMenuItem[] = [
    ...buildMenuItems(windowCoreActions, target),
    ...(canRebind
      ? ([
          { separator: true },
          {
            label: "Rebind to",
            submenu: datasets.map((d) => ({
              label: d.name,
              run: () => rebindWindow(win.id, d.id),
              disabled: d.id === win.datasetId,
            })),
          },
        ] as ContextMenuItem[])
      : []),
    { separator: true },
    ...buildMenuItems([windowCloseAction], target),
  ];

  return (
    <>
      <span ref={anchorRef} style={{ display: "none" }} />
      {titleMenu && (
        <ContextMenu x={titleMenu.x} y={titleMenu.y} items={titleMenuItems} onClose={() => setTitleMenu(null)} />
      )}
      {/* Item 14's rebind gesture is drag-only for a snapshot/panel window
          too (both kinds silently ignore a drop — "frozen means frozen" /
          panel's binding is a list, not a single id) — same guard here. */}
      {canRebind && (
        <button
          type="button"
          className="qzk-plotwin-rebind"
          title="Rebind to another dataset… (or drag a Library row onto this window)"
          aria-label="Rebind window to another dataset"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            const r = e.currentTarget.getBoundingClientRect();
            setRebindMenu({ x: r.left, y: r.bottom });
          }}
        >
          ⇄
        </button>
      )}
      {rebindMenu && (
        <ContextMenu
          x={rebindMenu.x}
          y={rebindMenu.y}
          onClose={() => setRebindMenu(null)}
          items={datasets.map((d) => ({
            label: d.name,
            run: () => rebindWindow(win.id, d.id),
            disabled: d.id === win.datasetId,
          }))}
        />
      )}
      {/* Items 13 + 14 (tightened by 17): link + pin only make sense on the
          kind:"plot" window — a snapshot is never dataset-bound (pin is
          meaningless) and its static viewport isn't wired into the sync
          registry; a worksheet/map document window has no XY axes to sync
          and is never a passive-retarget candidate (kind-guarded in the
          store), so pinning it would be a dead toggle. */}
      {win.kind === "plot" && (
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
      {win.kind === "plot" && (
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
      {/* Item 18's ◐ background toggle applies to the plot PAGE (canvas draw
          colours) — plot + snapshot windows only. Worksheet/map document
          windows (item 17) draw their own surfaces, so the toggle is hidden
          rather than shipped as a no-op. */}
      {(win.kind === "plot" || win.kind === "snapshot") && (
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
      )}
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

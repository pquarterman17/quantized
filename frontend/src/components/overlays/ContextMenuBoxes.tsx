import { createContext, useContext, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Z } from "../../lib/layers";

/** True inside a root that scrolls (UX menus M7): a flyout there would be clipped by the root's `overflow`, so it
 *  portals to <body> with viewport coordinates instead. */
const ScrollingRoot = createContext(false);

/** Root popup: fixed to the viewport so panel overflow cannot clip it. */
export function PopupBox({
  x,
  y,
  children,
  boxRef,
}: {
  x: number;
  y: number;
  children: React.ReactNode;
  boxRef?: React.Ref<HTMLDivElement>;
}) {
  const localRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  // 0 = natural size, 1 = tightened rows (22 px floor), 2 = still too tall: the root scrolls (M7).
  const [stage, setStage] = useState<0 | 1 | 2>(0);
  useLayoutEffect(() => {
    const el = localRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 8;
    // max-height constrains the border box before this measurement, while
    // overflow remains visible by default. Check the content dimensions too,
    // otherwise a tall menu appears to "fit" even though its final rows run
    // below the viewport and the compact-row pass never activates.
    if (stage === 0 && (r.height + 2 * pad > window.innerHeight || el.scrollHeight > el.clientHeight))
      return setStage(1);
    if (stage === 1 && el.scrollHeight > el.clientHeight + 1) return setStage(2);
    const nx = x + r.width + pad > window.innerWidth ? Math.max(pad, window.innerWidth - r.width - pad) : x;
    const ny = y + r.height + pad > window.innerHeight ? Math.max(pad, window.innerHeight - r.height - pad) : y;
    setPos({ x: nx, y: ny });
  }, [x, y, stage]);
  return (
    <div
      ref={(node) => {
        localRef.current = node;
        if (typeof boxRef === "function") boxRef(node);
        else if (boxRef) (boxRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }}
      className={`qzk-menu-pop qzk-ctx qzk-ctx-root${stage > 0 ? " fit" : ""}${stage > 1 ? " scroll" : ""}`}
      style={{ position: "fixed", left: pos.x, top: pos.y, zIndex: Z.menu }}
      onContextMenu={(event) => event.preventDefault()}
      onClick={(event) => event.stopPropagation()}
    >
      <ScrollingRoot.Provider value={stage > 1}>{children}</ScrollingRoot.Provider>
    </div>
  );
}

/** Submenu popup: anchored to its row, then flipped/shifted at viewport edges. Inside a scrolling root it portals to
 *  <body> (position: fixed from the row's rect) so the root's overflow cannot clip it; it follows the root's scroll. */
export function FlyoutBox({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const marker = useRef<HTMLSpanElement>(null);
  const scrolling = useContext(ScrollingRoot);
  const [side, setSide] = useState<"right" | "left">("right");
  const [shiftY, setShiftY] = useState(0);
  const [fixed, setFixed] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pad = 8;
    if (scrolling) {
      const anchor = marker.current?.parentElement;
      if (!anchor) return;
      const place = () => {
        const a = anchor.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        const left = a.right + r.width + pad > window.innerWidth ? a.left - r.width + 3 : a.right - 3;
        const top = Math.max(pad, Math.min(a.top - 4, window.innerHeight - pad - r.height));
        setFixed({ left, top });
      };
      place();
      const host = anchor.closest(".qzk-ctx-root");
      host?.addEventListener("scroll", place);
      return () => host?.removeEventListener("scroll", place);
    }
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    if (r.right > window.innerWidth - pad) setSide("left");
    const overflowY = r.bottom - (window.innerHeight - pad);
    if (overflowY > 0) setShiftY(-overflowY);
  }, [scrolling]);
  const sidePos = side === "right" ? { left: "calc(100% - 3px)" } : { right: "calc(100% - 3px)" };
  const box = (
    <div
      ref={ref}
      className={`qzk-menu-pop qzk-ctx${scrolling ? " qzk-ctx-fly" : ""}`}
      data-qz-flyout={scrolling ? "" : undefined}
      style={
        scrolling
          ? { position: "fixed", ...(fixed ?? { left: 0, top: 0, visibility: "hidden" }), zIndex: Z.menu + 1 }
          : { position: "absolute", top: -4 + shiftY, zIndex: Z.menu + 1, ...sidePos }
      }
      onContextMenu={(event) => event.preventDefault()}
    >
      <ScrollingRoot.Provider value={false}>{children}</ScrollingRoot.Provider>
    </div>
  );
  if (!scrolling) return box;
  return (
    <>
      <span ref={marker} hidden />
      {createPortal(box, document.body)}
    </>
  );
}

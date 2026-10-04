import { useLayoutEffect, useRef, useState } from "react";

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
  const [fit, setFit] = useState(false);
  useLayoutEffect(() => {
    const el = localRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 8;
    // max-height constrains the border box before this measurement, while
    // overflow remains visible by default. Check the content dimensions too,
    // otherwise a tall menu appears to "fit" even though its final rows run
    // below the viewport and the compact-row pass never activates.
    if (!fit && (r.height + 2 * pad > window.innerHeight || el.scrollHeight > el.clientHeight))
      return setFit(true);
    const nx = x + r.width + pad > window.innerWidth ? Math.max(pad, window.innerWidth - r.width - pad) : x;
    const ny = y + r.height + pad > window.innerHeight ? Math.max(pad, window.innerHeight - r.height - pad) : y;
    setPos({ x: nx, y: ny });
  }, [x, y, fit]);
  return (
    <div
      ref={(node) => {
        localRef.current = node;
        if (typeof boxRef === "function") boxRef(node);
        else if (boxRef) (boxRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }}
      className={`qzk-menu-pop qzk-ctx${fit ? " fit" : ""}`}
      style={{ position: "fixed", left: pos.x, top: pos.y, zIndex: 2100 }}
      onContextMenu={(event) => event.preventDefault()}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );
}

/** Submenu popup: anchored to its row, then flipped/shifted at viewport edges. */
export function FlyoutBox({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [side, setSide] = useState<"right" | "left">("right");
  const [shiftY, setShiftY] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    const pad = 8;
    if (r.right > window.innerWidth - pad) setSide("left");
    const overflowY = r.bottom - (window.innerHeight - pad);
    if (overflowY > 0) setShiftY(-overflowY);
  }, []);
  const sidePos = side === "right" ? { left: "calc(100% - 3px)" } : { right: "calc(100% - 3px)" };
  return (
    <div
      ref={ref}
      className="qzk-menu-pop qzk-ctx"
      style={{ position: "absolute", top: -4 + shiftY, zIndex: 2101, ...sidePos }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {children}
    </div>
  );
}

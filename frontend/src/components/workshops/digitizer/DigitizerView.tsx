// Graph digitizer — full-screen overlay. Load (or paste) an image of a plot,
// click two X-axis and two Y-axis reference points (entering their data values),
// then click along the curve. "Create dataset" maps the traced pixels to data
// (lib/digitizer) and adds it to the library. Thin view over useDigitizer.

import { useRef, useState } from "react";

import { Button, NumberField } from "../../primitives";
import { useApp } from "../../../store/useApp";
import { type Mode, useDigitizer } from "./useDigitizer";

const STEP: Record<Mode, string> = {
  x1: "Click the 1st point on the X axis, then enter its value.",
  x2: "Click a 2nd point on the X axis (different value).",
  y1: "Click the 1st point on the Y axis, then enter its value.",
  y2: "Click a 2nd point on the Y axis (different value).",
  trace: "Click along the curve to trace it.",
};
const REF_COLORS: Record<string, string> = { x1: "#22d3ee", x2: "#22d3ee", y1: "#f59e0b", y2: "#f59e0b" };

export default function DigitizerView() {
  const setOpen = useApp((s) => s.setDigitizerOpen);
  const d = useDigitizer();
  const imgRef = useRef<HTMLImageElement>(null);
  const [nat, setNat] = useState<[number, number]>([1, 1]);
  const [val, setVal] = useState<number | string>("");
  const [name, setName] = useState("digitized");

  function loadFile(file: File): void {
    const reader = new FileReader();
    reader.onload = () => d.setImage(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(file);
  }
  function onPaste(e: React.ClipboardEvent): void {
    const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith("image/"));
    const blob = item?.getAsFile();
    if (blob) loadFile(blob);
  }
  function onImgClick(e: React.MouseEvent<HTMLImageElement>): void {
    const img = imgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * img.naturalWidth;
    const py = ((e.clientY - rect.top) / rect.height) * img.naturalHeight;
    d.click(px, py);
  }
  function commitValue(): void {
    d.commit(Number(val));
    setVal("");
  }

  const r = Math.max(4, nat[0] / 140); // marker radius in natural px
  const refEntries = Object.entries(d.refs) as [Mode, { px: number; py: number }][];

  return (
    <div
      className="qzk-digitizer"
      onPaste={onPaste}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background: "var(--bg, #111)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "8px 12px",
          borderBottom: "1px solid var(--border, #333)",
        }}
      >
        <strong style={{ color: "var(--accent)" }}>Graph digitizer</strong>
        <span className="qzk-ds-meta" style={{ color: "var(--text-dim)" }}>
          {d.image ? STEP[d.mode] : "Load or paste an image of a plot to begin."}
        </span>
        <span style={{ flex: 1 }} />
        <label className="qz-icon-btn" title="Load image" style={{ cursor: "default" }}>
          ⤒
          <input
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])}
          />
        </label>
        <button className="qz-icon-btn" title="Close digitizer" onClick={() => setOpen(false)}>
          ×
        </button>
      </div>

      {/* Image + overlay */}
      <div style={{ flex: 1, overflow: "auto", display: "grid", placeItems: "center", padding: 12 }}>
        {!d.image ? (
          <div className="qzk-ds-meta" style={{ color: "var(--text-faint)", textAlign: "center" }}>
            Press the ⤒ button to load an image, or paste one (Ctrl/Cmd-V).
            <br />
            Then click two points on each axis, enter their values, and trace the curve.
          </div>
        ) : (
          <div style={{ position: "relative", maxWidth: "100%" }}>
            <img
              ref={imgRef}
              src={d.image}
              alt="plot to digitize"
              onLoad={(e) => setNat([e.currentTarget.naturalWidth, e.currentTarget.naturalHeight])}
              onClick={onImgClick}
              style={{ display: "block", maxWidth: "100%", height: "auto", cursor: "crosshair" }}
            />
            <svg
              viewBox={`0 0 ${nat[0]} ${nat[1]}`}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
            >
              {refEntries.map(([k, p]) => (
                <g key={k}>
                  <circle cx={p.px} cy={p.py} r={r} fill="none" stroke={REF_COLORS[k]} strokeWidth={r / 3} />
                  <text x={p.px + r * 1.4} y={p.py} fill={REF_COLORS[k]} fontSize={r * 2.4}>
                    {k.toUpperCase()}
                  </text>
                </g>
              ))}
              {d.traced.map((p, i) => (
                <circle key={i} cx={p.px} cy={p.py} r={r * 0.7} fill="var(--accent)" />
              ))}
              {d.pending && (
                <circle cx={d.pending.px} cy={d.pending.py} r={r} fill="none" stroke="#fff" strokeWidth={r / 3} />
              )}
            </svg>
          </div>
        )}
      </div>

      {/* Controls */}
      {d.image && (
        <div
          className="qzk-glass"
          style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", flexWrap: "wrap" }}
        >
          {d.pending ? (
            <>
              <span className="qzk-field-lbl" style={{ margin: 0 }}>
                {d.mode.startsWith("x") ? "X" : "Y"} value
              </span>
              <NumberField value={val} width={110} onChange={(v) => setVal(v)} />
              <Button variant="primary" size="sm" onClick={commitValue}>
                Set
              </Button>
              <Button size="sm" onClick={d.cancelPending}>
                Cancel
              </Button>
            </>
          ) : d.mode === "trace" ? (
            <>
              <span className="qzk-ds-meta">{d.traced.length} points traced</span>
              <Button size="sm" disabled={!d.traced.length} onClick={d.undo}>
                Undo point
              </Button>
              <span className="qzk-tool-sep" />
              <span className="qzk-field-lbl" style={{ margin: 0 }}>
                Name
              </span>
              <input
                className="qz-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{ width: 140 }}
              />
              <Button
                variant="primary"
                size="sm"
                disabled={!d.ready || d.traced.length < 2}
                onClick={() => {
                  d.create(name);
                  setOpen(false);
                }}
              >
                Create dataset →
              </Button>
            </>
          ) : (
            <span className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
              Click a point on the image to set {d.mode.toUpperCase()}.
            </span>
          )}
          <span style={{ flex: 1 }} />
          <Button size="sm" onClick={d.reset}>
            Reset
          </Button>
        </div>
      )}
    </div>
  );
}

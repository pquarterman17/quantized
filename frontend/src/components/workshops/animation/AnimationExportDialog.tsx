import { useMemo, useRef, useState } from "react";

import { MAX_ANIMATION_FRAMES } from "../../../lib/animationFrames";
import type { AnimationFormat } from "../../../lib/api/figureAnimation";
import { toast } from "../../../store/toasts";
import { useApp } from "../../../store/useApp";
import ToolWindow from "../../overlays/ToolWindow";
import { Button, Select } from "../../primitives";
import { Checkbox } from "../../primitives/Checkbox";
import { planAnimation, runAnimationExport, type AnimationSource } from "../../../store/animationExportRun";

const FORMATS: { value: AnimationFormat; label: string }[] = [
  { value: "gif", label: "Animated GIF" },
  { value: "apng", label: "Animated PNG (APNG)" },
  { value: "zip", label: "PNG frames (ZIP)" },
];

/** "Export animation…": one frame per By level of a saved figure, or one per
 * selected dataset drawn with a saved figure's settings. Frames are rendered
 * by the same server-side renderer as the static and batch export. Defaults
 * (fixed axes on, 500 ms, 100 dpi) are provisional, owner to confirm. */
export default function AnimationExportDialog({ seedDatasetIds, onClose }: { seedDatasetIds: readonly string[]; onClose: () => void }) {
  const figures = useApp((s) => s.editableFigures);
  const datasets = useApp((s) => s.datasets);
  const [source, setSource] = useState<AnimationSource>("by");
  const [figureId, setFigureId] = useState("");
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set(seedDatasetIds));
  const [format, setFormat] = useState<AnimationFormat>("gif");
  const [frameMs, setFrameMs] = useState(500);
  const [loop, setLoop] = useState(true);
  const [fixedAxes, setFixedAxes] = useState(true);
  const [dpi, setDpi] = useState(100);
  const [name, setName] = useState("animation");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string>("");
  const controller = useRef<AbortController | null>(null);

  const candidates = useMemo(
    () => figures.filter((f) => f.bindings.datasetId !== null && (source === "datasets" || f.bindings.groupKey !== null)),
    [figures, source],
  );
  const figure = candidates.find((f) => f.id === figureId) ?? candidates[0];
  const ids = datasets.filter((d) => checked.has(d.id)).map((d) => d.id);
  const request = { source, figureId: figure?.id ?? "", datasetIds: ids };
  const ready = !!figure && (source === "by" || ids.length > 0) && !busy;
  const toggle = (id: string, on: boolean) => {
    const next = new Set(checked);
    if (on) next.add(id); else next.delete(id);
    setChecked(next);
    setPreview("");
  };

  const showFrames = async () => {
    try {
      const plan = await planAnimation(request);
      setPreview(`${plan.frames.length} frame${plan.frames.length === 1 ? "" : "s"}: ${plan.frames.slice(0, 4).map((f) => f.label).join(", ")}${plan.frames.length > 4 ? ", …" : ""}`);
    } catch (error) {
      setPreview("");
      toast(error instanceof Error ? error.message : String(error), "danger");
    }
  };

  const run = async () => {
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    try {
      const count = await runAnimationExport(request, { format, frameMs, loop, fixedAxes, dpi: Math.max(50, Math.min(600, dpi)), filename: name.trim() || "animation" }, abort.signal);
      toast(`Animation exported (${count} frame${count === 1 ? "" : "s"}).`, "info");
      onClose();
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") toast("Animation export cancelled.", "info");
      else toast(`Animation export failed: ${error instanceof Error ? error.message : String(error)}`, "danger");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ToolWindow id="animation-export" title="Export animation" width={620} x={200} y={90} onClose={() => { controller.current?.abort(); onClose(); }}>
      <div className="qzk-helptext">
        Step a saved figure through its By levels, or through several datasets, as an animated GIF / APNG or a PNG-frame ZIP (no ffmpeg). Up to {MAX_ANIMATION_FRAMES} frames.
      </div>
      <label className="qzk-field">
        <span className="qzk-field-lbl">Frames from</span>
        <Select aria-label="Frames from" value={source} disabled={busy} onChange={(e) => { setSource(e.target.value as AnimationSource); setPreview(""); }}
          options={[{ value: "by", label: "Each By level of a saved figure" }, { value: "datasets", label: "Each selected dataset" }]} />
      </label>
      <label className="qzk-field">
        <span className="qzk-field-lbl">{source === "by" ? "Saved figure (with a By column)" : "Saved figure to apply"}</span>
        <Select aria-label="Saved figure" value={figure?.id ?? ""} disabled={busy || candidates.length === 0} onChange={(e) => { setFigureId(e.target.value); setPreview(""); }}
          options={candidates.map((f) => ({ value: f.id, label: f.name }))} />
      </label>
      {candidates.length === 0 && (
        <div style={{ color: "var(--danger)" }}>{source === "by" ? "No saved figure has a By column. Group a figure and save it first." : "Save a figure first."}</div>
      )}
      {source === "datasets" && (
        <div role="group" aria-label="Datasets" style={{ maxHeight: 160, overflow: "auto", border: "1px solid var(--border)", borderRadius: 6, padding: 6 }}>
          {datasets.map((d) => <Checkbox key={d.id} checked={checked.has(d.id)} disabled={busy} onChange={(on) => toggle(d.id, on)}>{d.name}</Checkbox>)}
        </div>
      )}
      <div className="qzk-win-section">Output</div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 190px 110px 90px", gap: 8 }}>
        <label className="qzk-field"><span className="qzk-field-lbl">File name</span><input className="qz-input" value={name} disabled={busy} onChange={(e) => setName(e.target.value)} /></label>
        <label className="qzk-field"><span className="qzk-field-lbl">Format</span><Select aria-label="Format" value={format} disabled={busy} onChange={(e) => setFormat(e.target.value as AnimationFormat)} options={FORMATS} /></label>
        <label className="qzk-field"><span className="qzk-field-lbl">Frame (ms)</span><input className="qz-input" type="number" min={20} max={10000} value={frameMs} disabled={busy || format === "zip"} onChange={(e) => setFrameMs(Math.max(20, Math.min(10000, Number(e.target.value) || 500)))} /></label>
        <label className="qzk-field"><span className="qzk-field-lbl">DPI</span><input className="qz-input" type="number" min={50} max={600} value={dpi} disabled={busy} onChange={(e) => setDpi(Number(e.target.value) || 100)} /></label>
      </div>
      <Checkbox checked={loop} disabled={busy || format === "zip"} onChange={setLoop}>Loop forever</Checkbox>
      <Checkbox checked={fixedAxes} disabled={busy} onChange={setFixedAxes}>Fixed axes (one shared X/Y range so frames are comparable)</Checkbox>
      <div className="qzk-ds-meta">The By value or dataset name is drawn as the figure title of each frame.</div>
      {preview && <div role="status">{preview}</div>}
      <div style={{ display: "flex", gap: 6 }}>
        <Button onClick={() => void showFrames()} disabled={!ready}>Preview frames</Button>
        <Button variant="primary" onClick={() => void run()} disabled={!ready}>Export animation</Button>
        {busy && <Button onClick={() => controller.current?.abort()}>Cancel</Button>}
      </div>
    </ToolWindow>
  );
}

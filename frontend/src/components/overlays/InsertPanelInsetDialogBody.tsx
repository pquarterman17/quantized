// Insert panel inset (#15): the lazy chunk with the real form. Three kinds,
// picked by a segmented set of buttons (not a native radio group, to match
// the rest of this app's dialog chrome):
//   - "dataset": another dataset's X/Y columns, FROZEN into a plain-array
//     snapshot at submit time (see lib/panelInset.ts's module doc for why —
//     avoids the in-flight live cross-series linking workstream entirely).
//   - "image": a PNG/JPEG picked via <input type="file">, read as a data
//     URL (same FileReader pattern as the digitizer's calibration image).
//   - "table": pasted/typed text, one row per line, cells comma-separated;
//     an optional header line.
// Escape/backdrop/Cancel all close without creating anything.

import { useId, useRef, useState } from "react";
import { Button } from "../primitives";
import { useEscapeSurface } from "../../lib/escapeStack";
import type { PanelInsetContent } from "../../lib/panelInset";
import { useApp } from "../../store/useApp";
import { useDialogFocus } from "./useDialogFocus";

type Kind = "dataset" | "image" | "table";
const KINDS: { kind: Kind; label: string }[] = [
  { kind: "dataset", label: "Dataset" },
  { kind: "image", label: "Image" },
  { kind: "table", label: "Table" },
];

function parseTable(headersText: string, rowsText: string): PanelInsetContent | null {
  const rows = rowsText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(",").map((c) => c.trim()));
  if (!rows.length) return null;
  const headers = headersText.trim() ? headersText.split(",").map((h) => h.trim()) : undefined;
  return { kind: "table", rows, ...(headers ? { headers } : {}) };
}

export default function InsertPanelInsetDialogBody() {
  const close = useApp((s) => s.closeInsertPanelInsetDialog);
  const addPanelInset = useApp((s) => s.addPanelInset);
  const datasets = useApp((s) => s.datasets);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const submitReasonId = useId();
  const [kind, setKind] = useState<Kind>("dataset");

  const [datasetId, setDatasetId] = useState(datasets[0]?.id ?? "");
  const dataset = datasets.find((d) => d.id === datasetId) ?? null;
  const [xKey, setXKey] = useState<string>("time");
  const [yKey, setYKey] = useState(0);
  const [legend, setLegend] = useState(false);

  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  const [headersText, setHeadersText] = useState("");
  const [rowsText, setRowsText] = useState("");

  useDialogFocus(dialogRef, true);
  useEscapeSurface(
    "modal",
    () => {
      close();
      return true;
    },
    true,
  );

  const onPickImage = (file: File | null) => {
    setImageError(null);
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type)) {
      setImageError("Choose a PNG or JPEG image.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setImageDataUrl(String(reader.result));
    reader.readAsDataURL(file);
  };

  const buildContent = (): PanelInsetContent | null => {
    if (kind === "dataset") {
      if (!dataset) return null;
      const x = xKey === "time" ? dataset.data.time : dataset.data.values.map((row) => row[Number(xKey)]);
      const y = dataset.data.values.map((row) => row[yKey]);
      if (!x.length || !y.length) return null;
      return {
        kind: "dataset",
        x,
        series: [{ label: dataset.data.labels[yKey] ?? `col ${yKey}`, y }],
        ...(legend ? { legend: true } : {}),
      };
    }
    if (kind === "image") return imageDataUrl ? { kind: "image", dataUrl: imageDataUrl } : null;
    return parseTable(headersText, rowsText);
  };

  const content = buildContent();

  const submit = () => {
    if (!content) return;
    addPanelInset(content);
    close();
  };

  return (
    <div className="qz-overlay-backdrop" onMouseDown={close}>
      <div
        className="qzk-glass qz-dialog"
        role="dialog"
        aria-labelledby={titleId}
        ref={dialogRef}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id={titleId}>Insert panel</h2>

        <div className="qz-btn-row" role="group" aria-label="Panel kind">
          {KINDS.map((k) => (
            <Button key={k.kind} variant={kind === k.kind ? "primary" : "default"} onClick={() => setKind(k.kind)}>
              {k.label}
            </Button>
          ))}
        </div>

        {kind === "dataset" && (
          <div>
            <label htmlFor="panel-inset-dataset">Dataset</label>
            <select id="panel-inset-dataset" value={datasetId} onChange={(e) => setDatasetId(e.target.value)}>
              {datasets.length === 0 && <option value="">No datasets</option>}
              {datasets.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <label htmlFor="panel-inset-x">X</label>
            <select id="panel-inset-x" value={xKey} onChange={(e) => setXKey(e.target.value)}>
              <option value="time">Time</option>
              {dataset?.data.labels.map((l, i) => (
                <option key={i} value={i}>
                  {l}
                </option>
              ))}
            </select>
            <label htmlFor="panel-inset-y">Y</label>
            <select id="panel-inset-y" value={yKey} onChange={(e) => setYKey(Number(e.target.value))}>
              {dataset?.data.labels.map((l, i) => (
                <option key={i} value={i}>
                  {l}
                </option>
              ))}
            </select>
            <label htmlFor="panel-inset-legend">
              <input
                id="panel-inset-legend"
                type="checkbox"
                checked={legend}
                onChange={(e) => setLegend(e.target.checked)}
              />
              Show legend
            </label>
          </div>
        )}

        {kind === "image" && (
          <div>
            <label htmlFor="panel-inset-image">Image (PNG or JPEG)</label>
            <input
              id="panel-inset-image"
              type="file"
              accept="image/png,image/jpeg"
              onChange={(e) => onPickImage(e.target.files?.[0] ?? null)}
            />
            {imageError && <p role="alert">{imageError}</p>}
            {imageDataUrl && <img src={imageDataUrl} alt="Preview" style={{ maxWidth: 200, maxHeight: 120 }} />}
          </div>
        )}

        {kind === "table" && (
          <div>
            <label htmlFor="panel-inset-headers">Headers (comma-separated, optional)</label>
            <input
              id="panel-inset-headers"
              type="text"
              value={headersText}
              onChange={(e) => setHeadersText(e.target.value)}
            />
            <label htmlFor="panel-inset-rows">Rows (one per line, cells comma-separated)</label>
            <textarea id="panel-inset-rows" value={rowsText} onChange={(e) => setRowsText(e.target.value)} />
          </div>
        )}

        {!content && <p id={submitReasonId}>Fill in the panel's content first.</p>}
        <div className="qz-btn-row">
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={!content}
            aria-describedby={!content ? submitReasonId : undefined}
          >
            Insert
          </Button>
        </div>
      </div>
    </div>
  );
}

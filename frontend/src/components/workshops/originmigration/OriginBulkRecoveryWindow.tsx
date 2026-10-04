import { useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { figureLabel } from "../../../lib/originFigures";
import { previewOriginSourceMapping } from "../../../lib/originSources";
import { useApp } from "../../../store/useApp";
import ToolWindow from "../../overlays/ToolWindow";
import { Badge, Button } from "../../primitives";
import { commitOriginSourceMapping } from "./originSourceMappingCommands";

export default function OriginBulkRecoveryWindow({
  fidelityId,
  book,
  onClose,
}: {
  fidelityId: string;
  book: string;
  onClose: () => void;
}) {
  const fidelity = useApp((s) => s.originFidelity.find((item) => item.id === fidelityId));
  const figures = useApp((s) => s.originFigures);
  const datasets = useApp((s) => s.datasets);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const siblingIds = useMemo(() => new Set(fidelity?.siblingIds ?? []), [fidelity]);
  const targets = useMemo(() => figures.filter((entry) =>
    entry.siblingIds.some((id) => siblingIds.has(id))
      && entry.figure.curves?.some((curve) => curve.book === book)),
  [book, figures, siblingIds]);
  const candidates = useMemo(() => datasets.filter((dataset) => siblingIds.has(dataset.id)).map(
    (dataset) => ({ dataset, preview: previewOriginSourceMapping(targets, dataset, book) }),
  ).sort((a, b) => Number(b.preview.canApply) - Number(a.preview.canApply)
    || a.dataset.name.localeCompare(b.dataset.name, undefined, { numeric: true })),
  [book, datasets, siblingIds, targets]);
  const selected = candidates.find((candidate) => candidate.dataset.id === selectedId) ?? null;

  const commit = async () => {
    if (!selected?.preview.canApply || busy) return;
    setBusy(true);
    try {
      if (await commitOriginSourceMapping(book, selected.dataset.id, selected.preview.entryIds)) onClose();
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <ToolWindow
      id={`origin-bulk-recovery-${fidelityId}-${book}`}
      title={`Resolve repeated Origin source · ${book || "Unknown book"}`}
      x={Math.max(24, window.innerWidth - 700)}
      y={84}
      width={640}
      onClose={onClose}
    >
      <section className="qzk-origin-bulk-recovery" aria-label={`Resolve repeated source ${book}`}>
        <p>
          Choose one imported workbook for the saved source <strong>{book || "Unknown book"}</strong>.
          Nothing is changed until you review the complete scope and apply it.
        </p>
        <div className="qzk-origin-bulk-targets" aria-label="Affected Origin graph layers">
          <strong>{targets.length} affected layer{targets.length === 1 ? "" : "s"}</strong>
          <ul>{targets.map((entry) => (
            <li key={entry.id}>{figureLabel(entry)} · {(entry.figure.curves ?? []).filter((curve) => curve.book === book).length} binding(s)</li>
          ))}</ul>
        </div>
        <div className="qzk-origin-recovery-list">
          {candidates.length === 0 && (
            <p className="qzk-origin-bulk-empty">No imported workbooks remain in this Origin project.</p>
          )}
          {candidates.map(({ dataset, preview }) => (
            <div className={`qzk-origin-recovery-candidate${selectedId === dataset.id ? " selected" : ""}`} key={dataset.id}>
              <div>
                <strong>{dataset.name}</strong>
                <small>{preview.canApply
                  ? `${preview.bindingCount} of ${preview.bindingCount} saved bindings match`
                  : `${preview.bindingCount - preview.incompatible.length} of ${preview.bindingCount} saved bindings match`}</small>
              </div>
              <Button
                size="sm"
                variant={selectedId === dataset.id ? "primary" : "default"}
                aria-label={`${selectedId === dataset.id ? "Selected" : "Preview"} ${dataset.name}`}
                onClick={() => setSelectedId(dataset.id)}
              >
                {selectedId === dataset.id ? "Selected" : "Preview"}
              </Button>
            </div>
          ))}
        </div>
        {selected && (
          <div className={`qzk-origin-bulk-preview${selected.preview.canApply ? "" : " blocked"}`} role="region" aria-label="Bulk resolution preview">
            <div><strong>Preview</strong>{selected.preview.canApply ? <Badge tone="ok">Safe to apply</Badge> : <Badge tone="danger">Incomplete match</Badge>}</div>
            <p>
              {selected.preview.canApply
                ? `${selected.dataset.name} will replace ${book} for ${selected.preview.bindingCount} saved bindings across ${selected.preview.entryIds.length} layers.`
                : `${selected.preview.incompatible.length} saved bindings cannot be reproduced from ${selected.dataset.name}. Nothing will be applied.`}
            </p>
            {selected.preview.incompatible.length > 0 && (
              <ul>{selected.preview.incompatible.map((binding, index) => (
                <li key={`${binding.x}-${binding.y}-${index}`}>{binding.x || "X"} → {binding.y || "Y"}: {binding.reason.replaceAll("_", " ")}</li>
              ))}</ul>
            )}
          </div>
        )}
        <div className="qz-btn-row qzk-origin-bulk-actions">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" disabled={!selected?.preview.canApply || busy} onClick={() => void commit()}>
            {busy ? "Applying…" : selected ? `Apply to ${selected.preview.entryIds.length} layers` : "Choose a workbook"}
          </Button>
        </div>
        <small>The source project is never rewritten. This explicit mapping is saved with the Quantized workspace and can be undone or cleared.</small>
      </section>
    </ToolWindow>,
    document.body,
  );
}

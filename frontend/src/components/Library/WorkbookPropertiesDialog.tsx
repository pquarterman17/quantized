// The bounded, read-only workbook Properties dialog (UX-007). Editing remains
// in the established Rename, Move, and Add tag commands; this surface reports
// only facts captured by lib/workbookProperties' canonical projection.

import { useId, useRef } from "react";

import { useEscapeSurface } from "../../lib/escapeStack";
import { useWorkbookPropertiesDialog } from "../../store/workbookPropertiesDialog";
import { Button } from "../primitives";
import { useDialogFocus } from "../overlays/useDialogFocus";

function count(value: number, label: string): string {
  return `${value.toLocaleString()} ${label}${value === 1 ? "" : "s"}`;
}

function timestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

export default function WorkbookPropertiesDialog() {
  const properties = useWorkbookPropertiesDialog((state) => state.properties);
  const closeStore = useWorkbookPropertiesDialog((state) => state.close);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const open = properties !== null;
  const restoreFocus = useDialogFocus(dialogRef, open);

  const close = (): void => {
    // Restore synchronously before unmounting, avoiding the Library's global
    // Delete/Backspace handler ever seeing focus fall to <body>.
    restoreFocus();
    closeStore();
  };

  useEscapeSurface("modal", () => {
    close();
    return true;
  }, open);

  if (!properties) return null;

  return (
    <div className="qz-overlay-backdrop" onMouseDown={close}>
      <div
        className="qzk-glass qz-dialog qzk-workbook-properties"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        ref={dialogRef}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id={titleId}>Properties — {properties.name}</h2>
        <p id={descriptionId}>Read-only workbook information.</p>
        <dl className="qzk-workbook-properties-grid">
          <dt>Location</dt><dd>{properties.location}</dd>
          <dt>Worksheets</dt><dd>{count(properties.worksheetCount, "worksheet")}</dd>
          <dt>Artifacts</dt><dd>{count(properties.artifactCount, "artifact")}</dd>
          <dt>Data availability</dt><dd>{properties.availability}</dd>
          <dt>Source</dt><dd>{properties.source}</dd>
          {properties.sourcePath && <><dt>Source path</dt><dd>{properties.sourcePath}</dd></>}
          {properties.originBook && <><dt>Origin book</dt><dd>{properties.originBook}</dd></>}
          {properties.importedAt && <><dt>Imported</dt><dd>{timestamp(properties.importedAt)}</dd></>}
          {properties.tags.length > 0 && <><dt>Member tags</dt><dd>{properties.tags.join(", ")}</dd></>}
        </dl>
        <div className="qz-btn-row"><Button variant="primary" onClick={close}>Close</Button></div>
      </div>
    </div>
  );
}

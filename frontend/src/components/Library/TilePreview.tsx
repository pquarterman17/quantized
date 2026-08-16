// The Tile workspace's per-kind preview cell, extracted from
// LibraryWorkspace.tsx (E-c3) so the orchestrator stays under the
// component ceiling while virtualization lands there. Per-kind rendering
// is unchanged by the extraction: worksheets keep the honest table
// preview (PR E decision, never an inferred plot), containers show child
// counts, and artifacts render through the canonical thumbnail pipe
// (E-c1/E-c2). Under E-c3 virtualization a far-off-window tile UNMOUNTS —
// see useThumbnail's header for what that means for in-flight generation.

import { useRef } from "react";

import { fmtNum } from "../../lib/format";
import type { LibraryNode } from "../../lib/libraryHierarchy";
import { useThumbnail } from "./useThumbnail";

export const KIND_LABEL: Record<LibraryNode["kind"], string> = {
  folder: "Folder",
  workbook: "Workbook",
  worksheet: "Worksheet",
  "origin-figure": "Origin figure",
  "editable-figure": "Editable figure",
  "publication-figure": "Publication figure",
  page: "Figure page",
  report: "Report",
};

const KIND_GLYPH: Record<LibraryNode["kind"], string> = {
  folder: "▰",
  workbook: "▤",
  worksheet: "▦",
  "origin-figure": "⌁",
  "editable-figure": "⌁",
  "publication-figure": "⌁",
  page: "▧",
  report: "≡",
};

function WorksheetPreview({ node }: { node: Extract<LibraryNode, { kind: "worksheet" }> }) {
  if (node.entity.pending) {
    return (
      <div className="qzk-tile-placeholder">
        <span aria-hidden="true">{KIND_GLYPH.worksheet}</span>
        <small>Data loads when opened</small>
      </div>
    );
  }
  const columnCount = Math.min(4, node.entity.data.labels.length || node.entity.data.values[0]?.length || 0);
  const labels = Array.from(
    { length: columnCount },
    (_, index) => node.entity.data.labels[index] || `Column ${index + 1}`,
  );
  const rows = node.entity.data.values.slice(0, 3);
  return (
    <div className="qzk-tile-table" aria-label={`Data preview for ${node.name}`}>
      <div className="qzk-tile-table-row head">
        {labels.map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}
      </div>
      {rows.map((row, rowIndex) => (
        <div className="qzk-tile-table-row" key={rowIndex}>
          {Array.from({ length: columnCount }, (_, col) => (
            <span key={col}>{fmtNum(row[col])}</span>
          ))}
        </div>
      ))}
    </div>
  );
}

/** E-c2: artifact tiles render through the canonical thumbnail pipe —
 *  visible-only generation, revision-keyed cache, abort on unmount (see
 *  useThumbnail), with a consistent visual language for every lifecycle
 *  state rather than renderer-specific placeholder copy. */
function ArtifactPreview({ node }: { node: LibraryNode }) {
  const holderRef = useRef<HTMLDivElement | null>(null);
  const thumb = useThumbnail(node, holderRef);
  const missing = node.source.missingDatasetIds.length > 0;
  const caption = missing
    ? "Source unavailable"
    : thumb.status === "error"
      ? "Preview unavailable"
      : thumb.status === "unsupported"
        ? "Preview not available for this item"
        : thumb.status === "ready"
          ? null
          : "Generating preview…";
  return (
    <div className={`qzk-tile-placeholder qzk-artifact-preview is-${thumb.status}${missing ? " has-missing-source" : ""}`} ref={holderRef}>
      {thumb.status === "ready" ? (
        <img
          className="qzk-tile-thumb"
          src={thumb.result.url}
          width={thumb.result.width}
          height={thumb.result.height}
          alt={`Preview of ${node.name}`}
        />
      ) : (
        <>
          <span className="qzk-preview-kind" aria-hidden="true">{KIND_GLYPH[node.kind]}</span>
          {thumb.status === "loading" && <span className="qzk-preview-skeleton" aria-hidden="true" />}
        </>
      )}
      {caption && <small role={thumb.status === "error" ? "status" : undefined}>{caption}</small>}
      <span className="qzk-preview-badge" aria-hidden="true">{KIND_LABEL[node.kind]}</span>
    </div>
  );
}

export default function TilePreview({ node }: { node: LibraryNode }) {
  if (node.kind === "worksheet") return <WorksheetPreview node={node} />;
  if (node.kind === "folder" || node.kind === "workbook") {
    const children = node.children.length;
    return (
      <div className="qzk-tile-placeholder">
        <span aria-hidden="true">{KIND_GLYPH[node.kind]}</span>
        <small>{children} item{children === 1 ? "" : "s"}</small>
      </div>
    );
  }
  return <ArtifactPreview node={node} />;
}

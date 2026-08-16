// Compact, kind-specific Tile captions. Pure so every summary remains honest
// and testable; PR E-c will replace placeholders with real thumbnails, not
// reinterpret these artifact/source facts.

import { dimensionsOf } from "./libraryDetails";
import type { LibraryNode } from "./libraryHierarchy";

export interface LibraryTileSummary {
  primary: string;
  secondary: string | null;
  warning: string | null;
}

const count = (value: number, singular: string): string =>
  `${value.toLocaleString()} ${singular}${value === 1 ? "" : "s"}`;

export function libraryTileSummary(node: LibraryNode): LibraryTileSummary {
  const missing = node.source.missingDatasetIds.length > 0 ? "Source unavailable" : null;
  switch (node.kind) {
    case "folder":
      return { primary: count(node.children.length, "item"), secondary: "Folder", warning: null };
    case "workbook": {
      const worksheets = node.children.filter((child) => child.kind === "worksheet").length;
      const source = node.entity.source ? "Linked source" : "Project data";
      return { primary: count(worksheets, "worksheet"), secondary: source, warning: null };
    }
    case "worksheet":
      return {
        primary: dimensionsOf(node),
        secondary: node.entity.pending ? "On demand" : node.entity.source ? "Linked source" : "Embedded data",
        warning: null,
      };
    case "origin-figure":
      return {
        primary: count(node.entity.figure.n_curves, "curve"),
        secondary: node.entity.figure.fidelity?.status.replace("_", " ") ?? "Fidelity not assessed",
        warning: missing,
      };
    case "editable-figure":
      return { primary: `${node.entity.plot.mark} plot`, secondary: node.entity.data.mode === "live" ? "Live data" : "Frozen data", warning: missing };
    case "publication-figure":
      return { primary: node.entity.config.style, secondary: node.entity.live ? "Live data" : "Frozen data", warning: missing };
    case "page":
      return { primary: `${node.entity.rows} × ${node.entity.cols} panels`, secondary: "Editable figure page", warning: missing };
    case "report":
      return { primary: count(node.entity.report.sections.length, "section"), secondary: "Analysis report", warning: missing };
  }
}

import type { Dataset } from "./types";
import type { OriginFidelityEntry } from "./originFidelity";
import { figureLabel, type OriginFigureEntry } from "./originFigures";
import { isOriginPreviewUsable } from "./originPreview";
import { resolveOriginFigureSources, type UnresolvedOriginBinding } from "./originSources";

export type OriginMigrationState = "needs_review" | "approximate" | "recovered" | "reference_only";

export interface OriginMigrationGraph {
  id: string;
  entry: OriginFigureEntry;
  entryIds: string[];
  label: string;
  layers: number;
  state: OriginMigrationState;
  detail: string;
  sourceDatasetIds: string[];
  unresolved: UnresolvedOriginBinding[];
  previewEntry?: OriginFigureEntry;
  canOpen: boolean;
}

export interface OriginMigrationProject {
  fidelity: OriginFidelityEntry;
  graphs: OriginMigrationGraph[];
  bookCount: number;
  pendingBookCount: number;
  needsReview: number;
  recovered: number;
  referenceOnly: number;
  issueGroups: OriginMigrationIssueGroup[];
  sourceMappings: OriginMigrationSourceMapping[];
}

export interface OriginMigrationIssueGroup {
  id: string;
  book: string;
  reason: UnresolvedOriginBinding["reason"];
  graphIds: string[];
  bindingCount: number;
}

export interface OriginMigrationSourceMapping {
  id: string;
  book: string;
  datasetId: string;
  entryIds: string[];
  graphIds: string[];
}

function sameImport(entry: OriginFigureEntry, fidelity: OriginFidelityEntry): boolean {
  const ids = new Set(fidelity.siblingIds);
  return entry.siblingIds.some((id) => ids.has(id));
}

function graphKey(entry: OriginFigureEntry): string {
  // A multi-layer Origin window is one user-facing graph. Empty names cannot
  // safely be grouped: separate nameless records may be unrelated.
  return entry.figure.name ? `${entry.siblingIds[0] ?? entry.stem}:${entry.figure.name}` : entry.id;
}

function graphState(
  representative: OriginFigureEntry,
  family: OriginFigureEntry[],
  figures: OriginFigureEntry[],
  datasets: Dataset[],
): Pick<OriginMigrationGraph, "state" | "detail" | "sourceDatasetIds" | "unresolved" | "canOpen"> {
  const resolution = resolveOriginFigureSources(representative, figures, datasets);
  const unresolved = resolution.unresolved;
  const decodedCurves = family.reduce((count, item) => count + (item.figure.curves?.length ?? 0), 0);
  const declaredCurves = family.reduce((count, item) => count + Math.max(0, item.figure.n_curves), 0);
  const fidelityStates = family.map((item) => item.figure.fidelity?.status).filter(Boolean);
  const hasDirectTarget = family.some((item) => item.datasetId != null);
  const hasExplicitMapping = family.some(
    (item) => Object.keys(item.sourceOverrides ?? {}).length > 0,
  );
  // `resolution.sources` alone is diagnostic: an old entry can have a book
  // whose columns resolve even though no executable target was ever assigned.
  // Only a decoded target or a validated explicit mapping may enable Open.
  const hasTarget = hasDirectTarget || (hasExplicitMapping && resolution.sources.length > 0);
  const canOpen = hasTarget && (decodedCurves === 0 || resolution.sources.length > 0);
  const sourceDatasetIds = resolution.sources.map((source) => source.datasetId);

  if (fidelityStates.includes("reference_only")) {
    return {
      state: "reference_only",
      detail: "A saved reference is available, but Quantized cannot rebuild this as an editable graph.",
      sourceDatasetIds,
      unresolved,
      canOpen: false,
    };
  }
  if (declaredCurves === 0 && decodedCurves === 0) {
    return {
      state: "needs_review",
      detail: "No plotted curves were decoded from this graph record.",
      sourceDatasetIds,
      unresolved,
      canOpen: false,
    };
  }
  if (!hasTarget || unresolved.length > 0 || (decodedCurves > 0 && resolution.sources.length === 0)) {
    return {
      state: "needs_review",
      detail: unresolved.length > 0
        ? `${unresolved.length} saved source binding${unresolved.length === 1 ? "" : "s"} need attention.`
        : !hasTarget && resolution.sources.length > 0
        ? "Source columns were found, but this graph has no confirmed workbook assignment."
        : "The saved graph could not be matched to an imported workbook.",
      sourceDatasetIds,
      unresolved,
      canOpen,
    };
  }
  if (fidelityStates.includes("unresolved")) {
    return {
      state: "needs_review",
      detail: "The graph opened, but Origin reported unresolved content.",
      sourceDatasetIds,
      unresolved,
      canOpen,
    };
  }
  if (decodedCurves === 0 || fidelityStates.includes("best_effort") || fidelityStates.length === 0) {
    return {
      state: "approximate",
      detail: decodedCurves === 0
        ? "The workbook match is heuristic because exact curve bindings were not decoded."
        : "The editable graph was recovered with documented omissions.",
      sourceDatasetIds,
      unresolved,
      canOpen,
    };
  }
  return {
    state: "recovered",
    detail: "The decoded curve bindings and source workbook are available.",
    sourceDatasetIds,
    unresolved,
    canOpen,
  };
}

export function buildOriginMigrationProjects(
  fidelityEntries: OriginFidelityEntry[],
  figures: OriginFigureEntry[],
  datasets: Dataset[],
): OriginMigrationProject[] {
  return fidelityEntries.map((fidelity) => {
    const importFigures = figures.filter((entry) => sameImport(entry, fidelity));
    const grouped = new Map<string, OriginFigureEntry[]>();
    for (const entry of importFigures) {
      const key = graphKey(entry);
      grouped.set(key, [...(grouped.get(key) ?? []), entry]);
    }
    const graphs = [...grouped.entries()].map(([id, family]) => {
      const sorted = [...family].sort((a, b) => (a.figure.layer ?? 1) - (b.figure.layer ?? 1));
      const representative = sorted[0];
      // Applying a family through an unresolved first layer is a silent no-op.
      // Prefer either a directly resolved layer or one carrying the explicit
      // source choice that apply can project, while keeping layer 1 for the
      // page label. A bulk choice may legitimately affect only a later layer.
      const actionEntry = sorted.find((item) => item.datasetId != null)
        ?? sorted.find((item) => Object.keys(item.sourceOverrides ?? {}).length > 0)
        ?? representative;
      return {
        id,
        entry: actionEntry,
        entryIds: sorted.map((item) => item.id),
        label: figureLabel(representative).replace(/ · layer \d+$/, ""),
        layers: sorted.length,
        previewEntry: sorted.find((item) => isOriginPreviewUsable(item.figure.saved_preview)),
        ...graphState(actionEntry, sorted, importFigures, datasets),
      };
    }).sort((a, b) => {
      const rank: Record<OriginMigrationState, number> = { needs_review: 0, approximate: 1, reference_only: 2, recovered: 3 };
      return rank[a.state] - rank[b.state] || a.label.localeCompare(b.label, undefined, { numeric: true });
    });
    const siblingSet = new Set(fidelity.siblingIds);
    const books = datasets.filter((dataset) => siblingSet.has(dataset.id));
    const issueMap = new Map<string, OriginMigrationIssueGroup>();
    for (const graph of graphs) {
      for (const binding of graph.unresolved) {
        const id = `${binding.book}\u0000${binding.reason}`;
        const group = issueMap.get(id) ?? {
          id, book: binding.book, reason: binding.reason, graphIds: [], bindingCount: 0,
        };
        group.bindingCount += 1;
        if (!group.graphIds.includes(graph.id)) group.graphIds.push(graph.id);
        issueMap.set(id, group);
      }
    }
    const mappingMap = new Map<string, OriginMigrationSourceMapping>();
    for (const entry of importFigures) {
      for (const [book, datasetId] of Object.entries(entry.sourceOverrides ?? {})) {
        const id = `${book}\u0000${datasetId}`;
        const graphId = graphs.find((graph) => graph.entryIds.includes(entry.id))?.id;
        const mapping = mappingMap.get(id) ?? {
          id, book, datasetId, entryIds: [], graphIds: [],
        };
        if (!mapping.entryIds.includes(entry.id)) mapping.entryIds.push(entry.id);
        if (graphId && !mapping.graphIds.includes(graphId)) mapping.graphIds.push(graphId);
        mappingMap.set(id, mapping);
      }
    }
    return {
      fidelity,
      graphs,
      bookCount: books.length,
      pendingBookCount: books.filter((dataset) => dataset.pending != null).length,
      needsReview: graphs.filter((graph) => graph.state === "needs_review" || graph.state === "approximate").length,
      recovered: graphs.filter((graph) => graph.state === "recovered").length,
      // Filtered/internal records are disclosed separately below the graph
      // list. They are not user graph windows and must not inflate this tile.
      referenceOnly: graphs.filter((graph) => graph.state === "reference_only").length,
      issueGroups: [...issueMap.values()].sort((a, b) =>
        b.graphIds.length - a.graphIds.length || a.book.localeCompare(b.book, undefined, { numeric: true }),
      ),
      sourceMappings: [...mappingMap.values()].sort((a, b) =>
        a.book.localeCompare(b.book, undefined, { numeric: true }),
      ),
    };
  });
}

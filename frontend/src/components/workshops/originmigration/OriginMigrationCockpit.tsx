import { useEffect, useMemo, useState } from "react";

import { useEscapeSurface } from "../../../lib/escapeStack";
import { originFidelityLabel, originFidelityStatusLabel } from "../../../lib/originFidelity";
import {
  buildOriginMigrationProjects,
  type OriginMigrationGraph,
  type OriginMigrationState,
} from "../../../lib/originMigration";
import { originPreviewDataUrl } from "../../../lib/originPreview";
import {
  openTechniqueWorkflow,
  setOriginReviewsDeferred,
  syncOriginReviewScope,
  toggleOriginReviewDeferred,
  useOriginReviewDeferred,
} from "../../../lib/workflowWorkspace";
import { useApp } from "../../../store/useApp";
import { lazyRegion } from "../../../lib/lazyRegion";
import { Badge, Button } from "../../primitives";
import { clearOriginSourceMapping } from "./originSourceMappingCommands";

const OriginRecoveryWindow = lazyRegion(
  () => import("../../Library/OriginRecoveryWindow"),
  "Origin recovery",
);
const OriginSavedPreviewWindow = lazyRegion(
  () => import("../../Library/OriginSavedPreviewWindow"),
  "Origin preview",
);
const OriginBulkRecoveryWindow = lazyRegion(
  () => import("./OriginBulkRecoveryWindow"),
  "Origin bulk recovery",
);

type Filter = "attention" | "all" | "recovered";

// The 127 MB corpus project currently contains 205 graph windows. Rendering
// every row (and every button/source lookup) synchronously made opening the
// cockpit look frozen. Keep the first useful screen immediate and expand only
// at the user's request.
const GRAPH_BATCH_SIZE = 40;

function stateBadge(state: OriginMigrationState) {
  if (state === "recovered") return <Badge tone="ok">Recovered</Badge>;
  if (state === "reference_only") return <Badge>Reference only</Badge>;
  if (state === "approximate") return <Badge tone="warn">Check result</Badge>;
  return <Badge tone="danger">Needs review</Badge>;
}

function GraphReviewRow({
  graph,
  deferred,
  onToggleDeferred,
}: {
  graph: OriginMigrationGraph;
  deferred: boolean;
  onToggleDeferred: () => void;
}) {
  const datasets = useApp((s) => s.datasets);
  const apply = useApp((s) => s.applyOriginFigure);
  const openSource = useApp((s) => s.openOriginFigureSource);
  const [showRecovery, setShowRecovery] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const preview = graph.previewEntry?.figure.saved_preview;
  const previewSrc = originPreviewDataUrl(preview);

  return (
    <article className={`qzk-origin-migration-row${deferred ? " deferred" : ""}`}>
      <div className="qzk-origin-migration-row-head">
        <div>
          <h3>{graph.label}</h3>
          <p>{graph.detail}</p>
        </div>
        <div className="qzk-origin-migration-badges">
          {stateBadge(graph.state)}
          {graph.layers > 1 && <Badge>{graph.layers} panels</Badge>}
          {deferred && <Badge>Review later</Badge>}
        </div>
      </div>
      {graph.unresolved.length > 0 && (
        <ul className="qzk-origin-migration-issues" aria-label="Unresolved saved sources">
          {graph.unresolved.slice(0, 3).map((binding, index) => (
            <li key={`${binding.book}-${binding.x}-${binding.y}-${index}`}>
              <strong>{binding.book}</strong> · {binding.x || "X"} → {binding.y || "Y"}
              <span>{binding.reason.replaceAll("_", " ")}</span>
            </li>
          ))}
          {graph.unresolved.length > 3 && <li>+ {graph.unresolved.length - 3} more saved bindings</li>}
        </ul>
      )}
      <div className="qz-btn-row qzk-origin-migration-actions">
        <Button
          size="sm"
          variant="primary"
          disabled={!graph.canOpen}
          title={!graph.canOpen ? "Resolve a source workbook before opening an editable graph" : undefined}
          onClick={() => apply(graph.entry.id)}
        >
          Open editable graph
        </Button>
        {graph.sourceDatasetIds.map((datasetId) => {
          const name = datasets.find((dataset) => dataset.id === datasetId)?.name ?? "source workbook";
          return (
            <Button key={datasetId} size="sm" onClick={() => void openSource(graph.entry.id, datasetId)}>
              Inspect {name}
            </Button>
          );
        })}
        {graph.unresolved.length > 0 && (
          <Button size="sm" onClick={() => setShowRecovery(true)}>Resolve source…</Button>
        )}
        {previewSrc && (
          <Button size="sm" onClick={() => setShowPreview(true)}>Compare saved preview</Button>
        )}
        {(graph.state === "needs_review" || graph.state === "approximate") && (
          <Button size="sm" onClick={onToggleDeferred}>{deferred ? "Return to review" : "Review later"}</Button>
        )}
      </div>
      {showRecovery && (
        <OriginRecoveryWindow entry={graph.entry} onClose={() => setShowRecovery(false)} />
      )}
      {showPreview && previewSrc && graph.previewEntry && (
        <OriginSavedPreviewWindow
          entry={graph.previewEntry}
          src={previewSrc}
          onClose={() => setShowPreview(false)}
        />
      )}
    </article>
  );
}

export default function OriginMigrationCockpit({
  initialFidelityId,
  onClose,
}: {
  initialFidelityId?: string;
  onClose: () => void;
}) {
  const fidelityEntries = useApp((s) => s.originFidelity);
  const figures = useApp((s) => s.originFigures);
  const datasets = useApp((s) => s.datasets);
  const projects = useMemo(
    () => buildOriginMigrationProjects(fidelityEntries, figures, datasets),
    [fidelityEntries, figures, datasets],
  );
  const [selectedId, setSelectedId] = useState(initialFidelityId);
  const [filter, setFilter] = useState<Filter>("attention");
  const [query, setQuery] = useState("");
  const [visibleLimit, setVisibleLimit] = useState(GRAPH_BATCH_SIZE);
  const [issueGroupId, setIssueGroupId] = useState<string | null>(null);
  const [bulkBook, setBulkBook] = useState<string | null>(null);
  const deferred = useOriginReviewDeferred();
  const selected = projects.find((project) => project.fidelity.id === selectedId) ?? projects[0];

  useEffect(() => syncOriginReviewScope(fidelityEntries), [fidelityEntries]);

  useEffect(() => {
    if (selected && selected.fidelity.id !== selectedId) setSelectedId(selected.fidelity.id);
  }, [selected, selectedId]);

  useEffect(() => {
    // Search/group/dialog state describes one project. Carrying it into a
    // different import can produce an apparently empty cockpit or a recovery
    // dialog for a workbook name that only existed in the previous project.
    setQuery("");
    setIssueGroupId(null);
    setBulkBook(null);
  }, [selected?.fidelity]);

  useEffect(() => {
    setVisibleLimit(GRAPH_BATCH_SIZE);
  }, [selected?.fidelity.id, filter, issueGroupId, query]);

  useEscapeSurface("workspace", () => {
    onClose();
    return true;
  });

  const returnToWorkflow = () => openTechniqueWorkflow();

  if (!selected) {
    return (
      <section className="qzk-technique-workspace" aria-labelledby="origin-migration-title">
        <header className="qzk-technique-head">
          <div>
            <div className="qzk-technique-eyebrow">Origin migration review</div>
            <h1 id="origin-migration-title">No Origin import to review</h1>
            <p>Import an Origin project to see recovered workbooks, graphs, and unresolved sources here.</p>
          </div>
          <div className="qz-btn-row"><Button onClick={returnToWorkflow}>Technique workflow</Button><Button onClick={onClose}>Back to plot</Button></div>
        </header>
      </section>
    );
  }

  const manifest = selected.fidelity.manifest;
  const issueGroup = selected.issueGroups.find((group) => group.id === issueGroupId);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleGraphs = selected.graphs.filter((graph) => {
    if (issueGroup && !issueGroup.graphIds.includes(graph.id)) return false;
    if (filter === "all") return true;
    if (filter === "recovered") return graph.state === "recovered";
    return graph.state === "needs_review" || graph.state === "approximate";
  }).filter((graph) => !normalizedQuery || graph.label.toLocaleLowerCase().includes(normalizedQuery))
    .sort((a, b) => Number(deferred.has(`${selected.fidelity.id}:${a.id}`)) - Number(deferred.has(`${selected.fidelity.id}:${b.id}`)));
  const renderedGraphs = visibleGraphs.slice(0, visibleLimit);
  const remainingGraphs = visibleGraphs.length - renderedGraphs.length;
  const reviewKeys = visibleGraphs
    .filter((graph) => graph.state === "needs_review" || graph.state === "approximate")
    .map((graph) => `${selected.fidelity.id}:${graph.id}`);
  const allVisibleDeferred = reviewKeys.length > 0 && reviewKeys.every((key) => deferred.has(key));

  return (
    <section className="qzk-technique-workspace qzk-origin-migration" aria-labelledby="origin-migration-title">
      <header className="qzk-technique-head">
        <div>
          <div className="qzk-technique-eyebrow">Origin migration review</div>
          <h1 id="origin-migration-title">{selected.fidelity.stem}</h1>
          <p>Review what became editable, what needs a source choice, and what remains reference-only.</p>
        </div>
        <div className="qz-btn-row"><Button onClick={returnToWorkflow}>Technique workflow</Button><Button onClick={onClose}>Back to plot</Button></div>
      </header>

      {projects.length > 1 && (
        <label className="qzk-origin-migration-project">
          <span>Imported project</span>
          <select className="qz-input" value={selected.fidelity.id} onChange={(event) => setSelectedId(event.target.value)}>
            {projects.map((project) => (
              <option key={project.fidelity.id} value={project.fidelity.id}>{project.fidelity.stem}</option>
            ))}
          </select>
        </label>
      )}

      <div className="qzk-origin-migration-summary" aria-label="Origin import summary">
        <div><strong>{selected.bookCount}</strong><span>workbooks</span><small>{selected.pendingBookCount ? `${selected.pendingBookCount} load on first use` : "ready"}</small></div>
        <div><strong>{selected.graphs.length}</strong><span>graph windows</span><small>{manifest.graph_records_actionable}/{manifest.graph_records_total} records actionable</small></div>
        <div className={selected.needsReview ? "attention" : ""}><strong>{selected.needsReview}</strong><span>need review</span><small>shown first</small></div>
        <div><strong>{selected.referenceOnly}</strong><span>reference only</span><small>not presented as editable</small></div>
      </div>

      <div className="qzk-origin-migration-disclosure">
        <Badge tone={manifest.status === "exact" ? "ok" : manifest.status === "unresolved" ? "danger" : "warn"}>
          {originFidelityStatusLabel(manifest.status)} import
        </Badge>
        <span>
          {manifest.omissions.length > 0
            ? `Not recovered: ${manifest.omissions.map(originFidelityLabel).join(", ")}.`
            : "No project-level omissions were reported."}
        </span>
      </div>

      {selected.issueGroups.length > 0 && (
        <div className="qzk-origin-migration-issue-groups" aria-label="Unresolved source groups">
          <strong>Source issues</strong>
          <div>
            {selected.issueGroups.map((group) => (
              <Button
                key={group.id}
                size="sm"
                variant={issueGroupId === group.id ? "primary" : "default"}
                onClick={() => {
                  setIssueGroupId((current) => current === group.id ? null : group.id);
                  setFilter("attention");
                }}
              >
                {group.book || "Unknown book"} · {group.reason.replaceAll("_", " ")} ({group.graphIds.length} graph{group.graphIds.length === 1 ? "" : "s"})
              </Button>
            ))}
          </div>
        </div>
      )}

      {issueGroup && (
        <div className="qzk-origin-migration-bulk-callout">
          <div>
            <strong>Resolve repeated source together</strong>
            <span>
              Preview one workbook choice for {issueGroup.bindingCount} saved binding{issueGroup.bindingCount === 1 ? "" : "s"} across {issueGroup.graphIds.length} graph{issueGroup.graphIds.length === 1 ? "" : "s"}.
            </span>
          </div>
          <Button size="sm" variant="primary" onClick={() => setBulkBook(issueGroup.book)}>
            Preview bulk resolution…
          </Button>
        </div>
      )}

      {selected.sourceMappings.length > 0 && (
        <div className="qzk-origin-migration-mappings" role="region" aria-label="Saved Origin source mappings">
          <strong>Saved source choices</strong>
          {selected.sourceMappings.map((mapping) => {
            const target = datasets.find((dataset) => dataset.id === mapping.datasetId);
            return (
              <div key={mapping.id}>
                <span><strong>{mapping.book || "Unknown book"}</strong> → {target?.name ?? "missing workbook"} · {mapping.graphIds.length} graph{mapping.graphIds.length === 1 ? "" : "s"}</span>
                <div className="qz-btn-row">
                  <Button size="sm" aria-label={`Review or change mapping for ${mapping.book || "Unknown book"}`} onClick={() => setBulkBook(mapping.book)}>Review or change…</Button>
                  <Button size="sm" aria-label={`Clear mapping for ${mapping.book || "Unknown book"}`} onClick={() => void clearOriginSourceMapping(
                    mapping.book, mapping.entryIds,
                  )}>Clear</Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="qzk-origin-migration-toolbar" role="group" aria-label="Filter recovered graphs">
        <Button size="sm" variant={filter === "attention" && !issueGroup ? "primary" : "default"} onClick={() => { setFilter("attention"); setIssueGroupId(null); }}>Needs review ({selected.needsReview})</Button>
        <Button size="sm" variant={filter === "all" ? "primary" : "default"} onClick={() => { setFilter("all"); setIssueGroupId(null); }}>All graphs ({selected.graphs.length})</Button>
        <Button size="sm" variant={filter === "recovered" ? "primary" : "default"} onClick={() => { setFilter("recovered"); setIssueGroupId(null); }}>Recovered ({selected.recovered})</Button>
        <label className="qzk-origin-migration-search">
          <span>Search graph windows</span>
          <input
            className="qz-input"
            type="search"
            value={query}
            placeholder="Graph name…"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {reviewKeys.length > 1 && (
          <Button
            size="sm"
            onClick={() => setOriginReviewsDeferred(reviewKeys, !allVisibleDeferred)}
          >
            {allVisibleDeferred ? "Return matching to review" : "Review matching later"}
          </Button>
        )}
      </div>

      <div className="qzk-origin-migration-list">
        {renderedGraphs.map((graph) => (
          <GraphReviewRow
            key={graph.id}
            graph={graph}
            deferred={deferred.has(`${selected.fidelity.id}:${graph.id}`)}
            onToggleDeferred={() => toggleOriginReviewDeferred(`${selected.fidelity.id}:${graph.id}`)}
          />
        ))}
        {renderedGraphs.length === 0 && (
          <div className="qzk-technique-empty">
            {issueGroup ? "No graph windows remain in this source-issue group." : filter === "attention" ? "No graph windows currently need review." : "No graph windows match this filter."}
          </div>
        )}
        {remainingGraphs > 0 && (
          <div className="qzk-origin-migration-more">
            <span role="status" aria-live="polite">Showing {renderedGraphs.length} of {visibleGraphs.length} matching graph windows.</span>
            <Button
              size="sm"
              onClick={() => setVisibleLimit((current) => current + GRAPH_BATCH_SIZE)}
            >
              Show {Math.min(GRAPH_BATCH_SIZE, remainingGraphs)} more
            </Button>
          </div>
        )}
      </div>

      {manifest.filtered_figures.length > 0 && (
        <details className="qzk-origin-migration-filtered">
          <summary>{manifest.filtered_figures.length} non-editable Origin record{manifest.filtered_figures.length === 1 ? "" : "s"}</summary>
          <ul>{manifest.filtered_figures.map((figure) => <li key={`${figure.index}-${figure.name}`}>{figure.name || `Record ${figure.index}`} — {figure.reason}</li>)}</ul>
        </details>
      )}
      {bulkBook !== null && (
        <OriginBulkRecoveryWindow
          key={`${selected.fidelity.id}:${bulkBook}`}
          fidelityId={selected.fidelity.id}
          book={bulkBook}
          onClose={() => setBulkBook(null)}
        />
      )}
    </section>
  );
}

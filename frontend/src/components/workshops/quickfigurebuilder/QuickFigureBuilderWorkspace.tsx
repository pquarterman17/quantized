import { useEffect, useState } from "react";

import {
  assignQuickFigureColumn,
  initialQuickFigureMapping,
  mappingReady,
  useAcquisitionAxis,
  type QuickColumnAssignment,
} from "../../../lib/quickFigureMapping";
import { incompleteAsymmetricPairs } from "../../../lib/errorRoles";
import { quickFigurePreview, type QuickPlotStyle } from "../../../lib/quickFigurePreview";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import GraphPreview from "../graphbuilder/GraphPreview";
import QuickMappingPanel from "./QuickMappingPanel";

function BuilderForDataset({ dataset, close }: { dataset: Dataset; close: () => void }) {
  const [mapping, setMapping] = useState(() => initialQuickFigureMapping(dataset));
  const [style, setStyle] = useState<QuickPlotStyle>("line");
  const assign = (channel: number, assignment: QuickColumnAssignment): void => {
    setMapping((current) => assignQuickFigureColumn(current, channel, assignment));
  };
  const xName = mapping.xKey === null
    ? String(dataset.data.metadata?.["x_column_long"] || dataset.data.metadata?.["x_column_name"] || "Acquisition axis")
    : dataset.data.labels[mapping.xKey];
  const preview = quickFigurePreview(dataset.data, mapping, style, dataset.channelRoles);
  const ready = mappingReady(mapping);
  // G4 review round (P2, FIX 2): a channel carrying a worksheet-level
  // Label/Ignore role (Inspector's Channels card) is filtered out by
  // `effectiveChannels` at render time even when explicitly assigned to Y
  // here -- the builder's own mapping UI doesn't consult `channelRoles`, so
  // this IS reachable. Named explicitly (L0.36: a dead interaction gets a
  // visible reason, never silent) rather than leaving the mismatch between
  // "N Y series" above and what actually renders unexplained.
  const roleFilteredYKeys = mapping.yKeys.filter((ch) => dataset.channelRoles?.[ch]);
  const incompletePairs = incompleteAsymmetricPairs(mapping.errorBindings);
  const incompleteErrorNotice = incompletePairs.map((pair) => {
    const targetName = pair.axis === "x"
      ? xName
      : (dataset.data.labels[pair.target] ?? `channel ${pair.target}`);
    const present = pair.plus !== null
      ? `+ "${dataset.data.labels[pair.plus]}"`
      : `− "${dataset.data.labels[pair.minus!]}"`;
    const missing = pair.plus === null ? "+" : "−";
    return `${pair.axis.toUpperCase()} error for "${targetName}" has ${present} but is missing ${missing}`;
  });
  const createDisabledReason = !ready
    ? "Assign at least one Y series to create a figure"
    : roleFilteredYKeys.length > 0
      ? "Clear the Label/Ignore role from every assigned Y column in the Channels card first"
      : incompleteErrorNotice.length > 0
        ? incompleteErrorNotice[0]
        : undefined;
  const createReasonId = !ready
    ? "quick-builder-preview-summary"
    : roleFilteredYKeys.length > 0
      ? "quick-builder-role-warning"
      : incompleteErrorNotice.length > 0
        ? "quick-builder-error-warning"
        : undefined;
  const createQuickFigureFromMapping = useApp((s) => s.createQuickFigureFromMapping);
  // Mutate FIRST, close only on success (L0.36: disabled with a reason, never
  // hidden -- the button itself is also gated on `ready` below). `close()`
  // unmounts the builder so Stage reappears already focused on the new
  // window -- the action's own `focusWindow` ran during creation, before
  // this handler ever calls `close`. A false return (dataset vanished
  // mid-click) leaves the builder open; the workspace's own missing-source
  // state (see the parent component below) takes over on the next render.
  const createFigure = (): void => {
    if (createQuickFigureFromMapping(dataset.id, mapping, style)) close();
  };

  return (
    <section className="qzk-quick-builder" aria-labelledby="quick-builder-title">
      <header className="qzk-quick-builder-head">
        <div>
          <div className="qzk-quick-builder-eyebrow">Quick Figure Builder</div>
          <h1 id="quick-builder-title">Configure {dataset.name}</h1>
          <p>Choose how this worksheet becomes an editable figure. The source data stays unchanged.</p>
        </div>
        <button type="button" className="qz-btn" onClick={close}>Cancel</button>
      </header>

      <div className="qzk-quick-builder-grid">
        <section className="qzk-quick-builder-card" aria-labelledby="quick-builder-columns">
          <div className="qzk-quick-builder-step">1</div>
          <h2 id="quick-builder-columns">Data columns</h2>
          <p>Assign the axes and uncertainty columns explicitly.</p>
          <QuickMappingPanel
            data={dataset.data}
            mapping={mapping}
            onAssign={assign}
            onUseAcquisitionX={() => setMapping(useAcquisitionAxis)}
          />
        </section>

        <section className="qzk-quick-builder-card qzk-quick-builder-preview" aria-labelledby="quick-builder-preview">
          <div className="qzk-quick-builder-step">2</div>
          <h2 id="quick-builder-preview">Live preview</h2>
          <p id="quick-builder-preview-summary" className="qzk-quick-builder-preview-summary" aria-live="polite">
            {mappingReady(mapping) ? `${mapping.yKeys.length} Y series against ${xName}` : "Mapping incomplete"}
          </p>
          {roleFilteredYKeys.length > 0 && (
            <p id="quick-builder-role-warning" className="qzk-quick-builder-notice" role="status">
              {roleFilteredYKeys.length === 1
                ? `"${dataset.data.labels[roleFilteredYKeys[0]]}" is marked Label/Ignore in this worksheet and won't appear on the created figure — clear its role in the Channels card first.`
                : `${roleFilteredYKeys.length} assigned Y channels are marked Label/Ignore in this worksheet and won't appear on the created figure — clear their roles in the Channels card first.`}
            </p>
          )}
          {incompleteErrorNotice.length > 0 && (
            <div id="quick-builder-error-warning" className="qzk-quick-builder-notice" role="status">
              {incompleteErrorNotice.map((notice) => <p key={notice}>{notice}.</p>)}
            </div>
          )}
          <GraphPreview render={preview} />
        </section>

        <section className="qzk-quick-builder-card" aria-labelledby="quick-builder-settings">
          <div className="qzk-quick-builder-step">3</div>
          <h2 id="quick-builder-settings">Figure setup</h2>
          <label className="qzk-quick-builder-field">
            <span>Plot style</span>
            <select value={style} onChange={(event) => setStyle(event.target.value as QuickPlotStyle)}>
              <option value="line">Line</option>
              <option value="scatter">Scatter</option>
              <option value="line-symbol">Line + symbol</option>
            </select>
          </label>
          <dl className="qzk-quick-builder-facts">
            <div><dt>Rows</dt><dd>{dataset.data.time.length.toLocaleString()}</dd></div>
            <div><dt>Value columns</dt><dd>{dataset.data.labels.length}</dd></div>
            <div><dt>Output</dt><dd>Editable figure</dd></div>
          </dl>
          <button
            type="button"
            className="qz-btn qz-primary"
            disabled={createDisabledReason !== undefined}
            title={createDisabledReason}
            aria-describedby={createReasonId}
            onClick={createFigure}
          >
            Create Editable Figure
          </button>
        </section>
      </div>
    </section>
  );
}

export default function QuickFigureBuilderWorkspace() {
  const datasetId = useApp((s) => s.quickFigureBuilderDatasetId);
  const dataset = useApp((s) => s.datasets.find((candidate) => candidate.id === datasetId));
  const close = useApp((s) => s.closeQuickFigureBuilder);

  useEffect(() => {
    const cancelOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const state = useApp.getState();
      if (state.cmdkOpen || document.querySelector(".qzk-ctx")) return;
      event.preventDefault();
      close();
    };
    window.addEventListener("keydown", cancelOnEscape);
    return () => window.removeEventListener("keydown", cancelOnEscape);
  }, [close]);

  if (!dataset) {
    return (
      <section className="qzk-quick-builder" aria-labelledby="quick-builder-title">
        <header className="qzk-quick-builder-head">
          <div><div className="qzk-quick-builder-eyebrow">Quick Figure Builder</div><h1 id="quick-builder-title">Worksheet unavailable</h1></div>
          <button type="button" className="qz-btn" onClick={close}>Close</button>
        </header>
        <p className="qzk-quick-builder-notice">The source worksheet was removed. Nothing was changed.</p>
      </section>
    );
  }
  return <BuilderForDataset key={dataset.id} dataset={dataset} close={close} />;
}

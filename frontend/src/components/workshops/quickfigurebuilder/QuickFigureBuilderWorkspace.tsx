import { useEffect, useState } from "react";

import {
  assignQuickFigureColumn,
  initialQuickFigureMapping,
  mappingReady,
  useAcquisitionAxis,
  type QuickColumnAssignment,
} from "../../../lib/quickFigureMapping";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import QuickMappingPanel from "./QuickMappingPanel";

function BuilderForDataset({ dataset, close }: { dataset: Dataset; close: () => void }) {
  const [mapping, setMapping] = useState(() => initialQuickFigureMapping(dataset));
  const assign = (channel: number, assignment: QuickColumnAssignment): void => {
    setMapping((current) => assignQuickFigureColumn(current, channel, assignment));
  };
  const xName = mapping.xKey === null
    ? String(dataset.data.metadata?.["x_column_long"] || dataset.data.metadata?.["x_column_name"] || "Acquisition axis")
    : dataset.data.labels[mapping.xKey];

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
          <div className="qzk-quick-builder-preview-empty">
            {mappingReady(mapping)
              ? `${mapping.yKeys.length} Y series against ${xName}. Live rendering arrives in G3.`
              : "Assign at least one Y series to preview the figure."}
          </div>
        </section>

        <section className="qzk-quick-builder-card" aria-labelledby="quick-builder-settings">
          <div className="qzk-quick-builder-step">3</div>
          <h2 id="quick-builder-settings">Figure setup</h2>
          <dl className="qzk-quick-builder-facts">
            <div><dt>Rows</dt><dd>{dataset.data.time.length.toLocaleString()}</dd></div>
            <div><dt>Value columns</dt><dd>{dataset.data.labels.length}</dd></div>
            <div><dt>Output</dt><dd>Editable figure</dd></div>
          </dl>
          <button type="button" className="qz-btn qz-primary" disabled>Create Editable Figure</button>
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

import { useEffect } from "react";

import { useApp } from "../../../store/useApp";

function usefulColumns(labels: readonly string[], units: readonly string[]): string[] {
  return labels.map((label, index) => units[index] ? `${label} (${units[index]})` : label);
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

  const columns = usefulColumns(dataset.data.labels, dataset.data.units);
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
          <p>Role assignment is the next stacked slice.</p>
          <ul className="qzk-quick-builder-columns">
            <li><span>Source X</span><strong>Acquisition axis</strong></li>
            {columns.map((column, index) => <li key={`${index}:${column}`}><span>{column}</span><strong>Unassigned</strong></li>)}
          </ul>
        </section>

        <section className="qzk-quick-builder-card qzk-quick-builder-preview" aria-labelledby="quick-builder-preview">
          <div className="qzk-quick-builder-step">2</div>
          <h2 id="quick-builder-preview">Live preview</h2>
          <div className="qzk-quick-builder-preview-empty">Assign X and Y roles to preview the figure.</div>
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

import { useEffect, useState } from "react";

import {
  assignQuickFigureColumn,
  axisDisplayName,
  canCreateQuickFigure,
  incompleteErrorNotices,
  initialQuickFigureMapping,
  mappingReady,
  roleFilteredYKeys,
  useAcquisitionAxis,
  type QuickColumnAssignment,
} from "../../../lib/quickFigureMapping";
import { quickFigurePreview, type QuickPlotStyle } from "../../../lib/quickFigurePreview";
import type { QuickPlotTemplateScope } from "../../../lib/quickPlotTemplates";
import type { Dataset } from "../../../lib/types";
import { askParams } from "../../overlays/ParamDialog";
import { useApp } from "../../../store/useApp";
import GraphPreview from "../graphbuilder/GraphPreview";
import QuickMappingPanel from "./QuickMappingPanel";

const SCHEMA_SCOPE_LABEL = "This data type and schema";
const WORKBOOK_SCOPE_LABEL = "This workbook only";

/** H5a: name + scope prompt, defaulting to the confirmed L0.31 schema scope.
 *  The workbook-only option is offered only when this worksheet actually
 *  belongs to a workbook (a bare imported dataset has nothing to scope to). */
function promptSaveTemplate(dataset: Dataset): Promise<{ name: string; scope: QuickPlotTemplateScope } | null> {
  const options = dataset.workbookId ? [SCHEMA_SCOPE_LABEL, WORKBOOK_SCOPE_LABEL] : [SCHEMA_SCOPE_LABEL];
  return askParams("Save Quick Plot Template", [
    { key: "name", label: "Name", type: "text", default: `${dataset.name} template` },
    ...(options.length > 1
      ? [{ key: "scope", label: "Scope", type: "select" as const, options, default: SCHEMA_SCOPE_LABEL }]
      : []),
  ]).then((result) => {
    if (!result) return null;
    const name = String(result.name).trim();
    if (!name) return null;
    const scope: QuickPlotTemplateScope =
      result.scope === WORKBOOK_SCOPE_LABEL && dataset.workbookId
        ? { kind: "workbook", workbookId: dataset.workbookId }
        : { kind: "schema" };
    return { name, scope };
  });
}

function BuilderForDataset({ dataset, close }: { dataset: Dataset; close: () => void }) {
  const [mapping, setMapping] = useState(() => initialQuickFigureMapping(dataset));
  const [style, setStyle] = useState<QuickPlotStyle>("line");
  const assign = (channel: number, assignment: QuickColumnAssignment): void => {
    setMapping((current) => assignQuickFigureColumn(current, channel, assignment));
  };
  const xName = axisDisplayName(dataset, mapping);
  const preview = quickFigurePreview(dataset.data, mapping, style, dataset.channelRoles);
  // G5 review round (P1, FIX 1): `canCreateQuickFigure` (lib/quickFigureMapping.ts)
  // is now the ONE predicate both this button and the store action
  // (`createQuickFigureFromMapping`) gate on -- composing `mappingReady`, the
  // role-filtered-Y check, and the incomplete-asymmetric-pair check that used
  // to live inline here ONLY, so the store action could be called directly
  // (a probe, a future caller) and skip them entirely. The per-condition
  // detail arrays below (`roleFilteredYChannels`, `incompleteErrorNotice`)
  // still live here -- they drive the notices' full text/list, which the
  // single `reason` string in the gate result does not carry.
  const gate = canCreateQuickFigure(dataset, mapping);
  // G4 review round (P2, FIX 2): a channel carrying a worksheet-level
  // Label/Ignore role (Inspector's Channels card) is filtered out by
  // `effectiveChannels` at render time even when explicitly assigned to Y
  // here -- the builder's own mapping UI doesn't consult `channelRoles`, so
  // this IS reachable. Named explicitly (L0.36: a dead interaction gets a
  // visible reason, never silent) rather than leaving the mismatch between
  // "N Y series" above and what actually renders unexplained.
  const roleFilteredYChannels = roleFilteredYKeys(dataset, mapping);
  const incompleteErrorNotice = incompleteErrorNotices(dataset, mapping);
  // FIX 3(a): when BOTH a role-filtered Y channel and an incomplete error
  // pair are present, both notices render -- the disabled reason/aria must
  // say so too, not silently report only the higher-priority one.
  const jointBlock = roleFilteredYChannels.length > 0 && incompleteErrorNotice.length > 0;
  const createDisabledReason = gate.ok
    ? undefined
    : jointBlock
      ? `${gate.reason}. Also blocked: ${incompleteErrorNotice[0]}.`
      : gate.reason;
  const createReasonId = gate.ok
    ? undefined
    : jointBlock
      ? "quick-builder-role-warning quick-builder-error-warning"
      : gate.reasonId;
  const createQuickFigureFromMapping = useApp((s) => s.createQuickFigureFromMapping);
  const saveQuickPlotTemplate = useApp((s) => s.saveQuickPlotTemplate);
  // H5a: "Save Quick Plot Template…" is gated on the SAME `canCreateQuickFigure`
  // gate as Create Figure — a template that could never itself become a
  // figure is not a useful thing to save (store/quickPlotTemplates.ts's
  // saveQuickPlotTemplate enforces this same gate belt-and-braces).
  const saveTemplate = (): void => {
    void promptSaveTemplate(dataset).then((result) => {
      if (!result) return;
      saveQuickPlotTemplate(dataset.id, mapping, style, result.name, result.scope);
    });
  };
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
          {roleFilteredYChannels.length > 0 && (
            <p id="quick-builder-role-warning" className="qzk-quick-builder-notice" role="status">
              {roleFilteredYChannels.length === 1
                ? `"${dataset.data.labels[roleFilteredYChannels[0]]}" is marked Label/Ignore in this worksheet — creation is blocked until you clear its role in the Channels card.`
                : `${roleFilteredYChannels.length} assigned Y channels are marked Label/Ignore in this worksheet — creation is blocked until you clear their roles in the Channels card.`}
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
          <button
            type="button"
            className="qz-btn"
            disabled={createDisabledReason !== undefined}
            title={createDisabledReason}
            onClick={saveTemplate}
          >
            Save Quick Plot Template…
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

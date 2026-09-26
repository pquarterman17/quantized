// "Metadata → factors" workshop — view (audit P2.5, "metadata cleanup /
// promotion to factors"). Pick the datasets, then either promote a metadata
// field to a per-row factor column or clean up the metadata keys and values;
// both preview every change before anything is written. Thin — the logic is
// useMetaFactors + lib/metadataFactor / lib/metadataCleanup / lib/metadataRun.

import ToolWindow from "../../overlays/ToolWindow";
import { Checkbox } from "../../primitives/Checkbox";
import { SegmentedControl } from "../../primitives/SegmentedControl";
import { useMetaFactorsDialog } from "../../../store/metaFactorsDialog";
import CleanupSection from "./CleanupSection";
import PromoteSection from "./PromoteSection";
import { useMetaFactors, type MetaTab } from "./useMetaFactors";

/** Remounted on every opening, so a second open re-seeds the picks. */
export default function MetaFactorsPanel() {
  const opened = useMetaFactorsDialog((s) => s.opened);
  return <MetaFactorsWorkshop key={opened} />;
}

function MetaFactorsWorkshop() {
  const m = useMetaFactors();
  return (
    <ToolWindow id="metafactors" title="Metadata → factors" width={420} onClose={m.close}>
      {!m.datasets.length ? (
        <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>Load a dataset first.</div>
      ) : (
        <>
          <label className="qzk-field-lbl">Datasets</label>
          <div role="group" aria-label="Datasets" style={{ maxHeight: 110, overflowY: "auto", display: "grid", gap: 2 }}>
            {m.datasets.map((d) => (
              <Checkbox key={d.id} checked={m.picked.includes(d.id)} onChange={(on) => m.togglePick(d.id, on)}>
                {d.name}
              </Checkbox>
            ))}
          </div>
          <div style={{ marginTop: 8 }}>
            <SegmentedControl<MetaTab>
              options={[
                { value: "promote", label: "Promote to factor" },
                { value: "cleanup", label: "Clean up metadata" },
              ]}
              value={m.tab}
              onChange={m.setTab}
            />
          </div>
          {m.tab === "promote" ? <PromoteSection m={m} /> : <CleanupSection m={m} />}
          {m.error && (
            <div className="qzk-ds-meta" role="alert" style={{ marginTop: 8, color: "var(--danger)" }}>
              {m.error}
            </div>
          )}
        </>
      )}
    </ToolWindow>
  );
}

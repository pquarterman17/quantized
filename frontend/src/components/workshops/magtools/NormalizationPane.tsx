// Magnetometry Units tab — view (MAIN_PLAN #42). Field-unit conversion plus
// explicit-basis sample normalization: pick a basis (none/raw, mass, area,
// volume), an output unit from THAT basis's family, describe the sample with
// `value | unit` rows, read the live calculation summary, then Apply — which
// writes a new derived dataset. All state/logic lives in useMagNormalization,
// which MagToolsPanel owns so the tab's choices survive switching tabs.

import { Button, Select } from "../../primitives";
import {
  BASIS_OPTIONS,
  GEOMETRY_LABELS,
  geometriesFor,
  type NormalizationBasis,
} from "../../../lib/sampleNormalization";
import type { SampleGeometry } from "../../../lib/sampleGeometry";
import { NormalizationSummaryView } from "./NormalizationSummaryView";
import { QuantityRow } from "./QuantityRow";
import { SavedProfilesRow } from "./SavedProfilesRow";
import type { MagNormalizationState } from "./useMagNormalization";

const opts = (xs: readonly string[]) => xs.map((v) => ({ value: v, label: v }));
const REASON_ID = "mag-norm-apply-reason";

export default function NormalizationPane({ n }: { n: MagNormalizationState }) {
  const isField = n.fromField !== null;
  const notField = n.active !== null && !isField;
  const geometries = geometriesFor(n.basis);
  return (
    <div className="qz-mag-norm">
      <div className="qz-mag-norm-grid">
        <label className="qzk-field-lbl" htmlFor="mag-norm-field">
          {notField ? `x axis (${n.xUnit || "no unit"})` : `Field ${n.fromField ?? ""} →`}
        </label>
        <Select
          id="mag-norm-field"
          aria-label="Target field unit"
          options={opts(n.fieldUnits)}
          value={n.toField}
          disabled={!isField}
          title={notField ? "The x axis is not a field, so it is not converted." : undefined}
          onChange={(e) => n.setToField(e.target.value)}
        />
        <label className="qzk-field-lbl" htmlFor="mag-norm-basis">Normalization basis</label>
        <Select
          id="mag-norm-basis"
          options={BASIS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          value={n.basis}
          onChange={(e) => n.setBasis(e.target.value as NormalizationBasis)}
        />
        <label className="qzk-field-lbl" htmlFor="mag-norm-output">
          Moment {n.fromMoment} →
        </label>
        <Select
          id="mag-norm-output"
          aria-label="Output moment unit"
          options={opts(n.outputUnits)}
          value={n.toMoment}
          disabled={n.outputUnits.length === 0}
          onChange={(e) => n.setToMoment(e.target.value)}
        />
        {geometries.length > 0 && (
          <>
            <label className="qzk-field-lbl" htmlFor="mag-norm-geometry">Sample geometry</label>
            <Select
              id="mag-norm-geometry"
              options={geometries.map((g) => ({ value: g, label: GEOMETRY_LABELS[g] }))}
              value={n.profile.geometry}
              onChange={(e) => n.setGeometry(e.target.value as SampleGeometry)}
            />
          </>
        )}
      </div>
      {notField && <div className="qzk-ds-meta qz-mag-muted">The x axis is not a field, so it is not converted.</div>}

      {n.basis === "none" ? (
        <div className="qzk-ds-meta qz-mag-muted">Raw moment: no sample quantity is used.</div>
      ) : (
        <>
          <div className="qz-mag-geometry">
            {n.summary.fields.map((f) => (
              <QuantityRow
                key={f}
                field={f}
                text={n.texts[f]}
                unit={n.profile[f].unit}
                error={n.summary.fieldErrors[f]}
                onText={(t) => n.setFieldText(f, t)}
                onUnit={(u) => n.setFieldUnit(f, u)}
              />
            ))}
          </div>
          <div className="qz-mag-profile-row">
            <Button size="sm" disabled={!n.active} onClick={n.fillFromMetadata}>Use metadata values</Button>
            <span className="qzk-ds-meta qz-mag-muted">Fills only what the metadata states; never picks the basis.</span>
          </div>
          <SavedProfilesRow saved={n.profiles.saved} onSave={n.saveProfile} onLoad={n.loadProfile} onDelete={n.profiles.remove} />
        </>
      )}

      <NormalizationSummaryView summary={n.summary} />
      <div className="qz-mag-apply">
        <Button
          variant="primary"
          size="sm"
          disabled={n.busy || n.applyBlocked !== null}
          aria-describedby={n.applyBlocked ? REASON_ID : undefined}
          onClick={() => void n.apply()}
        >
          {n.busy ? "Applying…" : "Apply → new dataset"}
        </Button>
      </div>
      {n.applyBlocked && (
        <div id={REASON_ID} className="qzk-ds-meta qz-mag-warn">Apply is disabled: {n.applyBlocked}</div>
      )}
      {n.notice && <div className="qzk-ds-meta qz-mag-muted">{n.notice}</div>}
      {n.warning && <div className="qzk-ds-meta qz-mag-warn">{n.warning}</div>}
      {n.error && <div className="qzk-ds-meta qz-mag-error">{n.error}</div>}
      <div className="qzk-ds-meta qz-mag-muted">
        Apply never edits the imported data: it writes a new dataset whose provenance records every input with its
        entered unit and canonical value, the basis, the output unit and the formula.
      </div>
    </div>
  );
}
